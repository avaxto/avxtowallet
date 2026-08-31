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

/** What happened to one platform in a `unlockWithMnemonic` pass. */
export interface MnemonicUnlockResult {
    platformId: PlatformId
    /**
     * `connected` — this pass opened it.
     * `skipped` — it already had a live session, which is left untouched.
     * `failed` — see `error`. Other platforms in the same pass are unaffected.
     */
    status: 'connected' | 'skipped' | 'failed'
    error?: string
}

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
     * Whether moving from `previous` to `next` can happen without a reload.
     *
     * The single source of truth for that question: `setActivePlatform` acts on
     * it and `isDestructiveSwitch` warns from it, so the warning the user sees
     * cannot drift from what actually happens.
     *
     * Two ways to qualify. The incoming platform must keep its whole session in
     * its own store (`supportsConcurrentSession`) — there is no way to bring up
     * a platform that needs the global stores without the reload that
     * initialises them. Given that, the outgoing side is fine if it is
     * *either* equally isolated, *or* simply not logged in: the reload's job is
     * to clear the outgoing platform's state, and a platform that was never
     * connected has none. That second case is not an edge case — the app boots
     * on Avalanche, so it is every cold start that opens a different platform.
     */
    const canHandOverInPlace = (
        previous: Platform | undefined,
        next: Platform | undefined
    ): boolean => {
        if (!next?.supportsConcurrentSession) return false
        return !!previous?.supportsConcurrentSession || previous?.getActiveWallet() == null
    }

    /**
     * True when moving to `id` would tear down live sessions.
     *
     * A switch that cannot hand over in place takes the logout-and-reload path
     * below, which ends every other session too. The UI asks this before
     * offering such a switch, so the loss is deliberate rather than a surprise.
     */
    const isDestructiveSwitch = (id: PlatformId): boolean => {
        if (id === activePlatformId.value) return false
        void walletEpoch.value
        if (canHandOverInPlace(activePlatform.value, getPlatform(id))) return false
        return connectedPlatforms.value.length > 0
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

    /**
     * True when Avalanche is the platform the user is currently on.
     *
     * The expression is the one described in the note on `PlatformChainKind`:
     * `utxo` and `staking` exist as kinds precisely because no other platform
     * has an X or a P chain, so testing for them is how the codebase asks "is
     * this Avalanche?" without naming the platform id. Roughly ten call sites
     * write it out inline and name the result `isAvalanche`; that note calls
     * naming it properly "the cleaner fix".
     *
     * It is named here because Phase 3 gave it a job beyond hiding UI:
     * `mainStore.activeWallet` returns null unless this is true, which is what
     * keeps some seventy Avalanche-specific readers from rendering onto another
     * platform's tab now that Avalanche can be connected while one is in front.
     * A rule with that much riding on it should exist once, under a name, where
     * it can be tested — not as an expression each caller re-derives.
     */
    const isAvalancheActive = computed(
        (): boolean => hasChainKind('utxo') || hasChainKind('staking')
    )

    /** Every registered platform, including ones that aren't built yet. */
    const platforms = computed((): Platform[] => listPlatforms())
    /** Only the ones that can actually be logged into. */
    const availablePlatforms = computed((): Platform[] => listAvailablePlatforms())

    /**
     * Platforms one recovery phrase can open in a single pass.
     *
     * Derived from what each platform declares rather than listed here, so a
     * new seed-based platform joins the flow by implementing
     * `unlockWithMnemonic`. Avalanche did exactly that when it became able to
     * hold a concurrent session, with no edit to this file or the view — which
     * is the property this was built for.
     *
     * Both flags are required. Opening a platform that cannot hold a
     * concurrent session alongside the others would produce exactly the
     * outcome this feature exists to remove: a row of tabs that log each other
     * out. See `unlockWithMnemonic` in ./types.ts.
     */
    const mnemonicUnlockablePlatforms = computed((): Platform[] =>
        listAvailablePlatforms().filter(
            (p) => typeof p.unlockWithMnemonic === 'function' && p.supportsConcurrentSession
        )
    )

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
     * Two very different paths, chosen by `canHandOverInPlace` above:
     *
     * **In place** — nothing is logged out and there is no reload: the pointer
     * moves and any live wallets stay live. This is what the platform tabs
     * switch with, what lets a user hold Bitcoin, Solana and EVM sessions at
     * once, and what lets a cold start on Avalanche open one of them without
     * throwing away a session it just opened.
     *
     * **Logout and reload** — for anything involving a platform that does not.
     * No shipped platform is in that category any more, but the path is kept
     * rather than deleted: it is the correct behaviour for a platform that
     * cannot tear its session down in place, and removing it would quietly
     * make declaring `supportsConcurrentSession` mandatory. Such a platform's
     * state would be spread across many long-lived
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

        if (canHandOverInPlace(previous, next)) {
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
     * Open a session on several platforms from ONE recovery phrase and ONE
     * session password.
     *
     * Targets default to every platform in `mnemonicUnlockablePlatforms`; pass
     * `ids` to narrow that to the subset the user ticked. A platform that
     * already has a live session is left strictly alone and reported as
     * `skipped` — re-running the unlock over it would replace a working wallet,
     * and if the phrase differs it would silently swap the user's session for
     * a different one. That is what makes this safe to run from the
     * add-another-session flow with sessions already open.
     *
     * Runs concurrently, and reports per platform. The platforms derive
     * independently and each probes its own chain over the network — Bitcoin
     * walks five address-type candidates, Solana two derivation conventions —
     * so doing them in sequence would make the wait the sum of the slowest
     * chains rather than the max of them. Each task captures its own failure
     * rather than rejecting, so one platform's RPC being down cannot discard
     * another's wallet that already opened successfully — and there is nothing
     * to roll back *to*: the funds on the platforms that did open are
     * reachable, so the honest outcome is a partial success the caller reports,
     * not an exception that throws the working sessions away.
     *
     * The phrase is passed through to each platform rather than converted to a
     * seed once and shared. That is deliberate and not merely tidy: `vaultWith`
     * *consumes and wipes* the seed buffer it is handed, so a shared seed would
     * leave whichever platform ran second deriving from zeroes.
     *
     * Nothing here navigates. The caller owns that, because a pass that opened
     * two platforms and failed a third has something to say before moving on.
     *
     * One password unlocking several platforms is a real change in exposure and
     * the UI says so: each platform still gets its own `SessionVault` with its
     * own salt and AAD, so no ciphertext can be moved between them, but one
     * remembered password now authorizes signing on all of them rather than one.
     */
    const unlockWithMnemonic = async (
        mnemonic: string,
        sessionPassword: string,
        ids?: PlatformId[]
    ): Promise<MnemonicUnlockResult[]> => {
        const wanted = ids ? new Set(ids) : null
        const targets = mnemonicUnlockablePlatforms.value.filter(
            (p) => !wanted || wanted.has(p.descriptor.id)
        )

        if (targets.length === 0) {
            throw new Error('No platform can be opened from a recovery phrase alone.')
        }

        const settled = await Promise.all(
            targets.map(async (platform): Promise<MnemonicUnlockResult> => {
                const platformId = platform.descriptor.id

                if (platform.getActiveWallet() != null) {
                    return { platformId, status: 'skipped' }
                }

                try {
                    await platform.unlockWithMnemonic!(mnemonic, sessionPassword)
                    return { platformId, status: 'connected' }
                } catch (e: any) {
                    return {
                        platformId,
                        status: 'failed',
                        error: e?.message || 'Failed to open this platform.',
                    }
                }
            })
        )

        // A platform store sets its wallet through its own `setWallet`, which
        // already bumps the epoch — but only for the platforms that mirror
        // their wallet outside Pinia. Bump once here so `connectedPlatforms`
        // below is guaranteed current regardless of how each target stores its.
        notifyWalletChanged()

        // Land on something real. The active platform is usually Avalanche at
        // this point (the default, and unconnected), which no longer forces a
        // reload to leave — see `canHandOverInPlace`. Prefer a platform this
        // pass actually opened over registry order, so the user arrives on the
        // one they were most likely thinking about.
        if (activePlatform.value?.getActiveWallet() == null) {
            const landing =
                settled.find((r) => r.status === 'connected') ??
                settled.find((r) => r.status === 'skipped')
            if (landing) await setActivePlatform(landing.platformId)
        }

        return settled
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
        isAvalancheActive,
        platforms,
        availablePlatforms,
        connectedPlatforms,
        isPlatformConnected,
        isDestructiveSwitch,
        mnemonicUnlockablePlatforms,
        unlockWithMnemonic,
        setActivePlatform,
        ensureActiveIsConnected,
        finishDisconnect,
        initPlatform,
    }
})
