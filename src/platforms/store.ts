/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type {
    Platform,
    PlatformCapabilities,
    PlatformChain,
    PlatformChainKind,
    PlatformId,
    PlatformWallet,
} from './types'
import {
    DEFAULT_PLATFORM_ID,
    getPlatform,
    isPlatformAvailable,
    listAvailablePlatforms,
    listPlatforms,
} from './registry'
import { applyPlatformTheme } from './theme'

const STORAGE_KEY = 'activePlatform'

/**
 * Which platform the wallet is currently operating on.
 *
 * Named `useActivePlatformStore`, NOT `usePlatformStore` — the latter already
 * exists (`@/stores/platform`) and is Avalanche's P-Chain / platformvm store.
 * The two are unrelated; keeping the names distinct avoids importing the wrong
 * one by autocomplete.
 */
export const useActivePlatformStore = defineStore('activePlatform', () => {
    const activePlatformId = ref<PlatformId>(DEFAULT_PLATFORM_ID)

    const activePlatform = computed((): Platform | undefined =>
        getPlatform(activePlatformId.value)
    )

    /**
     * Bumped whenever a platform's active wallet connects/disconnects.
     *
     * `Platform.getActiveWallet()` is a plain synchronous function — Avalanche's
     * implementation happens to read a Pinia ref (`mainStore.activeWallet`), so
     * calling it from inside a Vue `computed` is naturally reactive there. A
     * platform that instead mirrors its wallet in a module-scope variable for
     * non-Vue contexts (see the comment on `peekActiveWallet` in
     * platforms/evm/store.ts) is NOT naturally reactive — Vue's dependency
     * tracker only sees a plain variable read, not a reactive one, so a
     * `computed` calling `getActiveWallet()` would silently never re-run after
     * connecting. `activeWallet` below depends on this ref so it re-evaluates on
     * every wallet change regardless of how the underlying platform stores its
     * wallet; platforms whose `getActiveWallet()` needs this call
     * `notifyWalletChanged()` wherever they change it (Avalanche doesn't need
     * to — its own reactive store already covers it, and an extra bump there is
     * harmless besides).
     */
    const walletEpoch = ref(0)
    const notifyWalletChanged = (): void => {
        walletEpoch.value++
    }

    /** The active platform's connected wallet, or null. Reactive — see `walletEpoch` above. */
    const activeWallet = computed((): PlatformWallet | null => {
        void walletEpoch.value
        return activePlatform.value?.getActiveWallet() ?? null
    })

    /**
     * Capabilities of the active platform. Falls back to everything-off so a
     * capability-gated feature never renders while no platform is resolved.
     */
    const capabilities = computed((): PlatformCapabilities | null =>
        activePlatform.value?.capabilities ?? null
    )

    const can = (capability: keyof PlatformCapabilities): boolean =>
        capabilities.value?.[capability] ?? false

    /** Sub-chains of the active platform. */
    const chains = computed((): PlatformChain[] => activePlatform.value?.chains ?? [])

    /**
     * Whether the active platform exposes a chain of a given shape.
     *
     * This is the check that hides Avalanche's X/P surfaces on single-chain
     * platforms: a view asks `hasChainKind('staking')` instead of testing the
     * platform id, so a plain EVM platform renders as an ordinary account
     * wallet with no edits to that view.
     */
    const hasChainKind = (kind: PlatformChainKind): boolean =>
        chains.value.some((c) => c.kind === kind)

    /** True when the platform has more than one sub-chain to move funds between. */
    const isMultiChain = computed((): boolean => chains.value.length > 1)

    /** Every registered platform, including ones that aren't built yet. */
    const platforms = computed((): Platform[] => listPlatforms())
    /** Only the ones that can actually be logged into. */
    const availablePlatforms = computed((): Platform[] => listAvailablePlatforms())

    /**
     * Switch platforms. Rejects unknown or not-yet-implemented ids rather than
     * leaving the app pointing at a platform with no implementation behind it.
     *
     * Switching always lands on a **completely fresh wallet session**: the
     * previous platform is logged out, and the app is then hard-reloaded.
     *
     * The reload is deliberate rather than lazy. Platform state is spread
     * across many long-lived Pinia stores (wallets, assets, network, history,
     * pollers, the vendored SDK's module-level singletons) that were written
     * assuming a single platform for the lifetime of the page. Clearing them
     * piecemeal would leave whichever one we forgot holding the old platform's
     * data — a wallet showing another chain's balances is a far worse failure
     * than a reload. The chosen id is persisted first, so the app comes back up
     * on the new platform with everything else at its initial state.
     */
    const setActivePlatform = async (id: PlatformId): Promise<void> => {
        if (id === activePlatformId.value) return

        if (!isPlatformAvailable(id)) {
            throw new Error(`Platform "${id}" is not available yet.`)
        }

        const previous = activePlatform.value
        if (previous) {
            try {
                await previous.logout()
            } catch (e) {
                // A failed logout must not strand the user on the old platform;
                // the reload below discards that session's state anyway.
                console.warn('[platforms] logout during switch failed:', e)
            }
            await previous.deactivate?.()
        }

        localStorage.setItem(STORAGE_KEY, id)
        // Drop any persisted Avalanche wallet so the new platform cannot come
        // back up with the previous one's keys restored from storage.
        localStorage.removeItem('w')

        activePlatformId.value = id

        window.location.href = '/'
    }

    /**
     * Platform ids that no longer exist, mapped to their successor.
     *
     * The per-chain EVM platforms were folded into the single `evm` platform,
     * which differentiates by network instead. Without this, anyone whose saved
     * platform was one of them would silently land on Avalanche — the generic
     * "unknown id" fallback — which reads as the app forgetting their choice
     * rather than as the rename it actually is.
     */
    const RENAMED_PLATFORM_IDS: Record<string, PlatformId> = {
        robinhood: 'evm',
        ethereum: 'evm',
    }

    /**
     * Restore the previously chosen platform. A saved id that is no longer
     * available (removed between releases) silently falls back to the default
     * rather than leaving the app unusable.
     */
    const initPlatform = (): void => {
        const saved = localStorage.getItem(STORAGE_KEY)
        const migrated = saved ? RENAMED_PLATFORM_IDS[saved] : undefined

        if (migrated && saved !== migrated) {
            // Rewrite the stored id so the migration happens once rather than
            // on every boot, and so the stale id cannot linger and confuse a
            // later release.
            try {
                localStorage.setItem(STORAGE_KEY, migrated)
            } catch {
                /* storage unavailable — the in-memory value below still applies */
            }
        }

        const resolved = migrated ?? saved
        activePlatformId.value =
            resolved && isPlatformAvailable(resolved) ? resolved : DEFAULT_PLATFORM_ID

        // Tint the interface for the restored platform before the first paint.
        applyPlatformTheme(activePlatform.value?.descriptor.theme)
        void activePlatform.value?.activate?.()
    }

    return {
        activePlatformId,
        activePlatform,
        activeWallet,
        notifyWalletChanged,
        capabilities,
        can,
        chains,
        hasChainKind,
        isMultiChain,
        platforms,
        availablePlatforms,
        setActivePlatform,
        initPlatform,
    }
})
