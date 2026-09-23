/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The premium-feature gate: the wallet's address must have burned at least
 * AVXTO_THR (1,000,000) AVXTO through Moats.
 *
 * The behaviour that matters here is the three-valued answer, not the two
 * obvious ones. A burn figure that has never been read is indistinguishable
 * by value from zero, and the gate has to treat those differently: "not read
 * yet" must NOT disable anything, or every qualified user is locked out of
 * every gated action for the first seconds of every session.
 *
 * The rest of the file pins the cancel path: the action does not run, the
 * user does not move, and the button behind the modal ends up disabled — but
 * only AFTER the message has been shown and dismissed. That ordering is
 * load-bearing and was got wrong once: binding `:disabled` to the shortfall
 * itself produces a button that is grey from first render and, because a
 * disabled button fires no click event, can never open the modal that would
 * explain why. `isBlocked` is the binding; `isGated` alone is not.
 */
import { createPinia, setActivePinia } from 'pinia'
import { BN } from '@/avalanche'

import { useMainStore } from '@/stores/main'

const burnedByAddress = new Map<string, BN>()
let reads: string[] = []
let failReads = false
jest.mock('@/js/MoatsStats', () => ({
    readBurnedOnMoats: async (address: string) => {
        reads.push(address)
        if (failReads) throw new Error('rpc down')
        return burnedByAddress.get(address.toLowerCase()) ?? new BN(0)
    },
}))

const evmSigner: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => evmSigner.current }))

import {
    REQUIRED_BURN_WEI,
    forgetBurnReads,
    useBaseAssetGate,
} from '@/composables/useBaseAssetGate'

const AVALANCHE_ETH = '11'.repeat(20)
const AVALANCHE_ADDRESS = '0x' + AVALANCHE_ETH
const EVM_ADDRESS = '0x' + '22'.repeat(20)

const E18 = new BN('1000000000000000000')
const tokens = (n: number) => new BN(n).mul(E18)

/**
 * Gives the session an Avalanche wallet. Set through `activeWallet`'s setter,
 * which writes the same ref `avalancheWallet` reads — the gate deliberately
 * reads the ungated one.
 */
function connectAvalanche() {
    useMainStore().activeWallet = { ethAddress: AVALANCHE_ETH } as any
}

/**
 * Lets `gatedAction` run as far as opening the modal. `check()` awaits a read
 * before it decides, so the modal is several microtask hops away from the
 * call; everything in that path is promise-based, so draining the microtask
 * queue is enough.
 */
async function untilModalOpen(gate: ReturnType<typeof useBaseAssetGate>) {
    for (let i = 0; i < 50 && !gate.isModalOpen.value; i++) await Promise.resolve()
    expect(gate.isModalOpen.value).toBe(true)
}

/** Clicks a gated button and cancels the modal it raises. */
async function clickAndCancel(gate: ReturnType<typeof useBaseAssetGate>) {
    const pending = gate.gatedAction(() => {
        throw new Error('must not run')
    })
    await untilModalOpen(gate)
    gate.closeModal('cancel')
    return pending
}

beforeEach(() => {
    setActivePinia(createPinia())
    burnedByAddress.clear()
    reads = []
    failReads = false
    evmSigner.current = null
    forgetBurnReads()
    // The modal flag is module-level on purpose (one modal serves every
    // page), so it outlives a pinia swap and has to be cleared by hand.
    useBaseAssetGate().closeModal()
})

describe('the requirement', () => {
    it('is 1,000,000 whole AVXTO burned, not 1,000,000 wei', () => {
        // AVXTO_THR is whole tokens; the old holding check compared it to the
        // raw 18-decimal balance and so asked for 10^-12 AVXTO.
        expect(REQUIRED_BURN_WEI.eq(tokens(1_000_000))).toBe(true)
    })
})

describe('what counts as a shortfall', () => {
    it('does not gate while nothing has been read', () => {
        connectAvalanche()
        const { shortfall, isGated } = useBaseAssetGate()

        expect(shortfall.value).toBeNull()
        expect(isGated.value).toBe(false)
    })

    it('gates once a burn below the requirement has actually been read', async () => {
        connectAvalanche()
        burnedByAddress.set(AVALANCHE_ADDRESS, tokens(2000))
        const gate = useBaseAssetGate()

        expect(await gate.check()).toBe(false)
        expect(gate.shortfall.value).toBe(true)
        expect(gate.burned.value!.eq(tokens(2000))).toBe(true)
    })

    it('does not gate a burn at exactly the requirement', async () => {
        connectAvalanche()
        burnedByAddress.set(AVALANCHE_ADDRESS, REQUIRED_BURN_WEI)
        const gate = useBaseAssetGate()

        expect(await gate.check()).toBe(true)
        expect(gate.isGated.value).toBe(false)
    })

    it('ignores what is merely held — only burns count', async () => {
        // Holding plenty of AVXTO used to pass; now nothing but the Moats
        // burn figure is consulted, and this address has burned nothing.
        connectAvalanche()
        const gate = useBaseAssetGate()

        expect(await gate.check()).toBe(false)
    })

    /**
     * The regression that shipped once: a short user sees the page render
     * with the button ALREADY grey, clicks it, and nothing happens. Being
     * short is not by itself a reason to disable anything.
     */
    it('does not pre-disable the button just because the burn is short', async () => {
        connectAvalanche()
        const gate = useBaseAssetGate()
        await gate.check()

        expect(gate.isGated.value).toBe(true)
        expect(gate.isBlocked.value).toBe(false)
    })

    it("never lets one address's figure answer for another", async () => {
        connectAvalanche()
        burnedByAddress.set(AVALANCHE_ADDRESS, REQUIRED_BURN_WEI)
        const gate = useBaseAssetGate()
        await gate.check()
        expect(gate.isGated.value).toBe(false)

        // The session changes to a wallet nothing has been read for.
        useMainStore().activeWallet = { ethAddress: '33'.repeat(20) } as any
        expect(gate.shortfall.value).toBeNull()
    })
})

describe('whose burns are checked', () => {
    it("reads the Avalanche wallet's C-Chain address", async () => {
        connectAvalanche()
        await useBaseAssetGate().check()
        expect(reads).toEqual([AVALANCHE_ADDRESS])
    })

    it('falls back to the EVM platform address when there is no Avalanche wallet', async () => {
        // Before, such a session had no address to check and passed every gate.
        evmSigner.current = { address: EVM_ADDRESS }
        const gate = useBaseAssetGate()

        expect(await gate.check()).toBe(false)
        expect(reads).toEqual([EVM_ADDRESS])
    })

    it('allows the action when there is no wallet to assess', async () => {
        const gate = useBaseAssetGate()

        let ran = false
        expect(await gate.gatedAction(() => (ran = true))).toBe(true)
        expect(ran).toBe(true)
        expect(reads).toEqual([])
    })

    it('does not gate on a failed read', async () => {
        connectAvalanche()
        failReads = true
        const err = jest.spyOn(console, 'error').mockImplementation(() => {})
        const gate = useBaseAssetGate()

        expect(await gate.check()).toBe(true)
        err.mockRestore()
    })
})

describe('running a gated action', () => {
    it('runs the action and leaves the modal shut when the burn is there', async () => {
        connectAvalanche()
        burnedByAddress.set(AVALANCHE_ADDRESS, tokens(2_000_000))
        const { gatedAction, isModalOpen } = useBaseAssetGate()

        let ran = false
        expect(await gatedAction(() => (ran = true))).toBe(true)
        expect(ran).toBe(true)
        expect(isModalOpen.value).toBe(false)
    })

    it('opens the modal and does NOT run the action when short, then disables the button on cancel', async () => {
        connectAvalanche()
        const gate = useBaseAssetGate()
        expect(gate.isBlocked.value).toBe(false)

        expect(await clickAndCancel(gate)).toBe(false)

        expect(gate.isModalOpen.value).toBe(false)
        expect(gate.isBlocked.value).toBe(true)
    })

    /**
     * Leaving for moats.app to burn, or for the swap page to get AVXTO to
     * burn, is acting on the message — the control must not be dead when
     * they come back.
     */
    it.each(['burn', 'swap'] as const)(
        'does not disable the button when the user leaves to %s',
        async (outcome) => {
            connectAvalanche()
            const gate = useBaseAssetGate()

            const pending = gate.gatedAction(() => undefined)
            await untilModalOpen(gate)
            gate.closeModal(outcome)
            await pending

            expect(gate.isGated.value).toBe(true)
            expect(gate.isBlocked.value).toBe(false)
        }
    )

    /**
     * The read happens on every click rather than trusting the last one: a
     * burn completed a moment ago on moats.app has to count, and the
     * dismissed button comes back with nothing clearing it by hand.
     */
    it('re-reads on every click, so a burn made meanwhile unlocks the action', async () => {
        connectAvalanche()
        const gate = useBaseAssetGate()

        await clickAndCancel(gate)
        expect(gate.isBlocked.value).toBe(true)

        // The user burns on moats.app, comes back and clicks again.
        burnedByAddress.set(AVALANCHE_ADDRESS, REQUIRED_BURN_WEI)
        let ran = false
        expect(await gate.gatedAction(() => (ran = true))).toBe(true)

        expect(reads).toHaveLength(2)
        expect(ran).toBe(true)
        expect(gate.isBlocked.value).toBe(false)
    })

    it('shares one modal across every caller, since one is mounted for all of them', () => {
        const onPage = useBaseAssetGate()
        const onModal = useBaseAssetGate()

        onPage.openModal()
        expect(onModal.isModalOpen.value).toBe(true)

        onModal.closeModal()
        expect(onPage.isModalOpen.value).toBe(false)
    })
})
