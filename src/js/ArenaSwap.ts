/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
  ArenaSwap - token swapping on the Avalanche C-Chain.

  ArenaTrade (arenatrade.ai) routes its swaps through the Odos aggregator
  (api.odos.xyz), which is a public, key-less, CORS-enabled REST API. This
  module reproduces that exact flow entirely in the browser:

    1. quote     POST /sor/quote/v2   -> best route + pathId
    2. (approve) ERC20 allowance to the Odos router, if the input is not native
    3. assemble  POST /sor/assemble   -> a ready-to-sign transaction
    4. execute   sign with the active wallet + broadcast over the C-Chain RPC

  No native/local programs are involved: only HTTP fetches and standard
  in-browser transaction signing (the same path used by the token launcher).
*/
import axios from 'axios'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'
import { AvaWalletCore } from '@/js/wallets/types'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

const ODOS_BASE = 'https://api.odos.xyz'
export const AVALANCHE_CHAIN_ID = 43114

// Odos uses the zero address to denote the chain's native token (AVAX here).
export const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000'

// Odos Router V2 on Avalanche C-Chain — the spender ERC20 inputs approve, and
// the `to` of the assembled swap transaction. Resolved live from the API with
// this as a fallback (see getRouterAddress).
const ODOS_ROUTER_FALLBACK = '0x88de50B233052e4Fb783d4F6db78Cc34fEa3e9FC'

// ArenaTrade attributes swaps with a referral code; 0 means "no referral".
const REFERRAL_CODE = 0

export interface SwapToken {
    address: string // 0x0000..0000 for native AVAX
    symbol: string
    name: string
    decimals: number
}

export interface OdosQuote {
    pathId: string
    inAmounts: string[]
    outAmounts: string[]
    inValues: number[]
    outValues: number[]
    netOutValue: number
    priceImpact: number | null
    gasEstimate: number
}

export interface SwapResult {
    txHash: string
}

let cachedRouter: string | null = null

export function isNativeToken(address: string): boolean {
    return address.toLowerCase() === NATIVE_TOKEN_ADDRESS
}

/** Resolve the Odos router address for Avalanche (cached), with a fallback. */
export async function getRouterAddress(): Promise<string> {
    if (cachedRouter) return cachedRouter
    try {
        const { data } = await axios.get(`${ODOS_BASE}/info/router/v2/${AVALANCHE_CHAIN_ID}`)
        cachedRouter = data.address || ODOS_ROUTER_FALLBACK
    } catch (e) {
        cachedRouter = ODOS_ROUTER_FALLBACK
    }
    return cachedRouter as string
}

/**
 * Request a swap quote. `amountInRaw` is the input amount in base units
 * (already scaled by the input token's decimals).
 */
export async function getQuote(params: {
    tokenIn: SwapToken
    tokenOut: SwapToken
    amountInRaw: BN
    userAddress: string
    slippagePercent: number
}): Promise<OdosQuote> {
    const body = {
        chainId: AVALANCHE_CHAIN_ID,
        inputTokens: [
            { tokenAddress: params.tokenIn.address, amount: params.amountInRaw.toString() },
        ],
        outputTokens: [{ tokenAddress: params.tokenOut.address, proportion: 1 }],
        userAddr: params.userAddress,
        slippageLimitPercent: params.slippagePercent,
        referralCode: REFERRAL_CODE,
        disableRFQs: false,
        compact: true,
    }
    try {
        const { data } = await axios.post(`${ODOS_BASE}/sor/quote/v2`, body, {
            headers: { 'Content-Type': 'application/json' },
        })
        if (!data.pathId) throw new Error('No route found for this pair')
        return data as OdosQuote
    } catch (e: any) {
        throw new Error(odosError(e, 'Failed to get a swap quote'))
    }
}

/**
 * Assemble the executable transaction for a previously-quoted path.
 * Returns the raw Odos `transaction` object ({ to, data, value, gas, ... }).
 */
export async function assembleTransaction(
    userAddress: string,
    pathId: string
): Promise<{ to: string; data: string; value: string; gas: number }> {
    try {
        const { data } = await axios.post(
            `${ODOS_BASE}/sor/assemble`,
            { userAddr: userAddress, pathId, simulate: false },
            { headers: { 'Content-Type': 'application/json' } }
        )
        if (!data.transaction) throw new Error('Assembler returned no transaction')
        return data.transaction
    } catch (e: any) {
        throw new Error(odosError(e, 'Failed to assemble the swap transaction'))
    }
}

/** Parse a wei value that may arrive as a decimal or 0x-hex string. */
function parseValueToBN(v: string | number | undefined): BN {
    const s = (v ?? '0').toString().trim()
    if (s.startsWith('0x') || s.startsWith('0X')) return new BN(s.slice(2) || '0', 16)
    return new BN(s || '0', 10)
}

function odosError(e: any, fallback: string): string {
    const detail = e?.response?.data?.detail || e?.response?.data?.message
    if (detail) return typeof detail === 'string' ? detail : JSON.stringify(detail)
    return e?.message || fallback
}

/** True if the string is a well-formed 0x EVM address. */
export function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test((address || '').trim())
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
 * Fetch (and cache) the aggregator's curated token map for Avalanche, keyed by
 * lowercased address. Used to resolve a user-typed symbol to an address.
 */
export async function getOdosTokenMap(): Promise<Record<string, SwapToken>> {
    if (cachedTokenMap) return cachedTokenMap
    const { data } = await axios.get(`${ODOS_BASE}/info/tokens/${AVALANCHE_CHAIN_ID}`)
    const tm = data.tokenMap || {}
    const map: Record<string, SwapToken> = {}
    for (const addr of Object.keys(tm)) {
        const t = tm[addr]
        map[addr.toLowerCase()] = {
            address: addr,
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
    const map = await getOdosTokenMap()
    for (const k of Object.keys(map)) {
        if ((map[k].symbol || '').toLowerCase() === sym) return map[k]
    }
    return null
}

/**
 * Resolve a target token from free-text input that may be EITHER a contract
 * address (0x…) or a token symbol (e.g. "USDC"). Throws if it can't be found.
 */
export async function resolveTargetToken(input: string): Promise<SwapToken> {
    const q = (input || '').trim()
    if (!q) throw new Error('Enter a token address or symbol')
    if (isNativeToken(q) || isValidAddress(q)) {
        return resolveErc20Metadata(q)
    }
    const bySymbol = await resolveBySymbol(q)
    if (bySymbol) return bySymbol
    throw new Error(`No token found for "${input}"`)
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
 */
async function sendEvmTx(
    wallet: AvaWalletCore,
    txReq: { to: string; data: string; value: BN },
    gasPrice: BN,
    gasLimit: number
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
            chain: null,
        } as any)
        return hash
    }

    const nonce = await web3.eth.getTransactionCount(fromAddr, 'pending')
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    const tx = new Transaction(
        {
            nonce,
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
    const receipt = await web3.eth.sendSignedTransaction('0x' + txHex)
    return receipt.transactionHash
}

/**
 * Approve the Odos router to spend `amount` of the given ERC20 token.
 * Returns the approval tx hash. (Native AVAX never needs approval.)
 */
export async function approveRouter(
    wallet: AvaWalletCore,
    tokenAddress: string,
    amount: BN,
    gasPrice: BN
): Promise<string> {
    const spender = await getRouterAddress()
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

    return sendEvmTx(wallet, { to: tokenAddress, data, value: new BN(0) }, gasPrice, gasLimit)
}

/**
 * Assemble and broadcast the swap for a quoted path. Assumes any required
 * ERC20 approval has already been granted.
 */
export async function executeSwap(
    wallet: AvaWalletCore,
    userAddress: string,
    quote: OdosQuote,
    gasPrice: BN
): Promise<SwapResult> {
    const transaction = await assembleTransaction(userAddress, quote.pathId)

    // Pad the aggregator's gas estimate by 20% for safety.
    const gasLimit = Math.round(Number(transaction.gas || quote.gasEstimate || 500000) * 1.2)
    const value = parseValueToBN(transaction.value)

    const txHash = await sendEvmTx(
        wallet,
        { to: transaction.to, data: transaction.data, value },
        gasPrice,
        gasLimit
    )
    return { txHash }
}

/** Snowtrace transaction URL for the given hash. */
export function cChainExplorerTxUrl(txHash: string, evmChainId: number): string {
    const base = evmChainId === 43113 ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
    return `${base}/tx/${txHash}`
}
