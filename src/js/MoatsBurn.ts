/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Burning AVXTO through the Moats contract (moats.app).
 *
 * Not a plain `transfer` to 0xdEaD. The Moats `MultiLockMoat` contract at
 * `MOATS_CONTRACT_ADDRESS` (verified source on Snowtrace/Routescan) credits
 * burn points to the burner, so a burn has to go through its `burn(uint256)`:
 * it `transferFrom`s the amount out of the caller, forwards it to 0xdEaD, and
 * records the burn against the caller. Confirmed against a real 1000 AVXTO
 * burn (tx 0x226aa700…57dc): Transfer user -> Moats, Transfer Moats -> 0xdEaD,
 * then Moats' own `Burned(user, amount)`.
 *
 * Because the contract pulls the tokens, it needs an ERC-20 allowance first.
 * This approves exactly the amount being burned, never "unlimited": an
 * unbounded approval to a contract with an admin would outlive this one
 * action for no benefit to the user.
 *
 * The contract's own rules, mirrored by `validateBurnAmount` so the user sees
 * the reason before signing instead of an opaque revert:
 *   - `burningEnabled` and not `paused`
 *   - amount >= `MIN_STAKE_AMOUNT` (10^12 wei for an 18-decimal token)
 *   - amount <= the caller's balance
 * A burn also pays out any pending Moats rewards (`_harvestAllRewards`).
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

/** The slice of `MultiLockMoat`'s ABI this feature touches. */
const MOATS_ABI = [
    {
        name: 'burn',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: '_amount', type: 'uint256' }],
        outputs: [],
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
    ...['totalBurned', 'MIN_STAKE_AMOUNT'].map((name) => ({
        name,
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
    })),
    ...['burningEnabled', 'paused'].map((name) => ({
        name,
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'bool' }],
    })),
    {
        name: 'stakingToken',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'address' }],
    },
]

export interface BurnState {
    decimals: number
    /** AVXTO the signer holds, in wei. */
    balance: BN
    /** What the Moats contract may already pull from the signer, in wei. */
    allowance: BN
    /** Lifetime AVXTO this address has burned through Moats, in wei. */
    userBurned: BN
    /** Lifetime AVXTO burned through Moats by everyone, in wei. */
    totalBurned: BN
    minAmount: BN
    burningEnabled: boolean
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
            `Moats burns happen on Avalanche C-Chain. Your wallet is on ${signer.network.name}.`
        )
    }
}

export async function readBurnState(signer: EvmSigner): Promise<BurnState> {
    assertMoatsChain(signer)
    const m = moats(signer).methods
    const t = avxto(signer).methods
    const me = signer.address

    const [decimals, balance, allowance, info, totalBurned, minAmount, burningEnabled, paused] =
        await Promise.all([
            t.decimals().call(),
            t.balanceOf(me).call(),
            t.allowance(me, MOATS_CONTRACT_ADDRESS).call(),
            m.userInfo(me).call(),
            m.totalBurned().call(),
            m.MIN_STAKE_AMOUNT().call(),
            m.burningEnabled().call(),
            m.paused().call(),
        ])

    return {
        decimals: Number(decimals),
        balance: toBN(balance),
        allowance: toBN(allowance),
        userBurned: toBN((info as any).totalUserBurn ?? (info as any)[1]),
        totalBurned: toBN(totalBurned),
        minAmount: toBN(minAmount),
        burningEnabled: Boolean(burningEnabled),
        paused: Boolean(paused),
    }
}

/**
 * A user-typed decimal amount as wei. Strict: digits with an optional
 * fraction no longer than `decimals` — no exponents, signs or separators,
 * since a misparsed amount here is destroyed rather than merely misspent.
 * Returns null for anything else.
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

/** Why `amount` would be refused by the contract, or null when it would not. */
export function validateBurnAmount(amount: BN | null, state: BurnState): string | null {
    if (state.paused) return 'The Moats contract is paused.'
    if (!state.burningEnabled) return 'Burning is currently disabled on Moats.'
    if (!amount || amount.isZero()) return 'Enter an amount to burn.'
    if (amount.lt(state.minAmount)) {
        return `The minimum burn is ${formatTokenAmount(state.minAmount, state.decimals)} AVXTO.`
    }
    if (amount.gt(state.balance)) return 'That is more AVXTO than this wallet holds.'
    return null
}

export interface BurnResult {
    /** Set when an approval had to be sent first. */
    approveTxHash: string | null
    burnTxHash: string
    /** True when offline signing captured the transactions instead of sending them. */
    offline: boolean
}

/**
 * Approve (only if needed) and burn. Run inside an `authorizeBatch` scope so
 * a phrase-opened wallet asks for its password once for both signatures.
 *
 * The approval is waited on before the burn is sent: the burn's
 * `transferFrom` reverts without it, so sending both back-to-back would
 * estimate the burn against pre-approval state and could leave a failed
 * approval followed by a burn that is certain to revert.
 */
export async function burnAvxto(signer: EvmSigner, amount: BN): Promise<BurnResult> {
    assertMoatsChain(signer)

    // The Moats address is hardcoded, so confirm it really is AVXTO's moat
    // before handing it an allowance.
    const staking = String(await moats(signer).methods.stakingToken().call())
    if (staking.toLowerCase() !== AVXTO_CONTRACT_ADDRESS.toLowerCase()) {
        throw new Error('The Moats contract does not burn AVXTO. Refusing to continue.')
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
            label: 'Approve Moats to burn AVXTO',
        }
        const baseNonce = await signer.getNonce()
        const gasLimit = await signer.estimateGas(approve, 80_000)
        approveTxHash = await signer.send({ ...approve, gasLimit, nonce: baseNonce })

        if (isOfflineTxId(approveTxHash)) {
            // Nothing was broadcast, so there is no receipt to wait for; the
            // burn is captured right behind it on the next nonce.
            offline = true
            nonce = baseNonce + 1
        } else {
            const receipt = await signer.waitForReceipt(approveTxHash)
            if (!receipt.status) throw new Error('The approval transaction failed.')
        }
    }

    const burn = {
        to: MOATS_CONTRACT_ADDRESS,
        data: moats(signer).methods.burn(amount.toString()).encodeABI(),
        label: 'Burn AVXTO on Moats',
        nonce,
    }
    // Observed: 228k gas for a first burn, 102k after. The fallback covers a
    // node refusing to estimate (always, when offline-captured behind an
    // approval that has not happened yet).
    const gasLimit = await signer.estimateGas(burn, 350_000)
    const burnTxHash = await signer.send({ ...burn, gasLimit })

    if (isOfflineTxId(burnTxHash)) return { approveTxHash, burnTxHash, offline: true }

    const receipt = await signer.waitForReceipt(burnTxHash)
    if (!receipt.status) throw new Error('The burn transaction failed.')
    return { approveTxHash, burnTxHash: receipt.txHash, offline }
}
