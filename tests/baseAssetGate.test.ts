/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The base-asset holding requirement, as a per-action gate.
 *
 * The behaviour that matters here is the three-valued answer, not the two
 * obvious ones. A balance that has never been read is indistinguishable by
 * value from a balance of zero, and the gate has to treat those differently:
 * "not read yet" must NOT disable anything, or every holder is locked out of
 * every gated action for the first seconds of every session, and the page
 * they are looking at lies to them about why.
 *
 * The rest of the file pins the cancel path, which is the whole point of the
 * redesign: the action does not run, the user does not move, and the button
 * behind the modal ends up disabled — but only AFTER the message has been
 * shown and dismissed. That ordering is load-bearing and was got wrong once:
 * binding `:disabled` to the shortfall itself produces a button that is grey
 * from first render and, because a disabled button fires no click event,
 * can never open the modal that would explain why. `isBlocked` is the
 * binding; `isGated` alone is not.
 */
import { createPinia, setActivePinia } from 'pinia'
import { BN } from '@/avalanche'

import { useAssetsStore } from '@/stores/assets'
import { useMainStore } from '@/stores/main'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'

const BASE_ADDRESS = '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D'
const THRESHOLD = new BN(1000000)

/**
 * Stands in for an `Erc20Token`. The gate reads exactly four things off one —
 * `data.address`, `balanceFetched`, `balanceBN` and `updateBalance` — so a
 * real instance would only add a web3 contract this never calls.
 */
function fakeToken(balance: BN | null) {
    return {
        data: { address: BASE_ADDRESS, chainId: 43114, decimals: 18 },
        balanceBN: balance ?? new BN(0),
        balanceFetched: balance !== null,
        updateCalls: 0,
        async updateBalance() {
            this.updateCalls++
            this.balanceFetched = true
        },
    }
}

/** Registers a base asset, and optionally a token holding `balance`. */
function setUp(balance: BN | null, opts: { withBaseAsset?: boolean } = {}) {
    const assets = useAssetsStore()
    if (opts.withBaseAsset !== false) {
        assets.baseAsset = {
            address: BASE_ADDRESS,
            chainId: 43114,
            name: 'AVAX Toolbox',
            symbol: 'AVXTO',
            decimals: 18,
            logoURI: '',
            thr: THRESHOLD,
        }
    }
    const token = fakeToken(balance)
    if (balance !== null || opts.withBaseAsset !== false) {
        assets.erc20Tokens.push(token as any)
    }
    // Read it back through the store so the test holds the same reactive
    // proxy the composable will, not the raw object.
    const registered = assets.erc20Tokens[assets.erc20Tokens.length - 1] as any
    return { assets, token: registered }
}

/**
 * Gives the session an eth address, so `check()` has something to read the
 * balance against. Set through `activeWallet`'s setter, which writes the same
 * ref `avalancheWallet` reads — the gate deliberately reads the ungated one.
 */
function connectWallet() {
    useMainStore().activeWallet = { ethAddress: '11'.repeat(20) } as any
}

/**
 * Lets `gatedAction` run as far as opening the modal.
 *
 * `check()` awaits a balance read before it decides, so the modal is several
 * microtask hops away from the call — closing it before it is open would
 * settle nothing and park the action forever. Everything in that path is
 * promise-based (no timers), so draining the microtask queue is enough.
 */
async function untilModalOpen(gate: ReturnType<typeof useBaseAssetGate>) {
    for (let i = 0; i < 50 && !gate.isModalOpen.value; i++) await Promise.resolve()
    expect(gate.isModalOpen.value).toBe(true)
}

beforeEach(() => {
    setActivePinia(createPinia())
    // The modal flag is module-level on purpose (one modal serves every
    // page), so it outlives a pinia swap and has to be cleared by hand.
    useBaseAssetGate().closeModal()
})

describe('what counts as a shortfall', () => {
    it('does not gate while the balance has never been read', () => {
        setUp(null)
        const { shortfall, isGated } = useBaseAssetGate()

        expect(shortfall.value).toBeNull()
        expect(isGated.value).toBe(false)
    })

    it('gates once a balance below the threshold has actually been read', () => {
        setUp(new BN(5))
        const { shortfall, isGated } = useBaseAssetGate()

        expect(shortfall.value).toBe(true)
        expect(isGated.value).toBe(true)
    })

    /**
     * The regression that shipped: a user who is short sees the page render
     * with the button ALREADY grey, clicks it, and nothing happens — no
     * modal, no explanation, because a disabled button fires no click event.
     * Being short is not by itself a reason to disable anything.
     */
    it('does not pre-disable the button just because the holding is short', () => {
        setUp(new BN(5))
        const { isGated, isBlocked } = useBaseAssetGate()

        expect(isGated.value).toBe(true)
        expect(isBlocked.value).toBe(false)
    })

    it('does not gate a balance at or above the threshold', () => {
        setUp(THRESHOLD)
        const { isGated } = useBaseAssetGate()

        // Exactly the threshold is enough — the requirement is a minimum to
        // hold, not a minimum to exceed.
        expect(isGated.value).toBe(false)
    })

    it('does not gate when no base asset is configured at all', () => {
        setUp(null, { withBaseAsset: false })
        const { shortfall, isGated } = useBaseAssetGate()

        expect(shortfall.value).toBeNull()
        expect(isGated.value).toBe(false)
    })

    it('re-answers on its own once the balance changes', async () => {
        const { token } = setUp(new BN(5))
        const { isGated } = useBaseAssetGate()
        expect(isGated.value).toBe(true)

        // What a completed swap looks like from here: the same token's
        // balance is refreshed in place. Nothing has to remember to clear a
        // "was gated" flag, because there isn't one.
        token.balanceBN = THRESHOLD.add(new BN(1))
        expect(isGated.value).toBe(false)
    })
})

describe('running a gated action', () => {
    it('runs the action and leaves the modal shut when the holding is there', async () => {
        setUp(THRESHOLD)
        const { gatedAction, isModalOpen } = useBaseAssetGate()

        let ran = false
        const allowed = await gatedAction(() => {
            ran = true
        })

        expect(allowed).toBe(true)
        expect(ran).toBe(true)
        expect(isModalOpen.value).toBe(false)
    })

    it('opens the modal and does NOT run the action when short', async () => {
        setUp(new BN(5))
        const { gatedAction, isModalOpen, closeModal } = useBaseAssetGate()

        let ran = false
        const gate = useBaseAssetGate()
        const pending = gatedAction(() => {
            ran = true
        })
        // The modal is up and the promise is parked on it until it closes.
        await untilModalOpen(gate)
        expect(isModalOpen.value).toBe(true)

        closeModal('cancel')
        expect(await pending).toBe(false)
        expect(ran).toBe(false)
    })

    /**
     * The cancel path, which is the requirement this redesign exists for: the
     * user stays where they are, and the button they pressed is disabled
     * afterwards — by the same `isGated` the check just resolved, not by any
     * separate bookkeeping the page has to do.
     *
     * Starts from "never read", so the click itself is what learns the
     * answer: before it, nothing is disabled.
     */
    it('learns the shortfall from the click, so the button disables itself', async () => {
        const { token } = setUp(null)
        connectWallet()
        const gate = useBaseAssetGate()

        // Before the click nothing is known, so nothing is disabled.
        expect(gate.isGated.value).toBe(false)

        const pending = gate.gatedAction(() => {
            throw new Error('must not run')
        })
        await untilModalOpen(gate)

        expect(token.updateCalls).toBe(1)
        expect(gate.isModalOpen.value).toBe(true)
        gate.closeModal('cancel')
        await pending

        // Cancelled — and the button behind the modal is now disabled.
        expect(gate.isModalOpen.value).toBe(false)
        expect(gate.isBlocked.value).toBe(true)
    })

    /**
     * Leaving for the swap page is the user acting on the message, not
     * dismissing it — they are expected back holding some, and must not find
     * the control they came from dead when they get there.
     */
    it('does not disable the button when the user leaves for the swap page', async () => {
        setUp(new BN(5))
        connectWallet()
        const gate = useBaseAssetGate()

        const pending = gate.gatedAction(() => undefined)
        await untilModalOpen(gate)
        gate.closeModal('swap')
        await pending

        expect(gate.isGated.value).toBe(true)
        expect(gate.isBlocked.value).toBe(false)
    })

    /**
     * And once the holding actually arrives the button comes back on its own,
     * with nothing having to remember to clear the dismissal.
     */
    it('re-enables a dismissed button once the holding arrives', async () => {
        const { token } = setUp(new BN(5))
        connectWallet()
        const gate = useBaseAssetGate()

        const pending = gate.gatedAction(() => undefined)
        await untilModalOpen(gate)
        gate.closeModal('cancel')
        await pending
        expect(gate.isBlocked.value).toBe(true)

        token.balanceBN = THRESHOLD
        expect(gate.isBlocked.value).toBe(false)
    })

    /**
     * The read is what the decision rests on, so it happens every time rather
     * than trusting the last one: a swap completed a moment ago on
     * /wallet/swap has to count.
     */
    it('re-reads the balance on every check rather than trusting the last one', async () => {
        const { token } = setUp(new BN(5))
        connectWallet()
        const gate = useBaseAssetGate()

        const refused = gate.gatedAction(() => undefined)
        await untilModalOpen(gate)
        gate.closeModal('cancel')
        await refused
        expect(token.updateCalls).toBe(1)

        // The holding arrives between the two clicks.
        token.balanceBN = THRESHOLD

        let ran = false
        const allowed = await gate.gatedAction(() => {
            ran = true
        })

        expect(token.updateCalls).toBe(2)
        expect(allowed).toBe(true)
        expect(ran).toBe(true)
        expect(gate.isModalOpen.value).toBe(false)
    })

    /**
     * With no session there is nothing to read a balance from, and nothing to
     * gate either — the gated pages only exist behind a connected wallet.
     * Refusing here would block on an answer that cannot be obtained.
     */
    it('allows the action when there is no wallet to assess', async () => {
        setUp(null)
        const gate = useBaseAssetGate()

        let ran = false
        const allowed = await gate.gatedAction(() => {
            ran = true
        })

        expect(allowed).toBe(true)
        expect(ran).toBe(true)
        expect(gate.isModalOpen.value).toBe(false)
    })

    it('shares one modal across every caller, since one is mounted for all of them', () => {
        setUp(new BN(5))
        const onPage = useBaseAssetGate()
        const onModal = useBaseAssetGate()

        onPage.openModal()
        expect(onModal.isModalOpen.value).toBe(true)

        onModal.closeModal()
        expect(onPage.isModalOpen.value).toBe(false)
    })
})
