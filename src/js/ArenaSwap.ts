/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
  ArenaSwap - token swapping on any EVM chain.

  Routes swaps through LI.FI (li.quest) rather than Odos (api.odos.xyz):
  Odos rejects requests from this app's origin with a CORS error (no
  Access-Control-Allow-Origin on the preflight response), and there is no
  client-side fix for that — only routing through an aggregator whose CORS
  policy actually allows us. li.quest is reachable from the browser.

  LI.FI's /v1/quote returns a ready-to-sign transaction in the same response
  as the quote — no separate "assemble" step the way Odos needed:

    1. quote     GET /v1/quote  -> priced route + transactionRequest + approvalAddress
    2. (approve) ERC20 allowance to quote.approvalAddress, if the input is not native
    3. execute   sign quote.transactionRequest with the active wallet + broadcast

  No native/local programs are involved: only HTTP fetches and standard
  in-browser transaction signing (the same path the token launcher uses).

  **Chain-neutral.** This used to hardcode 43114 into every LI.FI request, read
  balances and allowances through the C-Chain-pinned `web3` singleton, sign with
  an `AvaWalletCore`, and check tokens against Avalanche's registry. All four
  now follow the `EvmSigner` it is handed, so a swap runs on whatever chain the
  connected wallet is on. LI.FI covers many chains; one it does not cover simply
  returns no route, which surfaces as "no route found" rather than a swap
  quietly priced for the wrong network.

  Unverified against a live swap: this is built from LI.FI's documented
  request/response shape, not one that has been exercised end-to-end, so
  treat it as best-effort until a real swap has been run through this path.
*/
import axios from 'axios'
import { BN } from '@/avalanche'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

import { explorerTxUrl } from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'
import type { EvmSigner } from '@/evm/signer'

const LIFI_BASE = 'https://li.quest'

/**
 * LI.FI uses the zero address to denote a chain's native token — AVAX on
 * Avalanche, ETH on Robinhood Chain and Ethereum, and so on. Same convention
 * Odos used, so this didn't need to change.
 */
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

// Identifies this app to LI.FI (their analytics/fee-attribution, mirroring
// ArenaTrade's own `integrator=arena.social`) — not a registered partner
// account, so no `fee` param is sent (that requires a configured recipient
// on LI.FI's side; omitting it just means no referral revenue share, not an
// error).
const INTEGRATOR = 'avxto-wallet'

export interface SwapToken {
    address: string // 0x0000..0000 for the chain's native asset
    symbol: string
    name: string
    decimals: number
}

/** A priced, ready-to-execute route from LI.FI. */
export interface SwapQuote {
    fromAmount: string
    toAmount: string
    toAmountMin: string
    fromAmountUSD: number
    toAmountUSD: number
    /** Self-computed from the USD values above — LI.FI doesn't return this as a flat field. */
    priceImpact: number | null
    /** ERC20 spender to approve for a non-native input — null when the input is native. */
    approvalAddress: string | null
    gasLimit: number
    /** The exact transaction LI.FI priced this quote against — sign and send as-is. */
    transactionRequest: { to: string; data: string; value: string }
}

export interface SwapResult {
    txHash: string
}

export function isNativeToken(address: string): boolean {
    return address.toLowerCase() === NATIVE_TOKEN_ADDRESS
}

/** Parse a wei value that may arrive as a decimal or 0x-hex string. */
function parseValueToBN(v: string | number | undefined): BN {
    const s = (v ?? '0').toString().trim()
    if (s.startsWith('0x') || s.startsWith('0X')) return new BN(s.slice(2) || '0', 16)
    return new BN(s || '0', 10)
}

function parseNumber(v: string | number | undefined): number {
    const n = typeof v === 'number' ? v : parseFloat(v || '0')
    return Number.isFinite(n) ? n : 0
}

function lifiError(e: any, fallback: string): string {
    const detail =
        e?.response?.data?.message || e?.response?.data?.error || e?.response?.data?.detail
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail)
    return e?.message || fallback
}

/**
 * An ERC-20 bound to the signer's own network.
 *
 * Goes through `signer.reader()` rather than a module-level web3 so the read
 * lands on the chain the swap is actually for — a contract object binds to the
 * provider that created it for its whole lifetime, which is exactly how the
 * previous version read every chain's allowances off Avalanche.
 */
function erc20(signer: EvmSigner, address: string) {
    // The instance goes in a local first, deliberately: `new
    // signer.reader().eth.Contract(...)` parses as
    // `(new signer.reader()).eth.Contract(...)` — JS binds `new` to the
    // shortest member expression before the argument list, so it would try to
    // construct `reader` itself and throw.
    const web3 = signer.reader()
    // @ts-ignore - web3 typing for dynamic ABI
    return new web3.eth.Contract(ERC20Abi.abi as any, address)
}

/** True if the string is a well-formed 0x EVM address. */
export function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test((address || '').trim())
}

/**
 * Request a priced, ready-to-execute route. `amountInRaw` is the input
 * amount in base units (already scaled by the input token's decimals).
 *
 * Both legs are on `chainId` — this is a same-chain swap, not a bridge.
 */
export async function getQuote(params: {
    chainId: number
    tokenIn: SwapToken
    tokenOut: SwapToken
    amountInRaw: BN
    userAddress: string
    slippagePercent: number
}): Promise<SwapQuote> {
    try {
        const { data } = await axios.get(`${LIFI_BASE}/v1/quote`, {
            params: {
                fromChain: params.chainId,
                toChain: params.chainId,
                fromToken: params.tokenIn.address,
                toToken: params.tokenOut.address,
                fromAmount: params.amountInRaw.toString(),
                fromAddress: params.userAddress,
                toAddress: params.userAddress,
                // LI.FI takes slippage as a fraction (0.005 = 0.5%), the UI works in percent.
                slippage: params.slippagePercent / 100,
                order: 'RECOMMENDED',
                integrator: INTEGRATOR,
                maxPriceImpact: 0.3,
            },
        })

        const tx = data.transactionRequest
        if (!tx || !tx.to || !tx.data) throw new Error('No route found for this pair')

        const fromAmountUSD = parseNumber(data.estimate?.fromAmountUSD)
        const toAmountUSD = parseNumber(data.estimate?.toAmountUSD)
        const priceImpact =
            fromAmountUSD > 0 ? ((toAmountUSD - fromAmountUSD) / fromAmountUSD) * 100 : null

        const gasLimitRaw = tx.gasLimit ?? data.estimate?.gasCosts?.[0]?.limit ?? 500000
        const gasLimit = Math.round(Number(parseValueToBN(gasLimitRaw).toString()) || 500000)

        return {
            fromAmount: data.estimate?.fromAmount ?? params.amountInRaw.toString(),
            toAmount: data.estimate?.toAmount ?? '0',
            toAmountMin: data.estimate?.toAmountMin ?? data.estimate?.toAmount ?? '0',
            fromAmountUSD,
            toAmountUSD,
            priceImpact,
            approvalAddress: isNativeToken(params.tokenIn.address)
                ? null
                : data.estimate?.approvalAddress || tx.to,
            gasLimit,
            transactionRequest: {
                to: tx.to,
                data: tx.data,
                value: tx.value ?? '0x0',
            },
        }
    } catch (e: any) {
        throw new Error(lifiError(e, 'Failed to get a swap quote'))
    }
}

/**
 * Resolve on-chain metadata (symbol, name, decimals) for an arbitrary ERC20
 * address so the UI can display and correctly scale a token the user does not
 * hold. Throws if the address is not a readable ERC20 on the signer's chain.
 */
export async function resolveErc20Metadata(signer: EvmSigner, address: string): Promise<SwapToken> {
    if (isNativeToken(address)) {
        return {
            address: NATIVE_TOKEN_ADDRESS,
            symbol: signer.network.native.symbol,
            name: signer.network.native.name,
            decimals: signer.network.native.decimals,
        }
    }
    if (!isValidAddress(address)) {
        throw new Error('Enter a valid token contract address (0x…)')
    }
    const contract = erc20(signer, address)
    try {
        const [symbol, decimals, name] = await Promise.all([
            contract.methods.symbol().call(),
            contract.methods.decimals().call(),
            contract.methods
                .name()
                .call()
                .catch(() => ''),
        ])
        return {
            address,
            symbol: (symbol || 'TOKEN').toString(),
            name: (name || symbol || 'Token').toString(),
            decimals: parseInt(decimals.toString()) || 18,
        }
    } catch (e) {
        throw new Error('Address is not a readable ERC20 token on this network')
    }
}

/**
 * LI.FI's curated token list, cached per chain.
 *
 * Keyed by chain id rather than a single module-level cache: the previous
 * version cached one list globally, so the first chain to load it would have
 * answered symbol lookups for every other chain — resolving "USDC" to an
 * address that does not exist where the swap is about to run.
 */
const cachedTokenMaps = new Map<number, Record<string, SwapToken>>()

/** Fetch (and cache) the tradable token list for `chainId`, keyed by lowercased address. */
export async function getSwapTokenMap(chainId: number): Promise<Record<string, SwapToken>> {
    const cached = cachedTokenMaps.get(chainId)
    if (cached) return cached

    const { data } = await axios.get(`${LIFI_BASE}/v1/tokens`, { params: { chains: chainId } })
    const list: any[] = data.tokens?.[chainId] ?? data.tokens?.[String(chainId)] ?? []
    const map: Record<string, SwapToken> = {}
    for (const t of list) {
        map[(t.address || '').toLowerCase()] = {
            address: t.address,
            symbol: t.symbol,
            name: t.name,
            decimals: parseInt(t.decimals) || 18,
        }
    }
    cachedTokenMaps.set(chainId, map)
    return map
}

/** Find a tradable token by its symbol (case-insensitive, first exact match). */
export async function resolveBySymbol(chainId: number, symbol: string): Promise<SwapToken | null> {
    const sym = (symbol || '').trim().toLowerCase()
    if (!sym) return null
    const map = await getSwapTokenMap(chainId)
    for (const k of Object.keys(map)) {
        if ((map[k].symbol || '').toLowerCase() === sym) return map[k]
    }
    return null
}

/**
 * Resolve a target token from free-text input that may be EITHER a contract
 * address (0x…) or a token symbol (e.g. "USDC"). Throws if it can't be found.
 *
 * Checked against the token registry **for the signer's own chain** (see
 * `evm/tokenRegistry.ts`) regardless of which path resolves it: an address the
 * user typed or pasted, and a symbol matched against LI.FI's own token list,
 * are both untrusted the same way a live contract call is — nothing stops a
 * scam token from deploying with symbol "USDC" (or "AVXTO", or "AVAX"). This is
 * the free-text swap/distribute target field, so there's no prior filtered
 * list this input was picked from. The registry only rejects an impostor of a
 * symbol it knows, though — a token it has no opinion on resolves same as it
 * always did.
 *
 * Per-chain rather than always Avalanche's: checking a Robinhood Chain address
 * against Avalanche's pinned contracts would reject every legitimate token that
 * happens to share a well-known symbol.
 */
export async function resolveTargetToken(signer: EvmSigner, input: string): Promise<SwapToken> {
    const q = (input || '').trim()
    if (!q) throw new Error('Enter a token address or symbol')
    const chainId = signer.network.evmChainId

    const resolved =
        isNativeToken(q) || isValidAddress(q)
            ? await resolveErc20Metadata(signer, q)
            : await resolveBySymbol(chainId, q)

    if (!resolved) throw new Error(`No token found for "${input}"`)

    if (
        !isNativeToken(resolved.address) &&
        signer.tokenRegistry().isSpoofedToken(resolved.symbol, resolved.address, chainId)
    ) {
        throw new Error(
            `${resolved.symbol} at this address doesn't match the token registry's known ` +
                `contract for ${resolved.symbol} on ${signer.network.name} — this looks like ` +
                'an impostor token.'
        )
    }

    return resolved
}

/** Current ERC20 allowance the owner has granted to the spender, on the signer's chain. */
export async function getAllowance(
    signer: EvmSigner,
    tokenAddress: string,
    owner: string,
    spender: string
): Promise<BN> {
    const contract = erc20(signer, tokenAddress)
    const allowance = await contract.methods.allowance(owner, spender).call()
    return new BN(allowance.toString())
}

/**
 * Approve `spender` (quote.approvalAddress) to spend `amount` of the given
 * ERC20 token. Returns the approval tx hash. (A native input never needs
 * approval — callers should check isNativeToken()/approvalAddress first.)
 *
 * `nonce` sequences this with the swap that follows: letting each send ask the
 * RPC for "the" current nonce independently is racy, since the approval may not
 * be visible as pending yet by the time the swap asks, so both can get the same
 * nonce and the second is rejected as "nonce too low".
 */
export async function approveRouter(
    signer: EvmSigner,
    tokenAddress: string,
    spender: string,
    amount: BN,
    nonce?: number
): Promise<string> {
    const data = erc20(signer, tokenAddress).methods.approve(spender, amount.toString()).encodeABI()

    const request = {
        to: tokenAddress,
        data,
        label: 'Approve router to spend token',
        nonce,
    }
    const gasLimit = await signer.estimateGas(request, 80_000)

    return await signer.send({ ...request, gasLimit })
}

/**
 * Broadcast the swap for a fetched quote. Assumes any required ERC20
 * approval has already been granted. Unlike Odos, LI.FI's quote already IS
 * the executable transaction — there's no separate assemble call here.
 */
export async function executeSwap(
    signer: EvmSigner,
    quote: SwapQuote,
    /** See `approveRouter` — pass when sequencing this with other sends. */
    nonce?: number
): Promise<SwapResult> {
    const txHash = await signer.send({
        to: quote.transactionRequest.to,
        data: quote.transactionRequest.data,
        value: parseValueToBN(quote.transactionRequest.value),
        // The aggregator priced the route against this figure; pad it by 20%
        // rather than re-estimating, which would probe a different state.
        gasLimit: Math.round(quote.gasLimit * 1.2),
        label: 'Execute swap',
        nonce,
    })
    return { txHash }
}

/**
 * Explorer URL for a swap transaction.
 *
 * Takes the network rather than a chain id: the previous signature could only
 * resolve Avalanche's two chains and sent every other chain's transactions to
 * snowtrace.
 */
export function swapExplorerTxUrl(network: EvmNetwork, txHash: string): string {
    return explorerTxUrl(network, txHash)
}
