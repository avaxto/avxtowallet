/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Restake: reading past delegations out of Glacier's P-chain history, and
 * planning a new delegation from one that can be submitted as-is.
 */
import { BN } from '@/avalanche'
import {
    extractPastDelegations,
    planRestake,
    setRestakeSelection,
    takeRestakeSelection,
    RESTAKE_SAFETY_MS,
    type PastDelegation,
    type RestakeContext,
} from '@/js/restake'
import type { ValidatorListItem } from '@/types'

const DAY = 86_400_000
const AVAX = (n: number) => new BN(String(Math.round(n * 1e9)))
const NODE = 'NodeID-3DyUWkRptB3CRUVHk39Ni6Dpr6QvGWXwA'
const OWN = 'P-avax1tnuesf6cqwnjw7fxjyk7lhch0vhf0v95wj5jvy'

/** The shape Glacier returns for a post-Durango delegation (from a live mainnet record). */
function glacierDelegation(over: Record<string, unknown> = {}) {
    return {
        txHash: 'Tv2cvzrLcra5VzrPCBwn6BB6oqW2nAhV8TgAaavovaYvTUtQ3',
        txType: 'AddPermissionlessDelegatorTx',
        blockTimestamp: 1789403476,
        rewardAddresses: ['avax19zfygxaf59stehzedhxjesads0p5jdvfeedal0'],
        startTimestamp: 1789403476,
        endTimestamp: 1790710170,
        nodeId: NODE,
        emittedUtxos: [
            { addresses: ['avax1tnuesf6cqwnjw7fxjyk7lhch0vhf0v95wj5jvy'], staked: false, amount: '160032392636' },
            { addresses: ['avax1tnuesf6cqwnjw7fxjyk7lhch0vhf0v95wj5jvy'], staked: true, amount: '363398048984' },
        ],
        amountStaked: [{ assetId: 'FvwE', amount: '363398048984' }],
        ...over,
    }
}

describe('extractPastDelegations', () => {
    it('reads node, amount, period and reward address out of a delegation', () => {
        const [d] = extractPastDelegations([glacierDelegation()], [OWN])
        expect(d.nodeID).toBe(NODE)
        expect(d.amount.toString()).toBe('363398048984')
        expect(d.start).toBe(1789403476000)
        expect(d.end).toBe(1790710170000)
        expect(d.rewardAddress).toBe('P-avax19zfygxaf59stehzedhxjesads0p5jdvfeedal0')
        // Rewards went to an address that isn't one of the wallet's.
        expect(d.rewardAddressIsOwn).toBe(false)
    })

    it('recognises a reward address of the wallet itself, with or without the P- prefix', () => {
        const tx = glacierDelegation({ rewardAddresses: ['avax1tnuesf6cqwnjw7fxjyk7lhch0vhf0v95wj5jvy'] })
        expect(extractPastDelegations([tx], [OWN])[0].rewardAddressIsOwn).toBe(true)
        expect(extractPastDelegations([tx], [OWN.slice(2)])[0].rewardAddressIsOwn).toBe(true)
    })

    it('falls back to the staked output owner when the indexer has no reward address', () => {
        const [d] = extractPastDelegations([glacierDelegation({ rewardAddresses: undefined })], [OWN])
        expect(d.rewardAddress).toBe(OWN)
        expect(d.rewardAddressIsOwn).toBe(true)
    })

    it('keeps only delegations, once each, newest first — legacy AddDelegatorTx included', () => {
        const older = glacierDelegation({ txHash: 'old', txType: 'AddDelegatorTx', startTimestamp: 1700000000 })
        const list = extractPastDelegations(
            [
                older,
                { txHash: 'x', txType: 'ExportTx' },
                glacierDelegation({ txType: 'AddPermissionlessValidatorTx', txHash: 'val' }),
                glacierDelegation(),
                glacierDelegation(), // duplicate from a second address batch
            ],
            [OWN]
        )
        expect(list.map((d) => d.txHash)).toEqual(['Tv2cvzrLcra5VzrPCBwn6BB6oqW2nAhV8TgAaavovaYvTUtQ3', 'old'])
    })
})

const NOW = Date.UTC(2026, 8, 29)

function validator(over: Partial<ValidatorListItem> = {}): ValidatorListItem {
    return {
        nodeID: NODE,
        validatorStake: AVAX(2000),
        delegatedStake: AVAX(1000),
        remainingStake: AVAX(5000),
        numDelegators: 20,
        startTime: new Date(NOW - 100 * DAY),
        endTime: new Date(NOW + 200 * DAY),
        uptime: 0.99,
        fee: 2,
        ...over,
    }
}

function past(over: Partial<PastDelegation> = {}): PastDelegation {
    return {
        txHash: 'tx',
        nodeID: NODE,
        amount: AVAX(100),
        start: NOW - 30 * DAY,
        end: NOW - 2 * DAY, // a 28-day delegation that has ended
        rewardAddress: OWN,
        rewardAddressIsOwn: true,
        ...over,
    }
}

function ctx(over: Partial<RestakeContext> = {}): RestakeContext {
    return {
        now: NOW,
        available: AVAX(150),
        minStake: AVAX(25),
        minDurationMs: 14 * DAY, // mainnet
        validators: [validator()],
        fallbackRewardAddress: 'P-avax1fallback',
        ...over,
    }
}

describe('planRestake', () => {
    it('repeats the delegation: same node, amount, length, reward address, and the validator fee', () => {
        const plan = planRestake(past(), ctx())
        expect(plan.blockers).toEqual([])
        expect(plan.notices).toEqual([])
        expect(plan.nodeID).toBe(NODE)
        expect(plan.amount.toString()).toBe(AVAX(100).toString())
        expect(plan.end.getTime()).toBe(NOW + 28 * DAY)
        expect(plan.rewardAddress).toBe(OWN)
        expect(plan.fee).toBe(2)
    })

    it('uses what is available when the balance no longer covers the old amount', () => {
        const plan = planRestake(past(), ctx({ available: AVAX(60) }))
        expect(plan.amount.toString()).toBe(AVAX(60).toString())
        expect(plan.blockers).toEqual([])
        expect(plan.notices.join(' ')).toMatch(/uses all 60 AVAX/)
    })

    it('blocks when the available balance is under the minimum stake', () => {
        const plan = planRestake(past(), ctx({ available: AVAX(10) }))
        expect(plan.blockers.join(' ')).toMatch(/at least 25 AVAX/)
    })

    it("stretches a too-short period to the network's minimum, with room to sign", () => {
        // A 3-day delegation (fine on Fuji) is below mainnet's 14 days.
        const plan = planRestake(past({ start: NOW - 5 * DAY, end: NOW - 2 * DAY }), ctx())
        expect(plan.end.getTime()).toBe(NOW + 14 * DAY + RESTAKE_SAFETY_MS)
        expect(plan.notices.join(' ')).toMatch(/14 days to 365-day/)

        const fuji = planRestake(past({ start: NOW - 5 * DAY, end: NOW - 2 * DAY }), ctx({ minDurationMs: DAY }))
        expect(fuji.end.getTime()).toBe(NOW + 3 * DAY)
    })

    it('ends with the validator when it stops validating first', () => {
        const plan = planRestake(past(), ctx({ validators: [validator({ endTime: new Date(NOW + 20 * DAY) })] }))
        expect(plan.end.getTime()).toBe(NOW + 20 * DAY)
        expect(plan.blockers).toEqual([])
    })

    it('blocks when the validator is gone, ends before the minimum period, or is full', () => {
        expect(planRestake(past(), ctx({ validators: [] })).blockers.join(' ')).toMatch(/not an active validator/)
        expect(
            planRestake(past(), ctx({ validators: [validator({ endTime: new Date(NOW + 10 * DAY) })] })).blockers.join(' ')
        ).toMatch(/less than 14 days/)
        expect(
            planRestake(past(), ctx({ validators: [validator({ remainingStake: AVAX(50) })] })).blockers.join(' ')
        ).toMatch(/only accept 50 AVAX/)
    })

    it('says so when rewards go outside the wallet, and uses this wallet when none was recorded', () => {
        const external = planRestake(past({ rewardAddress: 'P-avax1other', rewardAddressIsOwn: false }), ctx())
        expect(external.rewardAddress).toBe('P-avax1other')
        expect(external.notices.join(' ')).toMatch(/not an address of this wallet/)

        const none = planRestake(past({ rewardAddress: '', rewardAddressIsOwn: false }), ctx())
        expect(none.rewardAddress).toBe('P-avax1fallback')
    })
})

describe('restake hand-over', () => {
    it('is taken once', () => {
        setRestakeSelection(past())
        expect(takeRestakeSelection()?.txHash).toBe('tx')
        expect(takeRestakeSelection()).toBeNull()
    })
})
