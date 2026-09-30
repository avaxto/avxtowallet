/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Restaking: repeat one of the wallet's past delegations with one click.
 *
 * Two pure steps, kept here so they can be tested without a wallet or network:
 *
 *  1. `extractPastDelegations` — the wallet's delegations, read out of the
 *     P-chain transactions Glacier indexes for its addresses.
 *  2. `planRestake` — turn one of them into a new delegation that can actually
 *     be submitted *now*: same validator, amount, length and reward address,
 *     adjusted to today's balance, the validator's remaining time and capacity,
 *     and the network's minimum / 365-day bounds.
 *
 * The chosen delegation reaches Quick Delegate through `setRestakeSelection`,
 * an in-memory hand-over — deliberately not the URL. A prefilled reward
 * address is exactly what a malicious link would want to plant, and a
 * one-click submit is exactly what would make it work.
 */
import { BN } from '@/avalanche'
import { DAY_MS, MINUTE_MS, durationLabel } from '@/constants'
import type { ValidatorListItem } from '@/types'

/** Delegation transaction types: current (post-Durango) and legacy. */
const DELEGATION_TX_TYPES = new Set(['AddPermissionlessDelegatorTx', 'AddDelegatorTx'])

/** How far ahead of "now" a planned end must sit, to survive signing and block time. */
export const RESTAKE_SAFETY_MS = 15 * MINUTE_MS
const MAX_DELEGATION_MS = DAY_MS * 365

export interface PastDelegation {
    txHash: string
    nodeID: string
    /** nAVAX. */
    amount: BN
    /** Unix ms. */
    start: number
    /** Unix ms. */
    end: number
    /** P-chain address the rewards were paid to, "P-" prefixed; '' when the indexer omits it. */
    rewardAddress: string
    /** Whether `rewardAddress` is one of this wallet's own P-chain addresses. */
    rewardAddressIsOwn: boolean
}

const bare = (addr: string) => (addr.split('-')[1] || addr).trim().toLowerCase()

/**
 * The delegations among `txs` (raw Glacier P-chain transactions), newest
 * first, one per transaction.
 *
 * The reward address is Glacier's `rewardAddresses`; older records without it
 * fall back to the owner of the staked output, which is where this wallet's
 * delegations return their stake.
 */
export function extractPastDelegations(txs: any[], ownPAddresses: string[]): PastDelegation[] {
    const own = new Set(ownPAddresses.map(bare))
    const seen = new Set<string>()
    const out: PastDelegation[] = []

    for (const tx of txs) {
        if (!tx || !DELEGATION_TX_TYPES.has(tx.txType)) continue
        if (!tx.txHash || seen.has(tx.txHash)) continue
        if (!tx.nodeId || !tx.startTimestamp || !tx.endTimestamp) continue

        const staked = (Array.isArray(tx.amountStaked) ? tx.amountStaked : []).reduce(
            (sum: BN, a: any) => sum.add(new BN(String(a?.amount ?? '0'))),
            new BN(0)
        )
        if (staked.isZero()) continue

        const stakeOutput = (Array.isArray(tx.emittedUtxos) ? tx.emittedUtxos : []).find((u: any) => u?.staked)
        const reward: string =
            (Array.isArray(tx.rewardAddresses) && tx.rewardAddresses[0]) || stakeOutput?.addresses?.[0] || ''

        seen.add(tx.txHash)
        out.push({
            txHash: tx.txHash,
            nodeID: tx.nodeId,
            amount: staked,
            start: Number(tx.startTimestamp) * 1000,
            end: Number(tx.endTimestamp) * 1000,
            rewardAddress: reward ? `P-${bare(reward)}` : '',
            rewardAddressIsOwn: !!reward && own.has(bare(reward)),
        })
    }

    return out.sort((a, b) => b.start - a.start)
}

export interface RestakePlan {
    nodeID: string
    /** nAVAX. */
    amount: BN
    end: Date
    /** The validator's delegation fee, percent. */
    fee: number
    rewardAddress: string
    validator: ValidatorListItem | null
    /** Things the user should know before submitting; the plan is still valid. */
    notices: string[]
    /** Why this cannot be submitted as planned; empty when it can. */
    blockers: string[]
}

export interface RestakeContext {
    now: number
    /** Available (unlocked) P-chain balance, nAVAX. */
    available: BN
    /** Protocol minimum delegation, nAVAX. */
    minStake: BN
    /** The network's minimum delegation period, ms — see minDelegationDurationMs. */
    minDurationMs: number
    validators: ValidatorListItem[]
    /** This wallet's reward address, for past delegations the indexer has none for. */
    fallbackRewardAddress: string
}

const avax = (n: BN) => (Number(n.toString()) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 4 })

/** A submittable delegation modelled on `past` — see the module doc. */
export function planRestake(past: PastDelegation, ctx: RestakeContext): RestakePlan {
    const notices: string[] = []
    const blockers: string[] = []
    const validator = ctx.validators.find((v) => v.nodeID === past.nodeID) ?? null

    // Length: the same as last time, within the protocol's bounds.
    const minLabel = durationLabel(ctx.minDurationMs)
    const earliest = ctx.now + ctx.minDurationMs + RESTAKE_SAFETY_MS
    const latest = ctx.now + MAX_DELEGATION_MS - RESTAKE_SAFETY_MS
    const duration = past.end - past.start
    let end = Math.min(Math.max(ctx.now + duration, earliest), latest)
    if (end !== ctx.now + duration) {
        notices.push(`The period was adjusted to fit the ${minLabel} to 365-day delegation limits.`)
    }

    // Amount: the same as last time, if the balance still covers it.
    let amount = past.amount
    if (ctx.available.lt(amount)) {
        amount = ctx.available
        notices.push(
            `Your available P-Chain balance is below the ${avax(past.amount)} AVAX delegated last time, ` +
                `so this uses all ${avax(amount)} AVAX available.`
        )
    }
    if (amount.lt(ctx.minStake)) {
        blockers.push(`You need at least ${avax(ctx.minStake)} AVAX available on the P-Chain to delegate.`)
    }

    if (!validator) {
        blockers.push(`${past.nodeID} is not an active validator any more.`)
    } else {
        // A delegation cannot outlast its validator.
        const validatorEnd = validator.endTime.getTime()
        if (validatorEnd < end) {
            if (validatorEnd < earliest) {
                blockers.push(`This validator stops validating in less than ${minLabel}.`)
            } else {
                end = validatorEnd
                notices.push(`Shortened to end with the validator on ${new Date(validatorEnd).toLocaleDateString()}.`)
            }
        }
        if (validator.remainingStake.lt(amount)) {
            blockers.push(`This validator can only accept ${avax(validator.remainingStake)} AVAX more.`)
        }
    }

    let rewardAddress = past.rewardAddress
    if (!rewardAddress) {
        rewardAddress = ctx.fallbackRewardAddress
        notices.push("The indexer didn't record last time's reward address, so rewards go to this wallet.")
    } else if (!past.rewardAddressIsOwn) {
        notices.push(`Rewards go to ${rewardAddress}, which is not an address of this wallet — as last time.`)
    }

    return {
        nodeID: past.nodeID,
        amount,
        end: new Date(end),
        fee: validator?.fee ?? 0,
        rewardAddress,
        validator,
        notices,
        blockers,
    }
}

// ─── Hand-over to Quick Delegate ────────────────────────────────────────────

let pending: PastDelegation | null = null

/** Hands `past` to the next Quick Delegate page to open. See the module doc. */
export function setRestakeSelection(past: PastDelegation): void {
    pending = past
}

/** Takes the pending selection, once. */
export function takeRestakeSelection(): PastDelegation | null {
    const p = pending
    pending = null
    return p
}
