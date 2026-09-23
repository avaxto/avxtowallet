/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The premium-feature requirement, as a per-action gate: the wallet's address
 * must have burned at least `AVXTO_THR` AVXTO through Moats
 * (https://moats.app/moat/0xebe5…0524).
 *
 * It used to be a holding requirement — at least that much AVXTO in the
 * wallet. Burning replaces holding: the figure is the address's lifetime
 * `totalUserBurn` on the Moats contract, the same one the Moats dashboard
 * shows, read by `readBurnedOnMoats` over our own C-Chain connection.
 *
 * `AVXTO_THR` is in whole tokens (1,000,000 AVXTO — what the message has
 * always told users). The old holding check compared it against the raw
 * 18-decimal balance, so it actually asked for 10^-12 AVXTO; this scales it.
 *
 * Every page stays reachable and only the handful of actions that actually
 * require it ask this first — see `gatedAction` below and the pages listed in
 * its doc comment.
 *
 * Two pieces of state, deliberately distinct:
 *
 *  - `isGated` — reactive, derived from the last burn figure read for the
 *    current address. Drives the `:disabled` on gated buttons (through
 *    `isBlocked`), so it re-enables on its own once a check sees the burn;
 *    nothing has to remember to clear it. Shared module-level, so one
 *    button's check answers for every gated button.
 *  - the modal — shared module-level too, so the single <BaseAssetGateModal>
 *    mounted once in the wallet layout serves every gated button on every
 *    page.
 *
 * `null` from `shortfall` means "not known yet" and is NOT a gate: a figure
 * that has not been read is indistinguishable by value from zero, and
 * blocking qualified users for the first seconds of a session would be worse
 * than briefly allowing an action through. Anything user-initiated goes
 * through `check()`, which reads the burn fresh before deciding, so the "not
 * yet known" window never actually decides a gated action.
 */
import { computed, ref } from 'vue'

import { BN } from '@/avalanche'
import { AVXTO_SYMBOL, AVXTO_THR } from '@/avxto/AVXTOConf'
import { MOATS_CONTRACT_ADDRESS } from '@/js/Moats'
import { readBurnedOnMoats } from '@/js/MoatsStats'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { useMainStore } from '@/stores'

/** Where the user goes to meet the requirement. */
export const MOATS_BURN_URL = `https://moats.app/moat/${MOATS_CONTRACT_ADDRESS}`

const AVXTO_DECIMALS = 18

/** The requirement in wei. `AVXTO_THR` is whole tokens — see the module doc. */
export const REQUIRED_BURN_WEI = AVXTO_THR.mul(new BN(10).pow(new BN(AVXTO_DECIMALS)))

/** Whether the gate modal is currently open. Shared by every caller. */
const isModalOpen = ref(false)

/** How the open modal was closed. See `openModal`. */
export type GateOutcome = 'cancel' | 'burn' | 'swap'

/** Resolver for the promise `openModal` handed its caller. */
let settleOutcome: ((outcome: GateOutcome) => void) | null = null

/**
 * The last burn figure read, and for which address. Tied to the address so a
 * figure read for one wallet never answers for another.
 */
const lastRead = ref<{ address: string; burned: BN } | null>(null)

/**
 * Drops every burn figure read so far. Keyed by address, the figures are
 * already safe across wallet switches; this exists for tests, which need
 * each case to start from "nothing read".
 */
export function forgetBurnReads(): void {
    lastRead.value = null
}

/**
 * The address the requirement is checked against, or null when there is
 * none to check.
 *
 * Avalanche's C-Chain address first — `avalancheWallet`, not `activeWallet`,
 * because it has to be readable while a different platform tab is in front,
 * and `activeWallet` is deliberately null then (see the comment on it in
 * stores/main). Otherwise the active EVM platform's address: an EVM address
 * is the same account on every chain, so its Moats burns count wherever the
 * wallet is pointed. Before, a session with no Avalanche wallet had no
 * address to check and passed every gate.
 */
function gateAddress(): string | null {
    const eth = useMainStore().avalancheWallet?.ethAddress
    if (eth) return (eth.startsWith('0x') ? eth : '0x' + eth).toLowerCase()
    const evm = activeEvmSigner()?.address
    return evm ? evm.toLowerCase() : null
}

export function useBaseAssetGate() {
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

    /** The requirement, in whole AVXTO. */
    const required = computed(() => AVXTO_THR)
    const symbol = AVXTO_SYMBOL

    /** The current address's burn, in wei, or null when not read for it yet. */
    const burned = computed((): BN | null => {
        const read = lastRead.value
        const address = gateAddress()
        if (!read || !address || read.address !== address) return null
        return read.burned
    })

    /**
     * true = burned less than required, false = requirement met, null = not
     * known yet (no address, or nothing read for it).
     */
    const shortfall = computed((): boolean | null => {
        const b = burned.value
        return b === null ? null : b.lt(REQUIRED_BURN_WEI)
    })

    /** Whether the burn requirement is known to be unmet. */
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
     * Still ANDed with `isGated` so it un-disables itself the moment a check
     * sees the burn, without the dismissal having to be cleared by hand.
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
     * Reads the address's Moats burn fresh, then answers whether the
     * requirement is met.
     *
     * Fresh rather than cached because this decides a user-initiated action:
     * someone who just burned on moats.app and came straight back must not be
     * told they have burned nothing. A session with no address cannot be
     * assessed, and is not gated.
     */
    const check = async (): Promise<boolean> => {
        const address = gateAddress()
        if (!address) return true

        try {
            lastRead.value = { address, burned: await readBurnedOnMoats(address) }
        } catch (e) {
            // A failed read is not evidence of a shortfall. Fall through to
            // whatever was last known for this address rather than gating on
            // an RPC hiccup — `shortfall` stays null when nothing was ever read.
            console.error('Moats burn check failed:', e)
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
     * Runs `action` when the requirement is met; otherwise opens the modal
     * and runs nothing. The page itself stays where it is either way —
     * cancelling the modal leaves the user on the same screen, with the
     * button now disabled by `isGated`, which has just learned the answer.
     */
    const gatedAction = async (action: () => unknown): Promise<boolean> => {
        if (!(await check())) {
            const outcome = await openModal()
            // Only a dismissal disables the button. Someone who left for
            // moats.app to burn (or for the swap page to get AVXTO to burn)
            // is acting on the message, and the control should be live when
            // they come back.
            if (outcome === 'cancel') wasDismissed.value = true
            return false
        }
        // A burn that landed since the last refusal re-opens the button.
        wasDismissed.value = false
        await action()
        return true
    }

    return {
        isBlocked,
        isGated,
        wasDismissed,
        shortfall,
        burned,
        required,
        symbol,
        isModalOpen,
        openModal,
        closeModal,
        check,
        gatedAction,
    }
}
