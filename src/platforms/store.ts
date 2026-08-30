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
     * Every available platform that currently has a wallet connected.
     *
     * This is what the platform tabs render. Reactive through `walletEpoch`
     * above — a platform's `getActiveWallet()` reads a plain module-scope
     * mirror, so without that dependency this would never re-evaluate.
     */
    const connectedPlatforms = computed((): Platform[] => {
        void walletEpoch.value
        return listAvailablePlatforms().filter((p) => p.getActiveWallet() != null)
    })

    const isPlatformConnected = (id: PlatformId): boolean =>
        connectedPlatforms.value.some((p) => p.descriptor.id === id)

    /**
     * True when moving to `id` would tear down live sessions.
     *
     * Only platforms that BOTH declare `supportsConcurrentSession` can hand
     * over in place; anything else takes the logout-and-reload path below,
     * which ends every other session too. The UI asks this before offering
     * such a switch, so the loss is deliberate rather than a surprise.
     */
    const isDestructiveSwitch = (id: PlatformId): boolean => {
        if (id === activePlatformId.value) return false
        const next = getPlatform(id)
        const canHandOver =
            !!activePlatform.value?.supportsConcurrentSession && !!next?.supportsConcurrentSession
        return !canHandOver && connectedPlatforms.value.length > 0
    }

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
     * True while `setActivePlatform` is deliberately logging every session out
     * ahead of a reload. See its destructive path and `finishDisconnect`.
     */
    let isTearingDown = false

    const persistPlatformId = (id: PlatformId): void => {
        try {
            localStorage.setItem(STORAGE_KEY, id)
        } catch {
            /* storage unavailable — the in-memory value still applies */
        }
    }

    /**
     * Switch platforms. Rejects unknown or not-yet-implemented ids rather than
     * leaving the app pointing at a platform with no implementation behind it.
     *
     * Two very different paths, chosen by `supportsConcurrentSession`:
     *
     * **In place** — when the outgoing and incoming platforms both keep their
     * whole session in their own store. Nothing is logged out and there is no
     * reload: the pointer moves and both wallets stay live. This is what the
     * platform tabs switch with, and what lets a user hold Bitcoin, Solana and
     * EVM sessions at once.
     *
     * **Logout and reload** — for anything involving a platform that does not
     * (today, Avalanche). Platform state is then spread across many long-lived
     * Pinia stores (wallets, assets, network, history, pollers, the vendored
     * SDK's module-level singletons) written assuming a single platform for the
     * lifetime of the page. Clearing them piecemeal would leave whichever one
     * we forgot holding the old platform's data — a wallet showing another
     * chain's balances is a far worse failure than a reload. Every live session
     * is logged out first so its vault is cleared properly rather than just
     * vanishing with the page; the chosen id is persisted so the app comes back
     * up on the new platform with everything else at its initial state.
     */
    const setActivePlatform = async (id: PlatformId): Promise<void> => {
        if (id === activePlatformId.value) return

        if (!isPlatformAvailable(id)) {
            throw new Error(`Platform "${id}" is not available yet.`)
        }

        const previous = activePlatform.value
        const next = getPlatform(id)

        if (previous?.supportsConcurrentSession && next?.supportsConcurrentSession) {
            persistPlatformId(id)
            activePlatformId.value = id
            applyPlatformTheme(next.descriptor.theme)
            await next.activate?.()
            return
        }

        // Destructive path. Log out EVERY live session, not just the outgoing
        // one — the reload below ends them all regardless, and a vault that is
        // cleared on the way out beats one that simply disappears with the
        // page.
        //
        // `isTearingDown` suppresses the hand-over each of those logouts would
        // otherwise trigger: a platform store's `disconnect()` ends by calling
        // `finishDisconnect`, which looks for a surviving session to switch to.
        // Mid-teardown that is exactly wrong — it would move
        // `activePlatformId` to a platform this loop is about to log out, and
        // race the id being persisted below.
        isTearingDown = true
        try {
            // `previous` is usually also in `connectedPlatforms`; de-duplicated
            // so it is not logged out twice.
            const seen = new Set<PlatformId>()
            for (const platform of [...connectedPlatforms.value, previous]) {
                if (!platform) continue
                if (seen.has(platform.descriptor.id)) continue
                seen.add(platform.descriptor.id)

                try {
                    await platform.logout()
                } catch (e) {
                    // A failed logout must not strand the user on the old
                    // platform; the reload below discards that session's state
                    // anyway.
                    console.warn('[platforms] logout during switch failed:', e)
                }
                await platform.deactivate?.()
            }
        } finally {
            isTearingDown = false
        }

        persistPlatformId(id)
        // Drop any persisted Avalanche wallet so the new platform cannot come
        // back up with the previous one's keys restored from storage.
        localStorage.removeItem('w')

        activePlatformId.value = id

        window.location.href = '/'
    }

    /**
     * Make sure the active platform is one that actually has a wallet, and
     * report whether any live session exists at all.
     *
     * The add-another-session flow deliberately makes an UNCONNECTED platform
     * active so its access methods render (see `/access?add=1`). If the user
     * abandons that flow and heads back to the wallet, the active platform
     * would otherwise have nothing behind it while other sessions are still
     * live — the wallet UI would render empty for a platform never connected.
     */
    const ensureActiveIsConnected = async (): Promise<boolean> => {
        if (activePlatform.value?.getActiveWallet()) return true

        const fallback = connectedPlatforms.value[0]
        if (!fallback) return false

        await setActivePlatform(fallback.descriptor.id)
        return true
    }

    /**
     * Called by a platform's own store once it has torn its session down.
     *
     * Replaces the `window.location.href = '/'` those stores used to end on: a
     * reload takes every OTHER platform's session with it, since their vaults
     * live only in memory. When a concurrent session is still connected, hand
     * over to it and stay in the wallet; only fall back to a full reset when
     * this was the last one.
     */
    const finishDisconnect = async (): Promise<void> => {
        // Reached from inside `setActivePlatform`'s own teardown loop, which is
        // already logging every platform out and will reload when it is done.
        // Handing over to a session that loop is about to close would both
        // fight it and clobber the platform id it is on its way to persisting.
        if (isTearingDown) return

        const remaining = connectedPlatforms.value.filter(
            (p) => p.descriptor.id !== activePlatformId.value && p.supportsConcurrentSession
        )

        if (remaining.length > 0) {
            await setActivePlatform(remaining[0].descriptor.id)
            return
        }

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
        connectedPlatforms,
        isPlatformConnected,
        isDestructiveSwitch,
        setActivePlatform,
        ensureActiveIsConnected,
        finishDisconnect,
        initPlatform,
    }
})
