/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * THORChain, as a `BridgeProvider` — native Bitcoin ↔ native coins on EVM
 * chains (ETH on Ethereum and Base, AVAX, BNB), native to native with no
 * wrapped tokens. Wormhole cannot move native BTC; this is the provider that
 * does.
 *
 * How a THORChain swap is sent, per its quote endpoint:
 *  - from Bitcoin: a normal BTC payment to the quote's inbound vault address,
 *    with the quote's memo in an OP_RETURN output (vault first, change second,
 *    memo last — see bitcoin/tx.ts);
 *  - from an EVM chain: the quote's router contract, `depositWithExpiry(vault,
 *    asset, amount, memo, expiry)`, with the coin as value.
 * THORChain then swaps and pays out on the destination by itself — no claim.
 *
 * The memo carries a minimum-output limit (`liquidity_tolerance_bps`): if the
 * swap would pay less, THORChain refunds instead. Mainnet only — THORChain has
 * no public testnet.
 */
import axios from 'axios'

import { BN } from '@/avalanche'
import { isOfflineTxId } from '@/stores/offlineSigning'
import { getBridgeChain } from '../chains'
import {
    NATIVE,
    newTransfer,
    type BridgeFee,
    type BridgeProvider,
    type BridgeQuote,
    type BridgeQuoteRequest,
    type BridgeTransfer,
} from '../types'

export const THORCHAIN_ID = 'thorchain'
const ROUTE = 'thorchain:swap'

/** THORNode REST endpoints, tried in order. */
export const THORNODE_URLS = ['https://gateway.liquify.com/chain/thorchain_api', 'https://thornode.ninerealms.com']
const TIMEOUT_MS = 20_000
/** The minimum-output limit put in the memo: 1% below the quote. */
export const DEFAULT_TOLERANCE_BPS = 100
const EVM_DEPOSIT_GAS = 150_000
/** Refuse to send a quote this close to its expiry. */
const EXPIRY_MARGIN_MS = 60_000

/** THORChain asset ids for the wallet chains it serves, native coins only. */
export const THOR_ASSETS: Record<string, string> = {
    'bitcoin:mainnet': 'BTC.BTC',
    'evm:1': 'ETH.ETH',
    'evm:43114': 'AVAX.AVAX',
    'evm:56': 'BSC.BNB',
    'evm:8453': 'BASE.ETH',
}

const THOR_DECIMALS = 8

/** THORChain quotes every amount in 1e8 units, whatever the coin's own decimals. */
export function toThorUnits(amount: bigint, decimals: number): bigint {
    if (decimals === THOR_DECIMALS) return amount
    return decimals > THOR_DECIMALS
        ? amount / BigInt(10) ** BigInt(decimals - THOR_DECIMALS)
        : amount * BigInt(10) ** BigInt(THOR_DECIMALS - decimals)
}

export function fromThorUnits(amount: bigint, decimals: number): bigint {
    if (decimals === THOR_DECIMALS) return amount
    return decimals > THOR_DECIMALS
        ? amount * BigInt(10) ** BigInt(decimals - THOR_DECIMALS)
        : amount / BigInt(10) ** BigInt(THOR_DECIMALS - decimals)
}

/** The minimum-output limit in a swap memo (`=:asset:dest:LIMIT/interval/qty`), in 1e8 units. */
export function memoLimit(memo: string): bigint | null {
    const parts = memo.split(':')
    if (parts.length < 4) return null
    const lim = parts[3].split('/')[0]
    return /^\d+$/.test(lim) ? BigInt(lim) : null
}

async function thornodeGet(path: string, params?: Record<string, string | number>): Promise<any> {
    let lastError: unknown
    for (const base of THORNODE_URLS) {
        try {
            const { data } = await axios.get(`${base}${path}`, { params, timeout: TIMEOUT_MS })
            return data
        } catch (e: any) {
            // A 4xx is THORChain's own answer (bad amount, unknown tx…) — no point trying another node.
            if (e?.response && e.response.status >= 400 && e.response.status < 500) {
                const msg = e.response.data?.message ?? e.response.data?.error
                throw Object.assign(new Error(msg || `THORChain answered ${e.response.status}.`), { status: e.response.status })
            }
            lastError = e
        }
    }
    throw lastError instanceof Error ? lastError : new Error('THORChain is unreachable.')
}

interface ThorQuoteData {
    fromAsset: string
    toAsset: string
    inboundAddress: string
    router: string | null
    memo: string
    expiry: number
    gasRate: number
}

const ROUTER_ABI = [
    {
        name: 'depositWithExpiry',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
            { name: 'vault', type: 'address' },
            { name: 'asset', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'memo', type: 'string' },
            { name: 'expiration', type: 'uint256' },
        ],
        outputs: [],
    },
]
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function assetFor(chainId: string): string | undefined {
    return THOR_ASSETS[chainId]
}

let pools: Promise<string[]> | null = null

/** THORChain's available pool assets (e.g. "ETH.USDC-0XA0B8…"), loaded once per session. */
export function thorPoolAssets(): Promise<string[]> {
    if (!pools) {
        pools = thornodeGet('/thorchain/pools').then((list: any[]) =>
            (Array.isArray(list) ? list : []).filter((p) => p?.status === 'Available').map((p) => String(p.asset))
        )
        pools.catch(() => {
            pools = null
        })
    }
    return pools
}

/** The THORChain asset for token `address` on bridge chain `chainId`, when THORChain has a pool for it. */
export async function poolAssetFor(chainId: string, address: string): Promise<string | null> {
    const native = THOR_ASSETS[chainId]
    if (!native) return null
    const prefix = native.split('.')[0] + '.'
    const suffix = '-' + address.toUpperCase()
    return (await thorPoolAssets()).find((a) => a.startsWith(prefix) && a.toUpperCase().endsWith(suffix)) ?? null
}

/** Test seam: forget the cached pools. */
export function __resetThorPools(): void {
    pools = null
}

export const thorchainProvider: BridgeProvider = {
    id: THORCHAIN_ID,
    name: 'THORChain',

    supports(from, toChain) {
        return from.address === NATIVE && !!assetFor(from.chainId) && !!assetFor(toChain.id) && from.chainId !== toChain.id
    },

    async quote(req: BridgeQuoteRequest): Promise<BridgeQuote> {
        const fromAsset = assetFor(req.from.chainId)
        const nativeTo = assetFor(req.toChain.id)
        if (req.from.address !== NATIVE || !fromAsset || !nativeTo) {
            throw new Error('THORChain only swaps native coins between Bitcoin, Ethereum, Avalanche, BNB Chain and Base.')
        }
        // A chosen token on the destination: THORChain swaps into it when it has a pool for it.
        const want = req.receiveToken && req.receiveToken.address !== NATIVE ? req.receiveToken : null
        const toAsset = want ? await poolAssetFor(req.toChain.id, want.address) : nativeTo
        if (!toAsset) {
            throw new Error(`THORChain has no ${want?.symbol} pool on ${req.toChain.name}, so it cannot deliver it.`)
        }
        const thorAmount = toThorUnits(req.amount, req.from.decimals)
        const d = await thornodeGet('/thorchain/quote/swap', {
            from_asset: fromAsset,
            to_asset: toAsset,
            amount: thorAmount.toString(),
            destination: req.recipient,
            streaming_interval: 1,
            liquidity_tolerance_bps: DEFAULT_TOLERANCE_BPS,
        })
        if (d?.error || !d?.memo || !d?.inbound_address) {
            throw new Error(d?.error || d?.message || 'THORChain returned no quote for this swap.')
        }
        const minIn = d.recommended_min_amount_in ? BigInt(d.recommended_min_amount_in) : BigInt(0)
        if (thorAmount < minIn) {
            const min = fromThorUnits(minIn, req.from.decimals)
            throw Object.assign(
                new Error(`THORChain's minimum for this swap is ${formatUnits(min, req.from.decimals)} ${req.from.symbol}.`),
                { code: 'below_min' }
            )
        }

        const toChain = req.toChain
        const dstDecimals = want ? want.decimals : toChain.native.decimals
        const dstSymbol = want ? want.symbol : toChain.native.symbol
        const amountOut = fromThorUnits(BigInt(d.expected_amount_out), dstDecimals)
        const limit = memoLimit(String(d.memo))
        const fees: BridgeFee[] = []
        const total = d.fees?.total ? BigInt(d.fees.total) : BigInt(0)
        if (total > BigInt(0)) {
            fees.push({
                label: 'THORChain swap and outbound fees',
                amount: fromThorUnits(total, dstDecimals),
                symbol: dstSymbol,
                decimals: dstDecimals,
                paidAs: 'deducted',
            })
        }

        const warnings: string[] = []
        if (d.warning && !/do not cache/i.test(d.warning)) warnings.push(String(d.warning))
        warnings.push(
            `If the swap would pay less than the minimum shown, THORChain refunds your ${req.from.symbol} instead (minus fees).`
        )

        const data: ThorQuoteData = {
            fromAsset,
            toAsset,
            inboundAddress: String(d.inbound_address),
            router: d.router ? String(d.router) : null,
            memo: String(d.memo),
            expiry: Number(d.expiry),
            gasRate: Number(d.recommended_gas_rate) || 0,
        }
        return {
            providerId: THORCHAIN_ID,
            routeId: ROUTE,
            routeName: want ? `THORChain swap to ${want.symbol}` : 'THORChain swap',
            request: req,
            receive: {
                asset: want
                    ? { chainId: toChain.id, address: want.address, symbol: want.symbol, decimals: want.decimals, name: want.name }
                    : { chainId: toChain.id, address: NATIVE, symbol: toChain.native.symbol, decimals: dstDecimals },
                amount: amountOut,
                kind: want ? 'canonical' : 'native',
            },
            minReceive: limit !== null ? fromThorUnits(limit, dstDecimals) : undefined,
            fees,
            etaSeconds: Number(d.total_swap_seconds) || 600,
            needsClaim: false,
            expiresAt: Number(d.expiry) * 1000,
            warnings,
            data,
        }
    },

    async execute(quote, signers, onProgress) {
        const data = quote.data as ThorQuoteData
        const src = getBridgeChain(quote.request.from.chainId)!
        if (quote.expiresAt && Date.now() > quote.expiresAt - EXPIRY_MARGIN_MS) {
            throw new Error('This THORChain quote has expired. Get a new one.')
        }

        let hash: string
        if (src.kind === 'bitcoin') {
            const wallet = signers.bitcoin(src)
            if (!wallet || wallet.isReadonly) throw new Error('Swapping from Bitcoin needs a Bitcoin wallet that can sign.')
            onProgress?.('Send BTC to THORChain', 'running')
            // Spendable outputs come from the latest scan.
            await wallet.refresh()
            hash = await wallet.send({
                to: data.inboundAddress,
                amountSats: Number(quote.request.amount),
                feeRate: Math.max(data.gasRate, 1),
                memo: data.memo,
            })
            onProgress?.('Send BTC to THORChain', 'done')
        } else if (src.kind === 'evm') {
            const signer = signers.evm(src)
            if (!signer) throw new Error(`Swapping from ${src.name} needs your wallet on ${src.name}. Switch to it first.`)
            if (!data.router) throw new Error('THORChain gave no router for this chain.')
            await signer.assertOnChain()
            onProgress?.(`Deposit ${src.native.symbol} to THORChain`, 'running')
            const router = new (signer.reader().eth.Contract)(ROUTER_ABI as any, data.router).methods
            const amount = quote.request.amount.toString()
            const req = {
                to: data.router,
                data: router.depositWithExpiry(data.inboundAddress, ZERO_ADDRESS, amount, data.memo, data.expiry).encodeABI(),
                value: new BN(amount),
                label: `Swap ${src.native.symbol} to ${quote.receive.asset.symbol} via THORChain`,
            }
            const gasLimit = await signer.estimateGas(req, EVM_DEPOSIT_GAS)
            const sent = await signer.send({ ...req, gasLimit })
            if (isOfflineTxId(sent)) throw new Error('Bridging needs the deposit broadcast. Turn off offline signing to bridge.')
            const receipt = await signer.waitForReceipt(sent)
            if (!receipt.status) throw new Error('The THORChain deposit failed on chain.')
            hash = receipt.txHash
            onProgress?.(`Deposit ${src.native.symbol} to THORChain`, 'done')
        } else {
            throw new Error('THORChain does not serve this chain.')
        }
        return newTransfer(quote, hash, { fromAsset: data.fromAsset, toAsset: data.toAsset })
    },

    async refresh(transfer: BridgeTransfer): Promise<BridgeTransfer> {
        const id = transfer.sourceTxHash.replace(/^0x/i, '').toUpperCase()
        const updated = { ...transfer, updatedAt: Date.now() }
        let d: any
        try {
            d = await thornodeGet(`/thorchain/tx/status/${id}`)
        } catch (e: any) {
            if (e?.status === 404) return { ...updated, status: 'in_transit', statusDetail: 'Waiting for THORChain to see the transaction.' }
            throw e
        }
        const stages = d?.stages ?? {}
        // Affiliate/fee payouts in RUNE show up as THOR-chain outputs; the coin payout is the other one.
        const outs: any[] = Array.isArray(d?.out_txs) ? d.out_txs : []
        const out = outs.find((o) => String(o?.chain ?? '') !== 'THOR') ?? null
        if (stages.outbound_signed?.completed && out) {
            const fromChain = String(transfer.data.fromAsset ?? '').split('.')[0]
            const refunded = /^REFUND/i.test(String(out.memo ?? '')) || String(out.chain ?? '') === fromChain
            const payoutChain = getBridgeChain(refunded ? transfer.fromChainId : transfer.toChainId)
            const hex = out.id ? String(out.id).toLowerCase() : ''
            const destTxHash = hex ? (payoutChain?.kind === 'evm' ? `0x${hex}` : hex) : undefined
            return refunded
                ? { ...updated, status: 'refunded', statusDetail: 'THORChain refunded the swap.', destTxHash }
                : { ...updated, status: 'completed', statusDetail: 'Delivered.', destTxHash }
        }
        if (!stages.inbound_observed?.completed) return { ...updated, status: 'in_transit', statusDetail: 'Waiting for THORChain to see the transaction.' }
        if (!stages.inbound_finalised?.completed) return { ...updated, status: 'in_transit', statusDetail: 'Waiting for confirmations on the source chain.' }
        if (stages.swap_status?.pending) return { ...updated, status: 'in_transit', statusDetail: 'Swapping.' }
        return { ...updated, status: 'in_transit', statusDetail: 'Sending on the destination chain.' }
    },
}

function formatUnits(v: bigint, decimals: number): string {
    const s = v.toString().padStart(decimals + 1, '0')
    const whole = s.slice(0, s.length - decimals)
    const frac = s.slice(s.length - decimals).replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : whole
}

/** Explorer link for a THORChain swap. */
export function thorchainTrackerUrl(transfer: BridgeTransfer): string {
    return `https://runescan.io/tx/${transfer.sourceTxHash.replace(/^0x/i, '')}`
}
