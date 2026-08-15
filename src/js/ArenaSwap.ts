/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
  ArenaSwap - token swapping on the Avalanche C-Chain.

  Routes swaps through LI.FI (li.quest), the same aggregator ArenaTrade's own
  frontend calls directly from the browser for this exact AVAX-on-Avalanche
  swap flow — confirmed from a HAR capture of a real ArenaTrade trade: no
  api.odos.xyz request appears anywhere in it, only li.quest and (for a price
  display, not execution) api.paraswap.io. This module previously called Odos
  directly, which — unlike li.quest — rejects requests from this app's origin
  with a CORS error (no Access-Control-Allow-Origin on the preflight
  response); there is no client-side fix for that, only routing through an
  aggregator whose CORS policy actually allows us.

  LI.FI's /v1/quote returns a ready-to-sign transaction in the same response
  as the quote — no separate "assemble" step the way Odos needed:

    1. quote     GET /v1/quote  -> priced route + transactionRequest + approvalAddress
    2. (approve) ERC20 allowance to quote.approvalAddress, if the input is not native
    3. execute   sign quote.transactionRequest with the active wallet + broadcast

  No native/local programs are involved: only HTTP fetches and standard
  in-browser transaction signing (the same path used by the token launcher).

  Unverified against a live swap — I could not reach li.quest or its docs
  from the sandbox this was written in (network egress restrictions), so this
  is built from the HAR's captured request shape plus LI.FI's documented
  response shape, not a request/response pair I've actually exercised myself.
*/
import axios from 'axios'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'
import { AvaWalletCore } from '@/js/wallets/types'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { broadcastEvm } from '@/helpers/broadcastEvm'
import { findRegistryToken } from '@/token-registry'

const LIFI_BASE = 'https://li.quest'
export const AVALANCHE_CHAIN_ID = 43114

// LI.FI uses the zero address to denote the chain's native token (AVAX here) —
// same convention Odos used, so this didn't need to change.
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

// Identifies this app to LI.FI (their analytics/fee-attribution, mirroring
// ArenaTrade's own `integrator=arena.social`) — not a registered partner
// account, so no `fee` param is sent (that requires a configured recipient
// on LI.FI's side; omitting it just means no referral revenue share, not an
// error).
const INTEGRATOR = 'avxto-wallet'

export interface SwapToken {
    address: string // 0x0000..0000 for native AVAX
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
    /** ERC20 spender to approve for a non-native input — null when the input is native AVAX. */
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
    const detail = e?.response?.data?.message || e?.response?.data?.error || e?.response?.data?.detail
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail)
    return e?.message || fallback
}

/** True if the string is a well-formed 0x EVM address. */
export function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test((address || '').trim())
}

/**
 * Request a priced, ready-to-execute route. `amountInRaw` is the input
 * amount in base units (already scaled by the input token's decimals).
 */
export async function getQuote(params: {
    tokenIn: SwapToken
    tokenOut: SwapToken
    amountInRaw: BN
    userAddress: string
    slippagePercent: number
}): Promise<SwapQuote> {
    try {
        const { data } = await axios.get(`${LIFI_BASE}/v1/quote`, {
            params: {
                fromChain: AVALANCHE_CHAIN_ID,
                toChain: AVALANCHE_CHAIN_ID,
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

        const gasLimitRaw =
            tx.gasLimit ?? data.estimate?.gasCosts?.[0]?.limit ?? 500000
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
 * hold. Throws if the address is not a readable ERC20.
 */
export async function resolveErc20Metadata(address: string): Promise<SwapToken> {
    if (isNativeToken(address)) {
        return { address: NATIVE_TOKEN_ADDRESS, symbol: 'AVAX', name: 'Avalanche', decimals: 18 }
    }
    if (!isValidAddress(address)) {
        throw new Error('Enter a valid token contract address (0x…)')
    }
    // @ts-ignore - web3 typing for dynamic ABI
    const contract = new web3.eth.Contract(ERC20Abi.abi as any, address)
    try {
        const [symbol, decimals, name] = await Promise.all([
            contract.methods.symbol().call(),
            contract.methods.decimals().call(),
            contract.methods.name().call().catch(() => ''),
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

let cachedTokenMap: Record<string, SwapToken> | null = null

/**
 * Fetch (and cache) LI.FI's curated token list for Avalanche, keyed by
 * lowercased address. Used to resolve a user-typed symbol to an address.
 */
export async function getSwapTokenMap(): Promise<Record<string, SwapToken>> {
    if (cachedTokenMap) return cachedTokenMap
    const { data } = await axios.get(`${LIFI_BASE}/v1/tokens`, {
        params: { chains: AVALANCHE_CHAIN_ID },
    })
    const list: any[] = data.tokens?.[AVALANCHE_CHAIN_ID] ?? data.tokens?.[String(AVALANCHE_CHAIN_ID)] ?? []
    const map: Record<string, SwapToken> = {}
    for (const t of list) {
        map[(t.address || '').toLowerCase()] = {
            address: t.address,
            symbol: t.symbol,
            name: t.name,
            decimals: parseInt(t.decimals) || 18,
        }
    }
    cachedTokenMap = map
    return map
}

/** Find a tradable token by its symbol (case-insensitive, first exact match). */
export async function resolveBySymbol(symbol: string): Promise<SwapToken | null> {
    const sym = (symbol || '').trim().toLowerCase()
    if (!sym) return null
    const map = await getSwapTokenMap()
    for (const k of Object.keys(map)) {
        if ((map[k].symbol || '').toLowerCase() === sym) return map[k]
    }
    return null
}

/**
 * Resolve a target token from free-text input that may be EITHER a contract
 * address (0x…) or a token symbol (e.g. "USDC"). Throws if it can't be found.
 *
 * Gated by the token registry (see token-registry/index.ts) regardless of
 * which path resolves it: an address the user typed or pasted, and a symbol
 * matched against LI.FI's own token list, are both untrusted input the same
 * way a live contract call is — nothing stops a scam token from deploying
 * with symbol "USDC", and this is the free-text swap/distribute target field,
 * so there's no prior list this input was picked from to have already
 * filtered it.
 */
export async function resolveTargetToken(input: string): Promise<SwapToken> {
    const q = (input || '').trim()
    if (!q) throw new Error('Enter a token address or symbol')

    const resolved = isNativeToken(q) || isValidAddress(q)
        ? await resolveErc20Metadata(q)
        : await resolveBySymbol(q)

    if (!resolved) throw new Error(`No token found for "${input}"`)

    if (!isNativeToken(resolved.address) && !findRegistryToken(resolved.address, AVALANCHE_CHAIN_ID)) {
        throw new Error(
            `${resolved.symbol} is not in the AVXTO token registry and can't be selected.`
        )
    }

    return resolved
}

/** Current ERC20 allowance the owner has granted to the spender. */
export async function getAllowance(
    tokenAddress: string,
    owner: string,
    spender: string
): Promise<BN> {
    // @ts-ignore - web3 typing for dynamic ABI
    const contract = new web3.eth.Contract(ERC20Abi.abi as any, tokenAddress)
    const allowance = await contract.methods.allowance(owner, spender).call()
    return new BN(allowance.toString())
}

/**
 * Broadcast a signed EVM transaction from the active wallet. Handles both
 * locally-signing wallets and injected browser wallets.
 *
 * Accepts an explicit `nonce` for callers sequencing several sends back-to-
 * back (approve-then-swap, or an iceberg order's per-chunk swaps) — letting
 * each send ask the wallet/RPC for "the" current nonce independently is
 * racy, since the previous send may not be visible as pending yet by the
 * time the next one asks, so two sends can get the same nonce and the
 * second is rejected as "nonce too low" / "already used". Same fix already
 * applied to InjectedWallet.sendEth/sendERC20 and WalletWizard's batch send,
 * for the identical reason.
 */
async function sendEvmTx(
    wallet: AvaWalletCore,
    txReq: { to: string; data: string; value: BN },
    gasPrice: BN,
    gasLimit: number,
    /** Description used when offline signing captures this instead of sending. */
    label = 'C-Chain transaction',
    nonce?: number
): Promise<string> {
    const fromAddr = '0x' + wallet.getEvmAddress()

    if (wallet.type === 'injected') {
        const provider = (wallet as any).provider
        const { createWalletClient, custom, publicActions } = await import('viem')
        const walletClient = createWalletClient({ transport: custom(provider) }).extend(
            publicActions
        )
        const hash = await walletClient.sendTransaction({
            account: fromAddr as `0x${string}`,
            to: txReq.to as `0x${string}`,
            data: txReq.data as `0x${string}`,
            value: BigInt(txReq.value.toString()),
            gasPrice: BigInt(gasPrice.toString()),
            gas: BigInt(gasLimit),
            ...(nonce !== undefined ? { nonce } : {}),
            chain: null,
        } as any)
        return hash
    }

    const resolvedNonce = nonce ?? (await web3.eth.getTransactionCount(fromAddr, 'pending'))
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    const tx = new Transaction(
        {
            nonce: resolvedNonce,
            gasPrice,
            gasLimit,
            to: txReq.to,
            value: txReq.value,
            data: txReq.data,
        },
        chainParams
    )

    const signedTx = await wallet.signEvm(tx)
    const txHex = signedTx.serialize().toString('hex')
    return await broadcastEvm(txHex, label)
}

/**
 * Approve `spender` (quote.approvalAddress) to spend `amount` of the given
 * ERC20 token. Returns the approval tx hash. (Native AVAX never needs
 * approval — callers should check isNativeToken()/approvalAddress first.)
 */
export async function approveRouter(
    wallet: AvaWalletCore,
    tokenAddress: string,
    spender: string,
    amount: BN,
    gasPrice: BN,
    /** See sendEvmTx — pass when sequencing this with other sends (e.g. the swap that follows). */
    nonce?: number
): Promise<string> {
    // @ts-ignore - web3 typing for dynamic ABI
    const contract = new web3.eth.Contract(ERC20Abi.abi as any, tokenAddress)
    const data = contract.methods.approve(spender, amount.toString()).encodeABI()

    const fromAddr = '0x' + wallet.getEvmAddress()
    let gasLimit = 80_000
    try {
        const est = await web3.eth.estimateGas({ from: fromAddr, to: tokenAddress, data })
        gasLimit = Math.round(Number(est) * 1.2)
    } catch (e) {
        /* keep default */
    }

    return sendEvmTx(
        wallet,
        { to: tokenAddress, data, value: new BN(0) },
        gasPrice,
        gasLimit,
        'Approve router to spend token',
        nonce
    )
}

/**
 * Broadcast the swap for a fetched quote. Assumes any required ERC20
 * approval has already been granted. Unlike Odos, LI.FI's quote already IS
 * the executable transaction — there's no separate assemble call here.
 */
export async function executeSwap(
    wallet: AvaWalletCore,
    quote: SwapQuote,
    gasPrice: BN,
    /** See sendEvmTx — pass when sequencing this with other sends (e.g. an iceberg order's chunks). */
    nonce?: number
): Promise<SwapResult> {
    // Pad the aggregator's gas estimate by 20% for safety.
    const gasLimit = Math.round(quote.gasLimit * 1.2)
    const value = parseValueToBN(quote.transactionRequest.value)

    const txHash = await sendEvmTx(
        wallet,
        { to: quote.transactionRequest.to, data: quote.transactionRequest.data, value },
        gasPrice,
        gasLimit,
        'Execute swap',
        nonce
    )
    return { txHash }
}

/** Snowtrace transaction URL for the given hash. */
export function cChainExplorerTxUrl(txHash: string, evmChainId: number): string {
    const base = evmChainId === 43113 ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
    return `${base}/tx/${txHash}`
}
