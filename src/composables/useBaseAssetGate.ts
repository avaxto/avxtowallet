/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The base-asset (AVXTO) holding requirement, as a per-action gate.
 *
 * This replaces a whole-wallet ejection: falling below the threshold used to
 * redirect the user out of the wallet to /insufficient-balance from inside
 * `Erc20Token.updateBalance`, which meant a balance refresh could yank
 * someone off whatever page they were on, mid-task. Now every page stays
 * reachable and only the handful of actions that actually require the
 * holding ask this first — see `gatedAction` below and the pages listed in
 * its doc comment.
 *
 * Two pieces of state, deliberately distinct:
 *
 *  - `isGated` — reactive, derived from the live token balance. Drives the
 *    `:disabled` on gated buttons, so it re-enables on its own the moment a
 *    swap lands and balances refresh; nothing has to remember to clear it.
 *  - the modal — shared module-level state rather than per-component, so the
 *    single <BaseAssetGateModal> mounted once in the wallet layout serves
 *    every gated button on every page.
 *
 * `null` from `shortfall` means "not known yet" and is NOT a gate: a balance
 * that has not been read is indistinguishable by value from a zero one, and
 * blocking holders for the first seconds of a session would be worse than
 * briefly allowing an action through. Anything user-initiated goes through
 * `check()`, which reads the balance fresh before deciding, so the "not yet
 * known" window never actually decides a gated action.
 */
import { computed, ref } from 'vue'

import { useAssetsStore, useMainStore } from '@/stores'

/** Whether the gate modal is currently open. Shared by every caller. */
const isModalOpen = ref(false)

/** How the open modal was closed. See `openModal`. */
export type GateOutcome = 'cancel' | 'swap'

/** Resolver for the promise `openModal` handed its caller. */
let settleOutcome: ((outcome: GateOutcome) => void) | null = null

export function useBaseAssetGate() {
    const assetsStore = useAssetsStore()

    /**
     * Whether THIS caller has already shown the modal and had it dismissed.
     *
     * Per-component, not module-level, and that is the point: dismissing the
     * message on one page must not silently disable a button on another page
     * the user has not been told about yet — they would meet a dead control
     * with no explanation, which is precisely the failure this whole gate
     * exists to avoid.
     */
    const wasDismissed = ref(false)

    /** The configured base asset, or null when none is set up yet. */
    const baseAsset = computed(() => assetsStore.baseAsset)

    /** The live `Erc20Token` for the base asset, or null. */
    const baseAssetToken = computed(() => {
        const base = baseAsset.value
        if (!base) return null
        // Read through the store getter so the lookup tracks the reactive
        // token arrays, not a detached copy.
        return assetsStore.findErc20(base.address)
    })

    /**
     * true = below the threshold, false = at or above it, null = not known
     * yet (no base asset configured, or its balance never read).
     */
    const shortfall = computed((): boolean | null => {
        const base = baseAsset.value
        if (!base || !base.thr) return null
        const token = baseAssetToken.value
        if (!token || !token.balanceFetched) return null
        return token.balanceBN.lt(base.thr)
    })

    /** Whether the holding requirement is known to be unmet. */
    const isGated = computed((): boolean => shortfall.value === true)

    /**
     * What gated buttons actually bind `:disabled` to.
     *
     * NOT `isGated`. A disabled button fires no click event, so disabling on
     * the shortfall alone produces a dead control that can never explain
     * itself — the user is short, the button is grey from first render, and
     * clicking it does nothing at all. The button therefore stays live until
     * the user has actually been shown the modal and dismissed it; only then
     * does it go grey, which is the "cancel leaves them on the same screen
     * with the button disabled" behaviour being asked for.
     *
     * Still ANDed with `isGated` so it un-disables itself the moment the
     * holding arrives, without the dismissal having to be cleared by hand.
     */
    const isBlocked = computed((): boolean => wasDismissed.value && isGated.value)

    /**
     * Shows the modal, resolving once it is closed with how it was closed.
     * A second opener replaces the first's resolver, which cannot happen in
     * practice — one modal, and the button that opened it is unreachable
     * behind it.
     */
    const openModal = (): Promise<GateOutcome> => {
        isModalOpen.value = true
        return new Promise<GateOutcome>((resolve) => {
            settleOutcome = resolve
        })
    }

    /** `outcome` defaults to 'cancel': the X and the backdrop are dismissals. */
    const closeModal = (outcome: GateOutcome = 'cancel') => {
        isModalOpen.value = false
        const settle = settleOutcome
        settleOutcome = null
        settle?.(outcome)
    }

    /**
     * Reads the base asset's balance fresh, then answers whether the holding
     * requirement is met.
     *
     * Fresh rather than cached because this decides a user-initiated action:
     * someone who just swapped on /wallet/swap and came straight back must
     * not be told they still hold nothing, and someone who moved their
     * holding out in another tab must not slip an action through on a stale
     * figure. A wallet with no eth address (or no base asset configured)
     * cannot be assessed, and is not gated.
     *
     * `avalancheWallet`, not `activeWallet`: the holding is a fact about
     * Avalanche's C-Chain, and it has to be readable while a different
     * platform tab is in front — `activeWallet` is deliberately null then
     * (see the comment on it in stores/main), which would silently turn
     * every check into a no-op that falls back to a stale answer.
     */
    const check = async (): Promise<boolean> => {
        const base = baseAsset.value
        if (!base || !base.thr) return true

        const token = baseAssetToken.value
        if (!token) return true

        const wallet = useMainStore().avalancheWallet
        const ethAddress = wallet?.ethAddress
        if (ethAddress) {
            try {
                await token.updateBalance(ethAddress)
            } catch (e) {
                // A failed read is not evidence of a shortfall. Fall through
                // to whatever was last known rather than gating on an RPC
                // hiccup — `shortfall` stays null when nothing was ever read.
                console.error('Base asset balance check failed:', e)
            }
        }

        return shortfall.value !== true
    }

    /**
     * Wraps one gated action: `/wallet/unifychains`'s "Unify onto",
     * `/wallet/quickdelegate`'s "Find Validator", `/wallet/launcher`'s
     * "Deploy Token", `/wallet/psat`'s "Load transaction",
     * `/wallet/iceberg`'s "Start Iceberg Order", `/wallet/broadcast`'s
     * "Broadcast to", and every step button in `/wallet/wizard`.
     *
     * Runs `action` when the holding is there; otherwise opens the modal and
     * runs nothing. The page itself stays where it is either way — cancelling
     * the modal leaves the user on the same screen, with the button now
     * disabled by `isGated`, which has just learned the answer.
     */
    const gatedAction = async (action: () => unknown): Promise<boolean> => {
        if (!(await check())) {
            const outcome = await openModal()
            // Only a dismissal disables the button. Leaving for the swap page
            // unmounts this component anyway, and if the user comes back
            // having bought some, the control should be live again.
            if (outcome === 'cancel') wasDismissed.value = true
            return false
        }
        // A holding that arrived since the last refusal re-opens the button.
        wasDismissed.value = false
        await action()
        return true
    }

    return {
        isBlocked,
        isGated,
        wasDismissed,
        shortfall,
        isModalOpen,
        baseAsset,
        openModal,
        closeModal,
        check,
        gatedAction,
    }
}
