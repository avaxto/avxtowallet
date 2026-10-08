/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Swapping on the Pharaoh exchange
 * Two kinds of swap, exactly as phar.gg does them:
 *
 *  - WAVAX ↔ AVAX is not a market trade at all. phar.gg asked its aggregators
 *    for quotes, then sent a plain `withdraw(amount)` to the WAVAX contract
 *    (captured: 23.264 WAVAX, gas limit 36,277, value 0). Wrapping is the
 *    mirror image, `deposit()` with the AVAX as value. 1:1, no slippage.
 *
 *  - Everything else goes through KyberSwap's aggregator — phar.gg's own
 *    router: its quotes come from Kyber (and 0x/Enso behind phar.gg's server,
 *    which refuse other origins), and Pharaoh's AutoVault whitelists Kyber's
 *    router as its aggregator. Kyber lists Pharaoh's five pool families, so a
 *    route can be limited to Pharaoh pools (`PHARAOH_SOURCES`) or left open
 *    for the best price across every DEX, as phar.gg does.
 *
 * Safety: the built transaction is only sent to Kyber's known router, ERC-20
 * allowance is approved for the exact amount (never unlimited), and the
 * quote's slippage bound is enforced by the router itself.
 */
import axios from 'axios'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

import { BN } from '@/avalanche'
import type { EvmSigner } from '@/evm/signer'
import { isOfflineTxId } from '@/stores/offlineSigning'

export const PHAR_SWAP_CHAIN_ID = 43114
export const WAVAX_ADDRESS = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
/** How aggregators spell the chain's native coin (AVAX). */
export const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const KYBER_API = 'https://aggregator-api.kyberswap.com/avalanche/api/v1'
/** Kyber's MetaAggregationRouterV2 — also the aggregator Pharaoh's AutoVault whitelists. */
export const KYBER_ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'
/** Kyber's ids for Pharaoh's pools on Avalanche: V1, 2, LB, CL, V3. */
export const PHARAOH_SOURCES = ['pharaoh', 'pharaoh-2', 'pharaoh-lb', 'pharaoh-v2', 'pharaoh-v3']
/** Identifies this wallet to Kyber, like phar.gg's `source=shadow`. */
const KYBER_CLIENT = 'avxto-wallet'

/** Gas when estimation is unavailable. Captured unwrap: 36,277. */
const WRAP_GAS_FALLBACK = 60_000
const APPROVE_GAS_FALLBACK = 80_000
const KYBER_GAS_FALLBACK = 700_000
const HTTP_TIMEOUT_MS = 15_000

const WAVAX_ABI = [
    { name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
    {
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'wad', type: 'uint256' }],
        outputs: [],
    },
]

export interface SwapTokenRef {
    address: string
    symbol: string
    decimals: number
}

export const AVAX_TOKEN: SwapTokenRef = { address: NATIVE_TOKEN, symbol: 'AVAX', decimals: 18 }
export const WAVAX_TOKEN: SwapTokenRef = { address: WAVAX_ADDRESS, symbol: 'WAVAX', decimals: 18 }

const lower = (a: string) => a.toLowerCase()
export const isNative = (t: SwapTokenRef | string) => lower(typeof t === 'string' ? t : t.address) === lower(NATIVE_TOKEN)
const isWavax = (t: SwapTokenRef) => lower(t.address) === lower(WAVAX_ADDRESS)

export type SwapKind = 'wrap' | 'unwrap' | 'kyber'

/** WAVAX ↔ AVAX is a wrap/unwrap on the WAVAX contract; anything else is a trade. */
export function swapKind(from: SwapTokenRef, to: SwapTokenRef): SwapKind {
    if (isNative(from) && isWavax(to)) return 'wrap'
    if (isWavax(from) && isNative(to)) return 'unwrap'
    return 'kyber'
}

export interface SwapQuote {
    kind: SwapKind
    from: SwapTokenRef
    to: SwapTokenRef
    amountIn: BN
    amountOut: BN
    /** USD values when Kyber reports them. */
    amountInUsd: number | null
    amountOutUsd: number | null
    /** Exchanges the route passes through, in order (e.g. ["pharaoh-lb"]). */
    exchanges: string[]
    /** Kyber's route, to be built into a transaction; null for wrap/unwrap. */
    routeSummary: any | null
}

/**
 * A quote for swapping `amountIn` of `from` into `to`. Wrap/unwrap is 1:1 and
 * needs no network call; a trade asks Kyber, limited to Pharaoh's pools when
 * `pharaohOnly`.
 */
export async function quoteSwap(
    from: SwapTokenRef,
    to: SwapTokenRef,
    amountIn: BN,
    opts: { pharaohOnly: boolean }
): Promise<SwapQuote> {
    if (lower(from.address) === lower(to.address)) throw new Error('Pick two different tokens.')
    if (amountIn.isZero()) throw new Error('Enter an amount.')

    const kind = swapKind(from, to)
    if (kind !== 'kyber') {
        return {
            kind,
            from,
            to,
            amountIn,
            amountOut: amountIn,
            amountInUsd: null,
            amountOutUsd: null,
            exchanges: ['WAVAX contract'],
            routeSummary: null,
        }
    }

    const params: Record<string, string> = {
        tokenIn: from.address,
        tokenOut: to.address,
        amountIn: amountIn.toString(),
        source: KYBER_CLIENT,
    }
    if (opts.pharaohOnly) params.includedSources = PHARAOH_SOURCES.join(',')

    const { data } = await axios.get(`${KYBER_API}/routes`, { params, timeout: HTTP_TIMEOUT_MS })
    const rs = data?.data?.routeSummary
    if (data?.code !== 0 || !rs?.amountOut) {
        throw new Error(
            opts.pharaohOnly
                ? 'No route through Pharaoh pools for this pair. Try allowing all DEXes.'
                : data?.message || 'No route found for this pair.'
        )
    }
    const exchanges: string[] = []
    for (const path of Array.isArray(rs.route) ? rs.route : []) {
        for (const hop of Array.isArray(path) ? path : []) {
            if (hop?.exchange && !exchanges.includes(hop.exchange)) exchanges.push(String(hop.exchange))
        }
    }
    const usd = (v: unknown) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : null)
    return {
        kind,
        from,
        to,
        amountIn,
        amountOut: new BN(String(rs.amountOut)),
        amountInUsd: usd(rs.amountInUsd),
        amountOutUsd: usd(rs.amountOutUsd),
        exchanges,
        routeSummary: rs,
    }
}

/**
 * Unwraps `amount` of WAVAX into AVAX: `withdraw(amount)` on the WAVAX
 * contract, exactly the transaction phar.gg sends. Waits for it to be mined
 * (unless offline signing captured it) and returns its hash.
 */
export async function unwrapWavax(signer: EvmSigner, amount: BN, opts: { nonce?: number } = {}): Promise<string> {
    const wavax = new (signer.reader().eth.Contract)(WAVAX_ABI as any, WAVAX_ADDRESS).methods
    return sendAndConfirm(
        signer,
        { to: WAVAX_ADDRESS, data: wavax.withdraw(amount.toString()).encodeABI(), label: 'Unwrap WAVAX to AVAX', nonce: opts.nonce },
        WRAP_GAS_FALLBACK,
        'unwrap'
    )
}

export interface SwapResult {
    txHash: string
    offline: boolean
    approveTxHash: string | null
}

async function sendAndConfirm(signer: EvmSigner, req: any, fallback: number, what: string): Promise<string> {
    const gasLimit = req.gasLimit ?? (await signer.estimateGas(req, fallback))
    const hash = await signer.send({ ...req, gasLimit })
    if (isOfflineTxId(hash)) return hash
    const receipt = await signer.waitForReceipt(hash)
    if (!receipt.status) throw new Error(`The ${what} transaction failed.`)
    return receipt.txHash
}

/**
 * Executes `quote` from `signer`'s address. Run inside an `authorizeBatch`
 * scope: a trade may need an approval and the swap, two signatures.
 *
 * @param slippageBps how far below the quoted output the trade may fill (50 = 0.5%)
 */
export async function executeSwap(signer: EvmSigner, quote: SwapQuote, slippageBps: number): Promise<SwapResult> {
    if (signer.network.evmChainId !== PHAR_SWAP_CHAIN_ID) {
        throw new Error(`The Pharaoh exchange is on Avalanche C-Chain. Your wallet is on ${signer.network.name}.`)
    }
    await signer.assertOnChain()
    const web3 = signer.reader()

    if (quote.kind === 'unwrap') {
        const txHash = await unwrapWavax(signer, quote.amountIn)
        return { txHash, offline: isOfflineTxId(txHash), approveTxHash: null }
    }
    if (quote.kind === 'wrap') {
        const wavax = new web3.eth.Contract(WAVAX_ABI as any, WAVAX_ADDRESS).methods
        const req = { to: WAVAX_ADDRESS, data: wavax.deposit().encodeABI(), value: quote.amountIn, label: 'Wrap AVAX to WAVAX' }
        const txHash = await sendAndConfirm(signer, req, WRAP_GAS_FALLBACK, 'wrap')
        return { txHash, offline: isOfflineTxId(txHash), approveTxHash: null }
    }

    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2000) {
        throw new Error('Slippage must be between 0.01% and 20%.')
    }

    // Build the route into calldata for this sender.
    const { data } = await axios.post(
        `${KYBER_API}/route/build`,
        {
            routeSummary: quote.routeSummary,
            sender: signer.address,
            recipient: signer.address,
            slippageTolerance: slippageBps,
            source: KYBER_CLIENT,
        },
        { timeout: HTTP_TIMEOUT_MS }
    )
    const built = data?.data
    if (data?.code !== 0 || !built?.data) throw new Error(data?.message || 'Could not build the swap.')
    // Only ever hand calldata to the router we know.
    if (lower(String(built.routerAddress)) !== lower(KYBER_ROUTER)) {
        throw new Error('The swap route points at an unknown router. Refusing to send it.')
    }
    if (String(built.amountIn) !== quote.amountIn.toString()) {
        throw new Error('The built swap does not match the quoted amount. Get a new quote.')
    }

    let approveTxHash: string | null = null
    let nonce: number | undefined
    if (!isNative(quote.from)) {
        // @ts-ignore - web3 typing for dynamic ABI
        const token = new web3.eth.Contract(ERC20Abi.abi as any, quote.from.address).methods
        const allowance = new BN(String(await token.allowance(signer.address, KYBER_ROUTER).call()))
        if (allowance.lt(quote.amountIn)) {
            const approve = {
                to: quote.from.address,
                data: token.approve(KYBER_ROUTER, quote.amountIn.toString()).encodeABI(),
                label: `Approve ${quote.from.symbol} for the swap`,
            }
            const baseNonce = await signer.getNonce()
            approveTxHash = await sendAndConfirm(signer, { ...approve, nonce: baseNonce }, APPROVE_GAS_FALLBACK, 'approval')
            // Offline: nothing was broadcast, so the swap goes on the next nonce.
            if (isOfflineTxId(approveTxHash)) nonce = baseNonce + 1
        }
    }

    const swapReq = {
        to: KYBER_ROUTER,
        data: String(built.data),
        value: isNative(quote.from) ? new BN(String(built.transactionValue ?? quote.amountIn.toString())) : undefined,
        label: `Swap ${quote.from.symbol} to ${quote.to.symbol}`,
        nonce,
    }
    const txHash = await sendAndConfirm(signer, swapReq, KYBER_GAS_FALLBACK, 'swap')
    return { txHash, offline: isOfflineTxId(txHash), approveTxHash }
}

/** `owner`'s balance of `token` (native AVAX included), in the token's units. */
export async function readTokenBalance(signer: EvmSigner, token: SwapTokenRef, owner: string): Promise<BN> {
    const web3 = signer.reader()
    if (isNative(token)) return new BN(String(await web3.eth.getBalance(owner)))
    // @ts-ignore - web3 typing for dynamic ABI
    const t = new web3.eth.Contract(ERC20Abi.abi as any, token.address).methods
    return new BN(String(await t.balanceOf(owner).call()))
}
