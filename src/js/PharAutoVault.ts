/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Everything phar.gg's AutoVault page reads, gathered from the same places —
 * reconstructed from HARs of that page (tmp/phar/autovault-web.har) and of the
 * Core extension serving it (autovault-ext.har). The HARs were exported
 * without response bodies, so the calls below are the ones the page makes;
 * their shapes were confirmed against live responses.
 *
 *  1. The contracts, all verified on Routescan, read through a C-Chain
 *     connection of our own (so the page works on any tab):
 *       - AutoVault — the viewer's shares, pending rewards and payout token;
 *         the vault's size, payout tokens, queued reward swaps and lock state.
 *         Deposits are xPHAR; the vault votes with them every epoch and pays
 *         the rewards out in the token each depositor picked.
 *       - xPHAR — the viewer's wallet balance and allowance to the vault.
 *       - Minter — the epoch ("period") clock and weekly emissions.
 *       - Voter — the vault's votes this epoch and next. The page asks for the
 *         viewer's own votes too; those are empty for a vault depositor, since
 *         the vault votes on their behalf, so the vault's are what is shown.
 *  2. Pharaoh's API (gateway.kingdomsubgraph.com, which allows cross-origin
 *     GETs) — protocol figures, token prices, and pool names for the votes.
 *     Each call is optional: a failure blanks that panel, not the page.
 *
 * Left out: the page's balanceOf sweep over ~100 tokens (a wallet balance
 * list, not vault data), an ENS reverse lookup on Ethereum mainnet, the
 * concentrated-liquidity positions endpoint (empty for vault depositors), and
 * the extension HAR's Core-internal services (DeBank proxy, Core balance API),
 * which are behind Core's own proxy.
 */
import axios from 'axios'

import { BN } from '@/avalanche'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'

export const AUTOVAULT_ADDRESS = '0xfe99e92df71f53a26005d1bfbe54c941a3131aa0'
export const XPHAR_ADDRESS = '0xe8164ea89665dab7a553e667f81f30cfda736b9a'
export const PHAR_MINTER_ADDRESS = '0xd23f124bbbc958bcddc0ce624042b48154222fde'
export const PHAR_VOTER_ADDRESS = '0x922b9ca8e2207bfb850b6ff647c054d4b58a2aa7'
export const PHAR_API = 'https://gateway.kingdomsubgraph.com/avalanche/api'
export const AUTOVAULT_APP_URL = 'https://www.phar.gg/autovault'
const PHAR_CHAIN_ID = 43114
/** Pharaoh epochs are weekly, numbered from the Unix epoch. */
export const PHAR_PERIOD_SECONDS = 604_800
const HTTP_TIMEOUT_MS = 15_000

const view = (name: string, inputs: string[], outputs: string[]) => ({
    name,
    type: 'function',
    stateMutability: 'view',
    inputs: inputs.map((type, i) => ({ name: `a${i}`, type })),
    outputs: outputs.map((type, i) => ({ name: `r${i}`, type })),
})

const VAULT_ABI = [
    view('balanceOf', ['address'], ['uint256']),
    view('earned', ['address'], ['uint256']),
    view('getStoredRewards', ['address'], ['uint256']),
    view('outputPreference', ['address'], ['address']),
    view('totalSupply', [], ['uint256']),
    view('getOutputTokens', [], ['address[]']),
    view('totalSupplyPerOutput', ['address'], ['uint256']),
    view('isUnlocked', [], ['bool']),
    view('getPeriod', [], ['uint256']),
    view('getPendingSwaps', [], ['address[]', 'address[]', 'uint256[]']),
    view('getClaimedInputTokens', [], ['address[]']),
    view('OPERATOR', [], ['address']),
]
const ERC20_ABI = [
    view('balanceOf', ['address'], ['uint256']),
    view('allowance', ['address', 'address'], ['uint256']),
    view('totalSupply', [], ['uint256']),
    view('symbol', [], ['string']),
    view('decimals', [], ['uint8']),
]
const XPHAR_ABI = [...ERC20_ABI, view('SLASHING_PENALTY', [], ['uint256']), view('BASIS', [], ['uint256'])]
const MINTER_ABI = [view('getPeriod', [], ['uint256']), view('weeklyEmissions', [], ['uint256'])]
const VOTER_ABI = [view('getVotes', ['address', 'uint256'], ['address[]', 'uint256[]'])]

const toBN = (v: unknown): BN => new BN(String(v))
const lower = (a: string) => String(a).toLowerCase()

// ─── On-chain ──────────────────────────────────────────────────────────────

export interface TokenInfo {
    address: string
    symbol: string
    decimals: number
    /** USD, when Pharaoh's API prices it. */
    price: number | null
}

export interface PendingSwap {
    input: string
    output: string
    /** In the input token's units. */
    amount: BN
}

export interface VaultVote {
    pool: string
    weight: BN
}

export interface AutoVaultStats {
    /** xPHAR deposited by everyone (1 share = 1 xPHAR). */
    totalShares: BN
    isUnlocked: boolean
    period: number
    operator: string
    /** Payout tokens, with the shares that chose each. */
    outputs: { token: string; shares: BN }[]
    pendingSwaps: PendingSwap[]
    /** Tokens the vault has claimed as voting rewards, to be swapped into payouts. */
    claimedInputTokens: string[]
    votesThisPeriod: VaultVote[]
    votesNextPeriod: VaultVote[]
    weeklyEmissions: BN
    xpharTotalSupply: BN
    /** Instant-exit penalty on xPHAR → PHAR, as a fraction (0.5 = 50%). */
    xpharExitPenalty: number
}

export interface AutoVaultUser {
    address: string
    shares: BN
    /** Rewards ready to claim, in the payout token's units. */
    earned: BN
    storedRewards: BN
    outputPreference: string
    xpharBalance: BN
    xpharAllowance: BN
}

export interface AutoVaultOnChain {
    vault: AutoVaultStats
    user: AutoVaultUser | null
}

function cChainWeb3() {
    const network = getEvmNetworkByChainId(PHAR_CHAIN_ID)
    if (!network) throw new Error('Avalanche C-Chain is missing from the network registry.')
    return web3For(network)
}

const votes = (res: any): VaultVote[] => {
    const pools: string[] = res?.[0] ?? []
    const weights: unknown[] = res?.[1] ?? []
    return pools.map((pool, i) => ({ pool, weight: toBN(weights[i]) }))
}

/**
 * The vault's figures and, when `user` is given, the viewer's. `user` is the
 * viewer's EVM address — the same on every EVM chain.
 */
export async function readAutoVaultOnChain(user: string | null): Promise<AutoVaultOnChain> {
    const web3 = cChainWeb3()
    const v = new web3.eth.Contract(VAULT_ABI as any, AUTOVAULT_ADDRESS).methods
    const x = new web3.eth.Contract(XPHAR_ABI as any, XPHAR_ADDRESS).methods
    const m = new web3.eth.Contract(MINTER_ABI as any, PHAR_MINTER_ADDRESS).methods
    const vo = new web3.eth.Contract(VOTER_ABI as any, PHAR_VOTER_ADDRESS).methods

    const [totalShares, unlocked, period, operator, outputTokens, pending, claimed, emissions, xSupply, penalty, basis] =
        await Promise.all([
            v.totalSupply().call(),
            v.isUnlocked().call(),
            m.getPeriod().call(),
            v.OPERATOR().call(),
            v.getOutputTokens().call(),
            v.getPendingSwaps().call(),
            v.getClaimedInputTokens().call(),
            m.weeklyEmissions().call(),
            x.totalSupply().call(),
            x.SLASHING_PENALTY().call(),
            x.BASIS().call(),
        ])

    const periodNum = Number(period)
    const outs: string[] = (outputTokens as string[]) ?? []
    const p = pending as any
    const [perOutput, thisVotes, nextVotes] = await Promise.all([
        Promise.all(outs.map((o) => v.totalSupplyPerOutput(o).call())),
        vo.getVotes(AUTOVAULT_ADDRESS, periodNum).call(),
        vo.getVotes(AUTOVAULT_ADDRESS, periodNum + 1).call(),
    ])

    const basisNum = Number(basis) || 1
    const vault: AutoVaultStats = {
        totalShares: toBN(totalShares),
        isUnlocked: Boolean(unlocked),
        period: periodNum,
        operator: String(operator),
        outputs: outs.map((token, i) => ({ token, shares: toBN(perOutput[i]) })),
        pendingSwaps: ((p?.[0] as string[]) ?? []).map((input, i) => ({
            input,
            output: p[1][i],
            amount: toBN(p[2][i]),
        })),
        claimedInputTokens: (claimed as string[]) ?? [],
        votesThisPeriod: votes(thisVotes),
        votesNextPeriod: votes(nextVotes),
        weeklyEmissions: toBN(emissions),
        xpharTotalSupply: toBN(xSupply),
        xpharExitPenalty: Number(penalty) / basisNum,
    }

    if (!user) return { vault, user: null }

    const [shares, earned, stored, pref, xBal, xAllow] = await Promise.all([
        v.balanceOf(user).call(),
        v.earned(user).call(),
        v.getStoredRewards(user).call(),
        v.outputPreference(user).call(),
        x.balanceOf(user).call(),
        x.allowance(user, AUTOVAULT_ADDRESS).call(),
    ])

    return {
        vault,
        user: {
            address: user,
            shares: toBN(shares),
            earned: toBN(earned),
            storedRewards: toBN(stored),
            outputPreference: String(pref),
            xpharBalance: toBN(xBal),
            xpharAllowance: toBN(xAllow),
        },
    }
}

/**
 * Symbol and decimals for tokens Pharaoh's API didn't list, read from the
 * tokens themselves. A token that won't answer is shown by address.
 */
export async function readTokenInfo(addresses: string[]): Promise<TokenInfo[]> {
    const web3 = cChainWeb3()
    return Promise.all(
        addresses.map(async (address) => {
            const t = new web3.eth.Contract(ERC20_ABI as any, address).methods
            const [symbol, decimals] = await Promise.all([
                t.symbol().call().catch(() => ''),
                t.decimals().call().catch(() => 18),
            ])
            return { address, symbol: String(symbol) || `${address.slice(0, 6)}…`, decimals: Number(decimals), price: null }
        })
    )
}

// ─── Pharaoh's API ─────────────────────────────────────────────────────────

export interface PharProtocolInfo {
    pharPriceUSD: number
    pharTotalSupply: number
    pharCirculating: number
    pharCirculatingUSD: number
    xpharSupply: number
    xpharStaked: number
    xpharStakedUSD: number
    currentEpochEmissions: number
    currentEpochEmissionsUSD: number
    nextEpochEmissions: number
    nextEpochEmissionsUSD: number
    totalVotes: number
    totalVotesUSD: number
    /** Share of xPHAR that voted, 0–1. */
    pctVoted: number
    voterRewardsUSD: number
    firstPeriod: number
    currentPeriod: number
}

export interface PharPool {
    id: string
    symbol: string
    tvlUsd: number
    voteApr: number
    voterRewardsUsd: number
}

export interface PharApiStats {
    protocol: PharProtocolInfo | null
    /** By lowercased address. */
    tokens: Map<string, TokenInfo>
    /** By lowercased address. */
    pools: Map<string, PharPool>
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/** Parsers are exported so tests can pin them against the live payloads. */
export function parseProtocolInfo(d: any): PharProtocolInfo {
    const keys: (keyof PharProtocolInfo)[] = [
        'pharPriceUSD',
        'pharTotalSupply',
        'pharCirculating',
        'pharCirculatingUSD',
        'xpharSupply',
        'xpharStaked',
        'xpharStakedUSD',
        'currentEpochEmissions',
        'currentEpochEmissionsUSD',
        'nextEpochEmissions',
        'nextEpochEmissionsUSD',
        'totalVotes',
        'totalVotesUSD',
        'pctVoted',
        'voterRewardsUSD',
        'firstPeriod',
        'currentPeriod',
    ]
    const out = {} as PharProtocolInfo
    for (const k of keys) out[k] = num(d?.[k])
    return out
}

export function parseTokens(d: any): Map<string, TokenInfo> {
    const map = new Map<string, TokenInfo>()
    for (const t of Array.isArray(d) ? d : []) {
        if (typeof t?.id !== 'string') continue
        const price = num(t.price)
        map.set(lower(t.id), {
            address: t.id,
            symbol: String(t.symbol ?? ''),
            decimals: num(t.decimals) || 18,
            price: price > 0 ? price : null,
        })
    }
    return map
}

export function parsePools(d: any): Map<string, PharPool> {
    const map = new Map<string, PharPool>()
    for (const p of Array.isArray(d?.pools) ? d.pools : []) {
        if (typeof p?.id !== 'string') continue
        map.set(lower(p.id), {
            id: p.id,
            symbol: String(p.symbol ?? ''),
            tvlUsd: num(p.tvlUsd),
            voteApr: num(p.voteApr),
            voterRewardsUsd: num(p.voterRewardsUsd),
        })
    }
    return map
}

async function getJson(path: string): Promise<any> {
    const { data } = await axios.get(`${PHAR_API}${path}`, { timeout: HTTP_TIMEOUT_MS })
    return data
}

async function optional<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
    try {
        return await work()
    } catch (e) {
        console.warn(`[PharAutoVault] ${label} unavailable:`, e)
        return fallback
    }
}

/**
 * Protocol figures, token prices and pool names. The pools come from the
 * API's default page, which is ordered by size and holds nearly every pool the
 * vault votes for; the API ignores filters, so naming the rest would mean
 * paging through all ~800 pools.
 */
export async function readPharaohApi(): Promise<PharApiStats> {
    const [protocol, tokens, pools] = await Promise.all([
        optional('protocol info', async () => parseProtocolInfo(await getJson('/protocol-info')), null),
        optional('tokens', async () => parseTokens(await getJson('/tokens')), new Map<string, TokenInfo>()),
        optional('pools', async () => parsePools(await getJson('/pools?limit=100')), new Map<string, PharPool>()),
    ])
    return { protocol, tokens, pools }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Start of `period` (Unix ms). */
export function periodStart(period: number): number {
    return period * PHAR_PERIOD_SECONDS * 1000
}
