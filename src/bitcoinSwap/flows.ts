/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin swaps between Avalanche C-Chain and the Bitcoin network:
 *
 *   AVAX → BTC.b        C-Chain swap (KyberSwap — the aggregator Core's Markr
 *                       route wraps: the captured calldata calls Kyber's
 *                       router 0x6131…37b5)
 *   BTC.b → AVAX        the same, reversed
 *   BTC → BTC.b         Lombard deposit (see ./lombard)
 *   BTC.b → BTC         Lombard redeem
 *   Quick AVAX → BTC    AVAX → BTC.b, then exactly the BTC.b received → BTC
 *   Quick BTC → AVAX    BTC → BTC.b; once Lombard has minted it, BTC.b → AVAX
 *
 * Every step is signed by the wallet it belongs to, inside its own
 * authorization scope (one password prompt per wallet per step group); the
 * session allows one open scope at a time, so the C-Chain and Bitcoin wallets
 * are never authorized together. Swaps are saved, so the long-running ones
 * (a Bitcoin deposit takes about an hour to mint) can be tracked and resumed.
 */
import { ref } from 'vue'

import { BN } from '@/avalanche'
import type { EvmSigner } from '@/evm/signer'
import type { BitcoinWallet } from '@/platforms/bitcoin/wallet'
import { authorizeBatch } from '@/js/security/authorize'
import { getFeeEstimates } from '@/bitcoin/esplora'
import { AVAX_TOKEN, executeSwap, quoteSwap, type SwapQuote, type SwapTokenRef } from '@/js/PharSwap'
import {
    BTCB,
    BTCB_DECIMALS,
    MIN_DEPOSIT_SATS,
    btcbBalance,
    depositAddressFor,
    depositStatus,
    redeemConfig,
    redeemStatus,
    redeemToBitcoin,
} from './lombard'

export const BTCB_TOKEN: SwapTokenRef = { address: BTCB, symbol: 'BTC.b', decimals: BTCB_DECIMALS }
export const DEFAULT_SLIPPAGE_BPS = 50
/** Bitcoin fee target for deposits, in blocks. */
const BTC_FEE_TARGET = '3'

export type BtcSwapKind = 'avax-btcb' | 'btcb-avax' | 'btc-btcb' | 'btcb-btc' | 'quick-avax-btc' | 'quick-btc-avax'

export const KIND_LABELS: Record<BtcSwapKind, string> = {
    'avax-btcb': 'AVAX → BTC.b',
    'btcb-avax': 'BTC.b → AVAX',
    'btc-btcb': 'BTC → BTC.b',
    'btcb-btc': 'BTC.b → BTC',
    'quick-avax-btc': 'Quick swap AVAX → BTC',
    'quick-btc-avax': 'Quick swap BTC → AVAX',
}

export type BtcSwapStatus = 'running' | 'waiting' | 'ready' | 'done' | 'failed'

export interface BtcSwapStep {
    label: string
    chain: 'avalanche' | 'bitcoin'
    txHash?: string
}

export interface BtcSwapRecord {
    id: string
    kind: BtcSwapKind
    createdAt: number
    updatedAt: number
    status: BtcSwapStatus
    detail: string
    /** Human amounts, for the list. */
    amountIn: string
    symbolIn: string
    symbolOut: string
    evmAddress: string
    btcAddress: string
    steps: BtcSwapStep[]
    data: Record<string, string | number | boolean | undefined>
}

// ─── History ─────────────────────────────────────────────────────────────

const KEY = 'btc_swaps_v1'
const MAX_KEPT = 100

function read(): BtcSwapRecord[] {
    try {
        const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
        return Array.isArray(v) ? v.filter((r) => r && typeof r.id === 'string') : []
    } catch {
        return []
    }
}

export const btcSwaps = ref<BtcSwapRecord[]>(read())

export function saveSwap(r: BtcSwapRecord): void {
    const rest = btcSwaps.value.filter((x) => x.id !== r.id)
    btcSwaps.value = [Object.assign({}, r, { updatedAt: Date.now() })].concat(rest).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_KEPT)
    try {
        localStorage.setItem(KEY, JSON.stringify(btcSwaps.value))
    } catch {
        /* kept for this session */
    }
}

export function removeSwap(id: string): void {
    btcSwaps.value = btcSwaps.value.filter((x) => x.id !== id)
    try {
        localStorage.setItem(KEY, JSON.stringify(btcSwaps.value))
    } catch {
        /* ignore */
    }
}

function newRecord(kind: BtcSwapKind, amountIn: string, evmAddress: string, btcAddress: string): BtcSwapRecord {
    const [symbolIn, symbolOut] = KIND_LABELS[kind].replace('Quick swap ', '').split(' → ')
    const now = Date.now()
    return {
        id: `${kind}:${now}:${Math.random().toString(36).slice(2, 7)}`,
        kind,
        createdAt: now,
        updatedAt: now,
        status: 'running',
        detail: '',
        amountIn,
        symbolIn,
        symbolOut,
        evmAddress,
        btcAddress,
        steps: [],
        data: {},
    }
}

// ─── Quotes ──────────────────────────────────────────────────────────────

export const sats = (btc: bigint) => Number(btc) / 1e8

export async function quoteAvaxToBtcb(amountWei: bigint): Promise<SwapQuote> {
    return quoteSwap(AVAX_TOKEN, BTCB_TOKEN, new BN(amountWei.toString()), { pharaohOnly: false })
}

export async function quoteBtcbToAvax(amountSats: bigint): Promise<SwapQuote> {
    return quoteSwap(BTCB_TOKEN, AVAX_TOKEN, new BN(amountSats.toString()), { pharaohOnly: false })
}

/** What a swap's minimum output is after `slippageBps`. */
export function minOut(q: SwapQuote, slippageBps = DEFAULT_SLIPPAGE_BPS): bigint {
    return (BigInt(q.amountOut.toString()) * BigInt(10_000 - slippageBps)) / BigInt(10_000)
}

export async function bitcoinFeeRate(wallet: BitcoinWallet): Promise<number> {
    const est = await getFeeEstimates(wallet.network)
    return Math.max(1, Math.ceil(est[BTC_FEE_TARGET] ?? est['6'] ?? est['1'] ?? 1))
}

// ─── Steps (each inside the right authorization) ────────────────────────

async function swapStep(signer: EvmSigner, q: SwapQuote, label: string): Promise<string> {
    const res = await authorizeBatch(signer.authSubject, label, () => executeSwap(signer, q, DEFAULT_SLIPPAGE_BPS))
    if (res.offline) throw new Error('Turn off offline signing: each step must be broadcast.')
    return res.txHash
}

async function depositStep(signer: EvmSigner, wallet: BitcoinWallet, amountSats: bigint, rec: BtcSwapRecord): Promise<void> {
    if (amountSats < BigInt(MIN_DEPOSIT_SATS)) throw new Error(`Lombard's minimum is ${MIN_DEPOSIT_SATS / 1e8} BTC.`)
    if (wallet.isReadonly) throw new Error('This Bitcoin wallet is watch-only.')
    // The deposit address belongs to the C-Chain account; creating it needs one message signature from it.
    const { address } = await authorizeBatch(signer.authSubject, 'Create your BTC.b deposit address (Lombard)', () => depositAddressFor(signer))
    rec.data.depositAddress = address
    const feeRate = await bitcoinFeeRate(wallet)
    const txid = await authorizeBatch(wallet, `Send ${sats(amountSats)} BTC to your Lombard deposit address`, async () => {
        await wallet.refresh()
        return wallet.send({ to: address, amountSats: Number(amountSats), feeRate })
    })
    rec.steps.push({ label: `Sent ${sats(amountSats)} BTC to ${address}`, chain: 'bitcoin', txHash: txid })
    rec.data.depositTxid = txid
    rec.data.depositSats = Number(amountSats)
}

async function redeemStep(signer: EvmSigner, wallet: BitcoinWallet | null, btcAddress: string, amountSats: bigint, rec: BtcSwapRecord): Promise<void> {
    const network = wallet?.network
    if (!network) throw new Error('Connect a Bitcoin wallet (its network decides the address format).')
    const res = await authorizeBatch(signer.authSubject, `Redeem ${sats(amountSats)} BTC.b for BTC`, () => redeemToBitcoin(signer, amountSats, btcAddress, network))
    if (res.approveTxHash) rec.steps.push({ label: 'Approved BTC.b for Lombard', chain: 'avalanche', txHash: res.approveTxHash })
    rec.steps.push({ label: `Redeemed ${sats(amountSats)} BTC.b → ${btcAddress}`, chain: 'avalanche', txHash: res.txHash })
    rec.data.redeemTx = res.txHash
    rec.data.redeemSats = Number(amountSats)
}

function fail(rec: BtcSwapRecord, e: unknown): never {
    rec.status = 'failed'
    rec.detail = e instanceof Error ? e.message : String(e)
    saveSwap(rec)
    throw e
}

// ─── Operations ──────────────────────────────────────────────────────────

export async function runAvaxToBtcb(signer: EvmSigner, amountWei: bigint, btcAddress = ''): Promise<BtcSwapRecord> {
    const rec = newRecord('avax-btcb', `${Number(amountWei) / 1e18}`, signer.address, btcAddress)
    try {
        const q = await quoteAvaxToBtcb(amountWei)
        const tx = await swapStep(signer, q, `Swap ${rec.amountIn} AVAX to BTC.b`)
        rec.steps.push({ label: 'Swapped AVAX → BTC.b', chain: 'avalanche', txHash: tx })
        Object.assign(rec, { status: 'done', detail: `About ${sats(BigInt(q.amountOut.toString()))} BTC.b received.` })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

export async function runBtcbToAvax(signer: EvmSigner, amountSats: bigint): Promise<BtcSwapRecord> {
    const rec = newRecord('btcb-avax', `${sats(amountSats)}`, signer.address, '')
    try {
        const q = await quoteBtcbToAvax(amountSats)
        const tx = await swapStep(signer, q, `Swap ${rec.amountIn} BTC.b to AVAX`)
        rec.steps.push({ label: 'Swapped BTC.b → AVAX', chain: 'avalanche', txHash: tx })
        Object.assign(rec, { status: 'done', detail: `About ${Number(q.amountOut.toString()) / 1e18} AVAX received.` })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

export async function runBtcToBtcb(signer: EvmSigner, wallet: BitcoinWallet, amountSats: bigint): Promise<BtcSwapRecord> {
    const rec = newRecord('btc-btcb', `${sats(amountSats)}`, signer.address, wallet.getReceiveAddress())
    try {
        await depositStep(signer, wallet, amountSats, rec)
        Object.assign(rec, { status: 'waiting', detail: 'Waiting for Bitcoin confirmations and Lombard to mint BTC.b (about an hour).' })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

export async function runBtcbToBtc(signer: EvmSigner, wallet: BitcoinWallet | null, amountSats: bigint, btcAddress: string): Promise<BtcSwapRecord> {
    const rec = newRecord('btcb-btc', `${sats(amountSats)}`, signer.address, btcAddress)
    try {
        await redeemStep(signer, wallet, btcAddress, amountSats, rec)
        Object.assign(rec, { status: 'waiting', detail: 'Lombard is paying out on Bitcoin.' })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

/** AVAX → BTC.b → BTC: redeems exactly the BTC.b the swap delivered. */
export async function runQuickAvaxToBtc(signer: EvmSigner, wallet: BitcoinWallet | null, amountWei: bigint, btcAddress: string): Promise<BtcSwapRecord> {
    const rec = newRecord('quick-avax-btc', `${Number(amountWei) / 1e18}`, signer.address, btcAddress)
    try {
        const cfg = await redeemConfig(signer.reader())
        const q = await quoteAvaxToBtcb(amountWei)
        if (minOut(q) < BigInt(cfg.commissionSats + cfg.minSats)) {
            throw new Error(`Too small: the swap would give less than Lombard's minimum redeem of ${(cfg.commissionSats + cfg.minSats) / 1e8} BTC.`)
        }
        const before = await btcbBalance(signer.reader(), signer.address)
        const tx = await swapStep(signer, q, `Swap ${rec.amountIn} AVAX to BTC.b (step 1 of 2)`)
        rec.steps.push({ label: 'Swapped AVAX → BTC.b', chain: 'avalanche', txHash: tx })
        saveSwap(rec)
        const received = (await btcbBalance(signer.reader(), signer.address)) - before
        if (received <= BigInt(0)) throw new Error('The swap went through but no BTC.b arrived yet. Redeem it from the BTC.b → BTC tab.')
        rec.data.btcbReceived = Number(received)
        await redeemStep(signer, wallet, btcAddress, received, rec)
        Object.assign(rec, { status: 'waiting', detail: 'Lombard is paying out on Bitcoin.' })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

/** BTC → BTC.b (deposit now); the BTC.b → AVAX half runs from `continueQuickBtcToAvax` once Lombard has minted. */
export async function runQuickBtcToAvax(signer: EvmSigner, wallet: BitcoinWallet, amountSats: bigint): Promise<BtcSwapRecord> {
    const rec = newRecord('quick-btc-avax', `${sats(amountSats)}`, signer.address, wallet.getReceiveAddress())
    try {
        await depositStep(signer, wallet, amountSats, rec)
        Object.assign(rec, { status: 'waiting', detail: 'Step 1 of 2: waiting for Lombard to mint BTC.b (about an hour). Then swap it to AVAX here.' })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

export async function continueQuickBtcToAvax(signer: EvmSigner, rec: BtcSwapRecord): Promise<BtcSwapRecord> {
    if (rec.kind !== 'quick-btc-avax' || rec.status !== 'ready') throw new Error('This swap is not ready to continue.')
    if (signer.address.toLowerCase() !== rec.evmAddress.toLowerCase()) throw new Error('Use the same C-Chain account the BTC.b was minted to.')
    const minted = BigInt(Number(rec.data.depositSats ?? 0))
    const held = await btcbBalance(signer.reader(), signer.address)
    const amount = held < minted ? held : minted
    if (amount <= BigInt(0)) throw new Error('No BTC.b in this account to swap.')
    rec.status = 'running'
    saveSwap(rec)
    try {
        const q = await quoteBtcbToAvax(amount)
        const tx = await swapStep(signer, q, `Swap ${sats(amount)} BTC.b to AVAX (step 2 of 2)`)
        rec.steps.push({ label: 'Swapped BTC.b → AVAX', chain: 'avalanche', txHash: tx })
        Object.assign(rec, { status: 'done', detail: `About ${Number(q.amountOut.toString()) / 1e18} AVAX received.` })
        saveSwap(rec)
        return rec
    } catch (e) {
        return fail(rec, e)
    }
}

/** Re-reads Lombard's view of a waiting swap. */
export async function refreshSwap(rec: BtcSwapRecord): Promise<BtcSwapRecord> {
    if (rec.status !== 'waiting') return rec
    const next = Object.assign({}, rec, { data: Object.assign({}, rec.data), steps: rec.steps.slice() })
    if (rec.data.depositTxid) {
        const s = await depositStatus(rec.evmAddress, String(rec.data.depositTxid))
        if (s.claimTx) {
            if (!next.steps.some((x) => x.txHash === s.claimTx)) next.steps.push({ label: 'Lombard minted BTC.b', chain: 'avalanche', txHash: s.claimTx })
            if (rec.kind === 'quick-btc-avax') Object.assign(next, { status: 'ready', detail: 'BTC.b arrived. Swap it to AVAX to finish.' })
            else Object.assign(next, { status: 'done', detail: 'BTC.b arrived on Avalanche.' })
        } else {
            next.detail = !s.found
                ? 'Waiting for Lombard to see the Bitcoin deposit.'
                : `Lombard: ${String(s.notarization ?? '').replace('NOTARIZATION_STATUS_', '').toLowerCase().replace(/_/g, ' ') || 'pending'}.`
        }
    } else if (rec.data.redeemTx) {
        const s = await redeemStatus(rec.evmAddress, String(rec.data.redeemTx))
        if (s.completed) Object.assign(next, { status: 'done', detail: `Paid out ${s.amountSats !== undefined ? s.amountSats / 1e8 : ''} BTC to ${s.toAddress ?? rec.btcAddress}.` })
        else next.detail = s.found ? 'Lombard is paying out on Bitcoin.' : 'Waiting for Lombard to see the redeem.'
    }
    saveSwap(next)
    return next
}
