/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Burning, staking and locking AVXTO through the Moats contract (moats.app).
 *
 * All three go through the `MultiLockMoat` contract at `MOATS_CONTRACT_ADDRESS`
 * (verified source on Snowtrace/Routescan), never a plain transfer: it
 * `transferFrom`s the amount out of the caller and credits points to them.
 * Confirmed against real transactions:
 *   - burn(1000e18), tx 0x226aa700…57dc: Transfer user -> Moats, Transfer
 *     Moats -> 0xdEaD, then Moats' own `Burned(user, amount)`.
 *   - stake(1000000e18), tx 0x62be4f51…9e74: Transfer user -> Moats, then
 *     Moats' own `Staked(user, amount)`. The tokens stay in the contract.
 *   - lock(1234567e18, 730 days), tx 0x5a12026c…ddf4: Transfer user -> Moats,
 *     then `Locked(user, amount, duration, lockIndex)`. Each lock is its own
 *     entry with its own end time; the tokens stay in the contract.
 *
 * Because the contract pulls the tokens, it needs an ERC-20 allowance first.
 * This approves exactly the amount being moved, never "unlimited" (which is
 * what moats.app itself asks for): an unbounded approval to a contract with
 * an admin would outlive this one action for no benefit to the user.
 *
 * The contract's own rules, mirrored by `validateMoatsAmount` so the user
 * sees the reason before signing instead of an opaque revert:
 *   - `burningEnabled` / `stakingEnabled` / `lockingEnabled`, and not `paused`
 *   - a lock lasts between 1 and 730 days
 *   - amount >= `MIN_STAKE_AMOUNT` (10^12 wei for an 18-decimal token)
 *   - amount <= the caller's balance
 * Every action also pays out any pending Moats rewards
 * (`_harvestAllRewards`). Unstaking later costs `unstakeFee` basis points.
 * Exiting a lock early costs max(unstakeFee, 95% x remaining / original
 * duration) — nearly everything, right after locking — see `earlyExitFeeBps`.
 */
import Big from 'big.js'

import { BN } from '@/avalanche'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import type { EvmSigner } from '@/evm/signer'
import { isOfflineTxId } from '@/stores/offlineSigning'

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

export const MOATS_CONTRACT_ADDRESS = '0xebe5fbacb882fd313d05684bef591c31f83b0524'
/** The Moats contract exists on Avalanche C-Chain mainnet only. */
export const MOATS_CHAIN_ID = 43114

export type MoatsMode = 'burn' | 'stake' | 'lock'

export const DAY_SECONDS = 86_400
/** The contract's MIN_LOCK_DURATION / MAX_LOCK_DURATION, in days. */
export const MIN_LOCK_DAYS = 1
export const MAX_LOCK_DAYS = 730
/** The contract's EARLY_EXIT_MAX_FEE, in basis points. */
export const EARLY_EXIT_MAX_FEE_BPS = 9500

const view = (name: string, type: string, inputs: { name: string; type: string }[] = []) => ({
    name,
    type: 'function',
    stateMutability: 'view',
    inputs,
    outputs: [{ name: '', type }],
})

const write = (name: string, extra: { name: string; type: string }[] = []) => ({
    name,
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_amount', type: 'uint256' }, ...extra],
    outputs: [],
})

/** The slice of `MultiLockMoat`'s ABI this feature touches. */
const MOATS_ABI = [
    write('burn'),
    write('stake'),
    write('lock', [{ name: '_duration', type: 'uint256' }]),
    {
        name: 'getUserAllLocks',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '_user', type: 'address' }],
        outputs: [
            { name: 'amounts', type: 'uint256[]' },
            { name: 'ends', type: 'uint256[]' },
            { name: 'points', type: 'uint256[]' },
            { name: 'originalDurations', type: 'uint256[]' },
            { name: 'lastUpdated', type: 'uint256[]' },
            { name: 'active', type: 'bool[]' },
        ],
    },
    {
        name: 'userInfo',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [
            { name: 'stakedAmount', type: 'uint256' },
            { name: 'totalUserBurn', type: 'uint256' },
            { name: 'stakingPoints', type: 'uint256' },
            { name: 'burnPoints', type: 'uint256' },
            { name: 'activeLockCount', type: 'uint256' },
        ],
    },
    view('totalBurned', 'uint256'),
    view('totalStaked', 'uint256'),
    view('totalLocked', 'uint256'),
    view('MIN_STAKE_AMOUNT', 'uint256'),
    view('unstakeFee', 'uint256'),
    view('burningEnabled', 'bool'),
    view('stakingEnabled', 'bool'),
    view('lockingEnabled', 'bool'),
    view('paused', 'bool'),
    view('stakingToken', 'address'),
]

export interface MoatsLock {
    /** Position in the contract's lock list — what exitLock takes. */
    index: number
    amount: BN
    /** Unix seconds. */
    end: number
    /** Unix seconds. */
    originalDuration: number
}

export interface MoatsState {
    decimals: number
    /** AVXTO the signer holds, in wei. */
    balance: BN
    /** What the Moats contract may already pull from the signer, in wei. */
    allowance: BN
    /** Lifetime AVXTO this address has burned through Moats, in wei. */
    userBurned: BN
    /** AVXTO this address currently has staked (not locked) in Moats, in wei. */
    userStaked: BN
    /** Lifetime AVXTO burned through Moats by everyone, in wei. */
    totalBurned: BN
    /** AVXTO currently staked in Moats by everyone, in wei. */
    totalStaked: BN
    /** This address's active locks, oldest first. */
    userLocks: MoatsLock[]
    /** Sum of `userLocks`, in wei. */
    userLocked: BN
    /** AVXTO currently locked in Moats by everyone, in wei. */
    totalLocked: BN
    minAmount: BN
    /** Charged on unstake, in basis points (50 = 0.5%). */
    unstakeFeeBps: number
    burningEnabled: boolean
    stakingEnabled: boolean
    lockingEnabled: boolean
    paused: boolean
}

// Built from a local web3, deliberately — see the note on `erc20()` in
// js/ArenaSwap.ts: `new signer.reader().eth.Contract` parses wrongly.
function moats(signer: EvmSigner) {
    const web3 = signer.reader()
    return new web3.eth.Contract(MOATS_ABI as any, MOATS_CONTRACT_ADDRESS)
}

function avxto(signer: EvmSigner) {
    const web3 = signer.reader()
    // @ts-ignore - web3 typing for dynamic ABI
    return new web3.eth.Contract(ERC20Abi.abi as any, AVXTO_CONTRACT_ADDRESS)
}

const toBN = (v: unknown): BN => new BN(String(v))

/** Throws unless `signer` is on the one chain the Moats contract exists on. */
export function assertMoatsChain(signer: EvmSigner): void {
    if (signer.network.evmChainId !== MOATS_CHAIN_ID) {
        throw new Error(
            `Moats is on Avalanche C-Chain. Your wallet is on ${signer.network.name}.`
        )
    }
}

export async function readMoatsState(signer: EvmSigner): Promise<MoatsState> {
    assertMoatsChain(signer)
    const m = moats(signer).methods
    const t = avxto(signer).methods
    const me = signer.address

    const [
        decimals,
        balance,
        allowance,
        info,
        totalBurned,
        totalStaked,
        totalLocked,
        locks,
        minAmount,
        unstakeFee,
        burningEnabled,
        stakingEnabled,
        lockingEnabled,
        paused,
    ] = await Promise.all([
        t.decimals().call(),
        t.balanceOf(me).call(),
        t.allowance(me, MOATS_CONTRACT_ADDRESS).call(),
        m.userInfo(me).call(),
        m.totalBurned().call(),
        m.totalStaked().call(),
        m.totalLocked().call(),
        m.getUserAllLocks(me).call(),
        m.MIN_STAKE_AMOUNT().call(),
        m.unstakeFee().call(),
        m.burningEnabled().call(),
        m.stakingEnabled().call(),
        m.lockingEnabled().call(),
        m.paused().call(),
    ])

    const l = locks as any
    const userLocks: MoatsLock[] = ((l.amounts ?? l[0]) as unknown[])
        .map((amount, index) => ({
            index,
            amount: toBN(amount),
            end: Number((l.ends ?? l[1])[index]),
            originalDuration: Number((l.originalDurations ?? l[3])[index]),
            active: Boolean((l.active ?? l[5])[index]),
        }))
        // Exited locks stay in the contract's list with amount 0.
        .filter((x) => x.active && !x.amount.isZero())
        .map(({ active, ...lock }) => lock)

    return {
        decimals: Number(decimals),
        balance: toBN(balance),
        allowance: toBN(allowance),
        userBurned: toBN((info as any).totalUserBurn ?? (info as any)[1]),
        userStaked: toBN((info as any).stakedAmount ?? (info as any)[0]),
        totalBurned: toBN(totalBurned),
        totalStaked: toBN(totalStaked),
        userLocks,
        userLocked: userLocks.reduce((sum, x) => sum.add(x.amount), new BN(0)),
        totalLocked: toBN(totalLocked),
        minAmount: toBN(minAmount),
        unstakeFeeBps: Number(unstakeFee),
        burningEnabled: Boolean(burningEnabled),
        stakingEnabled: Boolean(stakingEnabled),
        lockingEnabled: Boolean(lockingEnabled),
        paused: Boolean(paused),
    }
}

/**
 * A user-typed decimal amount as wei. Strict: digits with an optional
 * fraction no longer than `decimals` — no exponents, signs or separators,
 * since a misparsed amount here is burned or locked up rather than merely
 * misspent. Returns null for anything else.
 */
export function parseTokenAmount(input: string, decimals: number): BN | null {
    const s = input.trim()
    if (!/^\d+(\.\d+)?$/.test(s)) return null
    const [whole, frac = ''] = s.split('.')
    if (frac.length > decimals) return null
    return new BN(whole + frac.padEnd(decimals, '0'), 10)
}

/** Wei as a plain decimal string, trailing zeros trimmed. */
export function formatTokenAmount(wei: BN, decimals: number): string {
    return Big(wei.toString()).div(Big(10).pow(decimals)).toFixed()
}

/**
 * The points multiplier a lock of `durationSec` earns — the contract's
 * `calculateLockMultiplier`: 2x plus up to 3x more with the square root of
 * the fraction of 730 days, reaching 5x at the maximum. For display only; the
 * contract computes the real figure.
 */
export function lockMultiplier(durationSec: number): number {
    const max = MAX_LOCK_DAYS * DAY_SECONDS
    if (durationSec >= max) return 5
    return 2 + 3 * Math.sqrt(Math.max(0, durationSec) / max)
}

/**
 * What exiting a lock early would cost, in basis points, with
 * `remainingSec` of `originalSec` left — the contract's
 * `calculateEarlyExitFee`. Never below the plain unstake fee.
 */
export function earlyExitFeeBps(
    remainingSec: number,
    originalSec: number,
    unstakeFeeBps: number
): number {
    const timeFee = Math.floor((remainingSec * EARLY_EXIT_MAX_FEE_BPS) / originalSec)
    return Math.max(timeFee, unstakeFeeBps)
}

/** Why a lock of `days` would be refused by the contract, or null when it would not. */
export function validateLockDays(days: number): string | null {
    if (!Number.isInteger(days)) return 'Enter the lock duration in whole days.'
    if (days < MIN_LOCK_DAYS) return `The shortest lock is ${MIN_LOCK_DAYS} day.`
    if (days > MAX_LOCK_DAYS) return `The longest lock is ${MAX_LOCK_DAYS} days.`
    return null
}

/** Why `amount` would be refused by the contract, or null when it would not. */
export function validateMoatsAmount(
    mode: MoatsMode,
    amount: BN | null,
    state: MoatsState
): string | null {
    if (state.paused) return 'The Moats contract is paused.'
    if (mode === 'burn' && !state.burningEnabled) return 'Burning is currently disabled on Moats.'
    if (mode === 'stake' && !state.stakingEnabled) return 'Staking is currently disabled on Moats.'
    if (mode === 'lock' && !state.lockingEnabled) return 'Locking is currently disabled on Moats.'
    if (!amount || amount.isZero()) return `Enter an amount to ${mode}.`
    if (amount.lt(state.minAmount)) {
        return `The minimum is ${formatTokenAmount(state.minAmount, state.decimals)} AVXTO.`
    }
    if (amount.gt(state.balance)) return 'That is more AVXTO than this wallet holds.'
    return null
}

export interface MoatsResult {
    /** Set when an approval had to be sent first. */
    approveTxHash: string | null
    actionTxHash: string
    /** True when offline signing captured the transactions instead of sending them. */
    offline: boolean
}

/**
 * Gas fallbacks, used when a node refuses to estimate — always the case when
 * offline-captured behind an approval that has not happened yet. Observed:
 * burn 228k (first) / 102k, stake 124k, lock 259k (first).
 */
const ACTION_GAS_FALLBACK: Record<MoatsMode, number> = {
    burn: 350_000,
    stake: 250_000,
    lock: 400_000,
}

const ACTION_LABEL: Record<MoatsMode, string> = {
    burn: 'Burn AVXTO on Moats',
    stake: 'Stake AVXTO on Moats',
    lock: 'Lock AVXTO on Moats',
}

export interface MoatsActionOptions {
    /** Required for `lock`: how long, in whole days. */
    lockDays?: number
}

/**
 * Approve (only if needed), then burn, stake or lock. Run inside an
 * `authorizeBatch` scope so a phrase-opened wallet asks for its password once
 * for both signatures.
 *
 * The approval is waited on before the action is sent: the action's
 * `transferFrom` reverts without it, so sending both back-to-back would
 * estimate against pre-approval state and could leave a failed approval
 * followed by an action that is certain to revert.
 */
export async function runMoatsAction(
    signer: EvmSigner,
    mode: MoatsMode,
    amount: BN,
    opts: MoatsActionOptions = {}
): Promise<MoatsResult> {
    assertMoatsChain(signer)

    // Checked before anything is sent, so a bad duration cannot leave an
    // approval behind for a lock that was never going to go through.
    let actionArgs: string[] = [amount.toString()]
    if (mode === 'lock') {
        const days = opts.lockDays ?? NaN
        const invalid = validateLockDays(days)
        if (invalid) throw new Error(invalid)
        actionArgs = [amount.toString(), String(days * DAY_SECONDS)]
    }

    // The Moats address is hardcoded, so confirm it really is AVXTO's moat
    // before handing it an allowance.
    const staking = String(await moats(signer).methods.stakingToken().call())
    if (staking.toLowerCase() !== AVXTO_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error('The Moats contract is not for AVXTO. Refusing to continue.')
    }

    await signer.assertOnChain()

    const allowance = toBN(
        await avxto(signer).methods.allowance(signer.address, MOATS_CONTRACT_ADDRESS).call()
    )

    let approveTxHash: string | null = null
    let nonce: number | undefined
    let offline = false

    if (allowance.lt(amount)) {
        const approve = {
            to: AVXTO_CONTRACT_ADDRESS,
            data: avxto(signer)
                .methods.approve(MOATS_CONTRACT_ADDRESS, amount.toString())
                .encodeABI(),
            label: `Approve Moats to ${mode} AVXTO`,
        }
        const baseNonce = await signer.getNonce()
        const gasLimit = await signer.estimateGas(approve, 80_000)
        approveTxHash = await signer.send({ ...approve, gasLimit, nonce: baseNonce })

        if (isOfflineTxId(approveTxHash)) {
            // Nothing was broadcast, so there is no receipt to wait for; the
            // action is captured right behind it on the next nonce.
            offline = true
            nonce = baseNonce + 1
        } else {
            const receipt = await signer.waitForReceipt(approveTxHash)
            if (!receipt.status) throw new Error('The approval transaction failed.')
        }
    }

    const action = {
        to: MOATS_CONTRACT_ADDRESS,
        data: moats(signer).methods[mode](...actionArgs).encodeABI(),
        label: ACTION_LABEL[mode],
        nonce,
    }
    const gasLimit = await signer.estimateGas(action, ACTION_GAS_FALLBACK[mode])
    const actionTxHash = await signer.send({ ...action, gasLimit })

    if (isOfflineTxId(actionTxHash)) return { approveTxHash, actionTxHash, offline: true }

    const receipt = await signer.waitForReceipt(actionTxHash)
    if (!receipt.status) throw new Error(`The ${mode} transaction failed.`)
    return { approveTxHash, actionTxHash: receipt.txHash, offline }
}
