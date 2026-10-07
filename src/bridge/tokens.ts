/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Tokens for the Bridge page:
 *
 *  - what can be SENT: what the wallet actually holds on the source chain (its
 *    portfolio), so the picker never offers something there is nothing of;
 *  - what can be RECEIVED: open ended, found by symbol or name — the local
 *    registries first (pinned, verified addresses), and only when they have no
 *    match, public token services: the Uniswap token list (EVM chains, one
 *    cached download) and CoinGecko's search (every chain, Solana included).
 *
 * Web results are suggestions, never trusted blindly: an EVM token's symbol and
 * decimals are re-read from the chain when it is picked (`resolveToken`), and
 * results that are not in a local registry are marked unverified.
 */
import axios from 'axios'
import { PublicKey } from '@solana/web3.js'

import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { scanNetwork } from '@/stores/evmPortfolio'
import { getRegistry } from '@/platforms/avalanche/tokenRegistry'
import { SOLANA_TOKENS } from '@/solana/tokenRegistry'
import { getSolanaNetworkById } from '@/solana/networks'
import { connectionFor } from '@/solana/rpc'
import { isRegistryToken } from '@/helpers/registry_token'
import { readBalance, readTokenAsset, solanaHeldTokens, nativeAsset } from './assets'
import { NATIVE, type BridgeAsset, type BridgeChain } from './types'

const TIMEOUT_MS = 15_000
const MAX_SUGGESTIONS = 8
export const UNISWAP_TOKEN_LIST = 'https://tokens.uniswap.org'
export const COINGECKO_API = 'https://api.coingecko.com/api/v3'

/** CoinGecko's platform ids for the chains the bridge serves. */
const COINGECKO_PLATFORMS: Record<string, string> = {
    'evm:1': 'ethereum',
    'evm:43114': 'avalanche',
    'evm:8453': 'base',
    'evm:42161': 'arbitrum-one',
    'evm:10': 'optimistic-ethereum',
    'evm:137': 'polygon-pos',
    'evm:56': 'binance-smart-chain',
    'solana:mainnet-beta': 'solana',
}

export interface HeldToken extends BridgeAsset {
    /** Base units. */
    balance: bigint
    /** In a local registry (or the chain's native coin). */
    verified: boolean
}

export type SuggestionSource = 'native' | 'registry' | 'tokenlist' | 'coingecko'

export interface TokenSuggestion {
    chainId: string
    /** `NATIVE`, or contract address / mint. */
    address: string
    symbol: string
    name: string
    /** Null when the source did not say; resolved on pick. */
    decimals: number | null
    source: SuggestionSource
    verified: boolean
}

// ─── Send: the portfolio ─────────────────────────────────────────────────

/** What `owner` holds on `chain`, native coin first. Never throws: the native coin is always offered. */
export async function portfolioTokens(chain: BridgeChain, owner: string): Promise<HeldToken[]> {
    const native: HeldToken = Object.assign(nativeAsset(chain), { balance: BigInt(0), verified: true })
    if (!owner) return [native]
    try {
        if (chain.kind === 'evm') {
            const network = getEvmNetworkByChainId(chain.evmChainId ?? -1)
            if (!network) return [native]
            const res = await scanNetwork(owner, network)
            const tokens = res.tokens.map(
                (t): HeldToken => ({
                    chainId: chain.id,
                    address: t.isNative ? NATIVE : t.address,
                    symbol: t.symbol,
                    name: t.name,
                    decimals: t.decimals,
                    balance: BigInt(t.raw),
                    verified: t.isNative || isRegistryToken(t.address, chain.evmChainId),
                })
            )
            if (!tokens.some((t) => t.address === NATIVE)) {
                native.balance = (await readBalance(chain, native, owner)) ?? BigInt(0)
                tokens.unshift(native)
            }
            return sortHeld(tokens)
        }
        native.balance = (await readBalance(chain, native, owner)) ?? BigInt(0)
        if (chain.kind === 'solana') {
            const held = await solanaHeldTokens(chain)
            const withBalances = await Promise.all(
                held.map(async (t): Promise<HeldToken> => ({
                    ...t,
                    balance: (await readBalance(chain, t, owner)) ?? BigInt(0),
                    verified: SOLANA_TOKENS.some((r) => r.contractAddress === t.address),
                }))
            )
            return sortHeld([native].concat(withBalances))
        }
        return [native]
    } catch (e) {
        console.warn('[bridge/tokens] portfolio unavailable:', e)
        return [native]
    }
}

function sortHeld(tokens: HeldToken[]): HeldToken[] {
    return tokens
        .filter((t) => t.address === NATIVE || t.balance > BigInt(0))
        .sort((a, b) => {
            if ((a.address === NATIVE) !== (b.address === NATIVE)) return a.address === NATIVE ? -1 : 1
            if (a.verified !== b.verified) return a.verified ? -1 : 1
            return a.symbol.localeCompare(b.symbol)
        })
}

// ─── Receive: registry, then the web ────────────────────────────────────

/** Tokens the local registries pin for `chain` (decimals where the registry has them). */
export function registryTokens(chain: BridgeChain): TokenSuggestion[] {
    if (chain.kind === 'evm') {
        return getRegistry()
            .filter((t) => t.contractAddress && /^0x[0-9a-fA-F]{40}$/.test(t.contractAddress) && t.chainId === chain.evmChainId)
            .map((t) => ({
                chainId: chain.id,
                address: t.contractAddress as string,
                symbol: t.symbol,
                name: t.name,
                decimals: null,
                source: 'registry' as const,
                verified: true,
            }))
    }
    if (chain.kind === 'solana' && !chain.isTestnet) {
        return SOLANA_TOKENS.filter((t) => t.contractAddress).map((t) => ({
            chainId: chain.id,
            address: t.contractAddress as string,
            symbol: t.symbol,
            name: t.name,
            decimals: (t as { decimals?: number }).decimals ?? null,
            source: 'registry' as const,
            verified: true,
        }))
    }
    return []
}

function matches(q: string, symbol: string, name: string): 'exact' | 'prefix' | 'name' | null {
    const s = symbol.toLowerCase()
    if (s === q) return 'exact'
    if (s.startsWith(q)) return 'prefix'
    if (name.toLowerCase().includes(q)) return 'name'
    return null
}

const RANK = { exact: 0, prefix: 1, name: 2 }

function rankLocal(chain: BridgeChain, q: string): TokenSuggestion[] {
    const nativeEntry: TokenSuggestion = {
        chainId: chain.id,
        address: NATIVE,
        symbol: chain.native.symbol,
        name: chain.native.name,
        decimals: chain.native.decimals,
        source: 'native',
        verified: true,
    }
    return [nativeEntry]
        .concat(registryTokens(chain))
        .map((t) => ({ t, m: matches(q, t.symbol, t.name) }))
        .filter((x) => x.m)
        .sort((a, b) => RANK[a.m!] - RANK[b.m!])
        .map((x) => x.t)
}

let uniswapList: Promise<any[]> | null = null
function loadUniswapList(): Promise<any[]> {
    if (!uniswapList) {
        uniswapList = axios
            .get(UNISWAP_TOKEN_LIST, { timeout: TIMEOUT_MS })
            .then((r) => (Array.isArray(r.data?.tokens) ? r.data.tokens : []))
        uniswapList.catch(() => {
            uniswapList = null
        })
    }
    return uniswapList
}

async function fromTokenList(chain: BridgeChain, q: string): Promise<TokenSuggestion[]> {
    if (chain.kind !== 'evm') return []
    const tokens = await loadUniswapList()
    return tokens
        .filter((t) => t.chainId === chain.evmChainId && typeof t.address === 'string' && typeof t.symbol === 'string')
        .map((t) => ({ t, m: matches(q, t.symbol, t.name ?? '') }))
        .filter((x) => x.m)
        .sort((a, b) => RANK[a.m!] - RANK[b.m!])
        .map(
            ({ t }): TokenSuggestion => ({
                chainId: chain.id,
                address: t.address,
                symbol: t.symbol,
                name: t.name ?? t.symbol,
                decimals: Number.isInteger(t.decimals) ? t.decimals : null,
                source: 'tokenlist',
                verified: isRegistryToken(t.address, chain.evmChainId),
            })
        )
}

async function fromCoinGecko(chain: BridgeChain, q: string): Promise<TokenSuggestion[]> {
    const platform = COINGECKO_PLATFORMS[chain.id]
    if (!platform) return []
    const { data } = await axios.get(`${COINGECKO_API}/search`, { params: { query: q }, timeout: TIMEOUT_MS })
    const coins: any[] = (Array.isArray(data?.coins) ? data.coins : []).slice(0, 4)
    const details = await Promise.allSettled(
        coins.map((c) =>
            axios.get(`${COINGECKO_API}/coins/${encodeURIComponent(c.id)}`, {
                params: { localization: false, tickers: false, market_data: false, community_data: false, developer_data: false },
                timeout: TIMEOUT_MS,
            })
        )
    )
    const out: TokenSuggestion[] = []
    details.forEach((d, i) => {
        if (d.status !== 'fulfilled') return
        const p = d.value.data?.detail_platforms?.[platform]
        const address = String(p?.contract_address ?? '')
        if (!address) return
        out.push({
            chainId: chain.id,
            address,
            symbol: String(coins[i].symbol ?? '').toUpperCase(),
            name: String(coins[i].name ?? ''),
            decimals: Number.isInteger(p?.decimal_place) ? p.decimal_place : null,
            source: 'coingecko',
            verified: chain.kind === 'evm' ? isRegistryToken(address, chain.evmChainId) : SOLANA_TOKENS.some((r) => r.contractAddress === address),
        })
    })
    return out
}

export interface SuggestResult {
    suggestions: TokenSuggestion[]
    /** True when the local registries had no match and the web was searched. */
    searchedWeb: boolean
    /** Set when a web service failed (the other results still stand). */
    webError?: string
}

/** Tokens on `chain` matching `query` by symbol or name: registry first, the web only when it has nothing. */
export async function suggestReceiveTokens(chain: BridgeChain, query: string): Promise<SuggestResult> {
    const q = query.trim().toLowerCase()
    if (!q) return { suggestions: [], searchedWeb: false }
    const local = rankLocal(chain, q)
    if (local.length) return { suggestions: local.slice(0, MAX_SUGGESTIONS), searchedWeb: false }
    if (chain.isTestnet || chain.kind === 'bitcoin') return { suggestions: [], searchedWeb: false }

    const out: TokenSuggestion[] = []
    let webError: string | undefined
    const add = (list: TokenSuggestion[]) => {
        for (const t of list) {
            if (!out.some((o) => o.address.toLowerCase() === t.address.toLowerCase())) out.push(t)
        }
    }
    try {
        add(await fromTokenList(chain, q))
    } catch {
        webError = 'The Uniswap token list could not be loaded.'
    }
    if (out.length < 3) {
        try {
            add(await fromCoinGecko(chain, q))
        } catch {
            webError = 'CoinGecko search failed (it is rate-limited; try again shortly).'
        }
    }
    return { suggestions: out.slice(0, MAX_SUGGESTIONS), searchedWeb: true, webError }
}

/**
 * The picked suggestion as a bridge asset, with decimals and symbol confirmed
 * on chain for EVM tokens (a web list could be stale or wrong) and read from
 * the mint for Solana tokens whose source did not say.
 */
export async function resolveToken(chain: BridgeChain, t: TokenSuggestion): Promise<BridgeAsset> {
    if (t.address === NATIVE) return nativeAsset(chain)
    if (chain.kind === 'evm') {
        const onChain = await readTokenAsset(chain, t.address)
        return Object.assign(onChain, { name: onChain.name || t.name })
    }
    if (chain.kind === 'solana') {
        let decimals = t.decimals
        if (decimals === null) {
            const network = getSolanaNetworkById(chain.networkId ?? '')
            if (!network) throw new Error('Unknown Solana network.')
            const info: any = await connectionFor(network).getParsedAccountInfo(new PublicKey(t.address))
            decimals = info?.value?.data?.parsed?.info?.decimals
            if (typeof decimals !== 'number') throw new Error(`${t.address} is not a token mint on ${chain.name}.`)
        }
        return { chainId: chain.id, address: t.address, symbol: t.symbol, name: t.name, decimals }
    }
    throw new Error(`${chain.name} has no tokens.`)
}

/** Whether a route delivers `want` (native coin, or the same token address). */
export function deliversToken(received: BridgeAsset, want: BridgeAsset): boolean {
    if (want.address === NATIVE || received.address === NATIVE) return want.address === received.address
    return want.address.toLowerCase() === received.address.toLowerCase()
}
