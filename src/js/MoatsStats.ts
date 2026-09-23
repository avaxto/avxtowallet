/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Everything the moats.app dashboard for the AVXTO moat shows, gathered from
 * the same three places it reads (reconstructed from a HAR of that page and
 * of the Core extension serving it):
 *
 *  1. The Moats contract itself — totals, config, reward tokens, and the
 *     viewer's balances, points, locks and pending rewards. Read through a
 *     C-Chain connection of our own rather than the wallet's signer, so the
 *     dashboard works while the wallet is on another chain or tab.
 *  2. moats.app's own API — its off-chain points (a different figure from the
 *     contract's), the epoch leaderboard, average lock duration, the voting
 *     epoch, the moat's listing config and the viewer's MAPS score. Every
 *     call here is independent and optional: a failure blanks that panel, not
 *     the page. The API allows cross-origin reads (it reflects the caller's
 *     Origin).
 *  3. DexScreener, for the AVXTO price, which turns the totals into USD.
 *
 * One call in the capture is left out: `0xce43c032` on
 * 0x9ae44fdbf8203d01aa00a1f1d82cbdf876b59f95, a contract with no verified
 * source, so there is no trustworthy way to say what it returns.
 */
import axios from 'axios'

import { BN } from '@/avalanche'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

import {
    MOATS_CHAIN_ID,
    MOATS_CONTRACT_ADDRESS,
    readMoatsState,
    type MoatsReader,
    type MoatsState,
} from './Moats'

export const MOATS_API = 'https://api.moats.app/api'
const DEXSCREENER_TOKEN_URL = 'https://api.dexscreener.com/latest/dex/tokens/'
const HTTP_TIMEOUT_MS = 10_000

const uint = (name: string) => ({ name, type: 'uint256' })
const fn = (name: string, inputs: any[], outputs: any[]) => ({
    name,
    type: 'function',
    stateMutability: 'view',
    inputs,
    outputs,
})

/** The views the dashboard reads that the actions in ./Moats.ts do not. */
const STATS_ABI = [
    fn('getTotalAmounts', [], [
        uint('_totalStaked'),
        uint('_totalLocked'),
        uint('_totalBurned'),
        uint('_totalInContract'),
    ]),
    fn('totalPoints', [], [uint('')]),
    fn('getActiveUserCount', [], [uint('')]),
    fn('POINTS_SCALING_FACTOR', [], [uint('')]),
    fn('earlyExitEnabled', [], [{ name: '', type: 'bool' }]),
    fn('emergencyUnlockEnabled', [], [{ name: '', type: 'bool' }]),
    fn('owner', [], [{ name: '', type: 'address' }]),
    fn('feeCollector', [], [{ name: '', type: 'address' }]),
    fn('getRewardTokens', [], [
        { name: 'addresses', type: 'address[]' },
        { name: 'totalDeposited', type: 'uint256[]' },
        { name: 'totalClaimed', type: 'uint256[]' },
        { name: 'unallocated', type: 'uint256[]' },
    ]),
    fn('getCurrentPoints', [{ name: '_user', type: 'address' }], [uint('')]),
    fn('getAllPendingRewards', [{ name: '_user', type: 'address' }], [
        { name: '', type: 'address[]' },
        { name: '', type: 'uint256[]' },
    ]),
    fn(
        'calculateEarlyExitFee',
        [
            { name: '_user', type: 'address' },
            { name: '_lockIndex', type: 'uint256' },
        ],
        [uint('fee'), uint('amountAfterFee')]
    ),
]

const toBN = (v: unknown): BN => new BN(String(v))

export interface TokenMeta {
    address: string
    symbol: string
    decimals: number
}

export interface RewardTokenStats extends TokenMeta {
    deposited: BN
    claimed: BN
    unallocated: BN
}

export interface MoatsContractStats {
    token: TokenMeta & { name: string }
    totalStaked: BN
    totalLocked: BN
    totalBurned: BN
    /** AVXTO the contract actually holds (staked + locked, plus anything sent to it). */
    totalInContract: BN
    /** Every point in the moat, in the contract's raw units — see `pointsAsTokens`. */
    totalPoints: BN
    pointsScalingFactor: BN
    activeUsers: number
    stakingEnabled: boolean
    lockingEnabled: boolean
    burningEnabled: boolean
    earlyExitEnabled: boolean
    emergencyUnlockEnabled: boolean
    paused: boolean
    unstakeFeeBps: number
    minAmount: BN
    owner: string
    feeCollector: string
    rewardTokens: RewardTokenStats[]
}

export interface MoatsUserStats {
    address: string
    /** Balance, staked, burned, locks — the same read the action pages use. */
    state: MoatsState
    /** Staking + lock + burn points, in the contract's raw units. */
    currentPoints: BN
    pendingRewards: (TokenMeta & { amount: BN })[]
    /** What leaving each still-running lock right now would cost, by lock index. */
    earlyExit: Record<number, { fee: BN; afterFee: BN }>
}

/** Where the viewer's figure is missing, the dashboard shows the moat alone. */
export interface MoatsOnChainStats {
    moat: MoatsContractStats
    user: MoatsUserStats | null
}

/** A read-only C-Chain connection for `address` (which may be empty). */
function cChainReader(address: string): MoatsReader {
    const network = getEvmNetworkByChainId(MOATS_CHAIN_ID)
    if (!network) throw new Error('Avalanche C-Chain is missing from the network registry.')
    return { network, address, reader: () => web3For(network) }
}

async function tokenMeta(r: MoatsReader, address: string): Promise<TokenMeta> {
    const web3 = r.reader()
    // @ts-ignore - web3 typing for dynamic ABI
    const t = new web3.eth.Contract(ERC20Abi.abi as any, address).methods
    const [symbol, decimals] = await Promise.all([
        t.symbol().call().catch(() => '?'),
        t.decimals().call().catch(() => 18),
    ])
    return { address, symbol: String(symbol), decimals: Number(decimals) }
}

/**
 * Moat-wide and (when `userAddress` is given) personal figures, all from the
 * contract. `userAddress` is the viewer's EVM address — the same on every EVM
 * chain, so it is right whichever chain their wallet happens to be on.
 */
export async function readMoatsOnChain(userAddress: string | null): Promise<MoatsOnChainStats> {
    const r = cChainReader(userAddress ?? '')
    const web3 = r.reader()
    const m = new web3.eth.Contract(STATS_ABI as any, MOATS_CONTRACT_ADDRESS).methods
    // @ts-ignore - web3 typing for dynamic ABI
    const t = new web3.eth.Contract(ERC20Abi.abi as any, AVXTO_CONTRACT_ADDRESS).methods

    // The flags, fee and minimum come from the action pages' own read, so
    // both show the same figures; with no viewer it reads the zero address.
    const [totals, totalPoints, activeUsers, scaling, earlyExit, emergency, owner, feeCollector, rewards, name, base] =
        await Promise.all([
            m.getTotalAmounts().call(),
            m.totalPoints().call(),
            m.getActiveUserCount().call(),
            m.POINTS_SCALING_FACTOR().call(),
            m.earlyExitEnabled().call(),
            m.emergencyUnlockEnabled().call(),
            m.owner().call(),
            m.feeCollector().call(),
            m.getRewardTokens().call(),
            t.name().call(),
            readMoatsState(
                userAddress ? r : { ...r, address: '0x0000000000000000000000000000000000000000' }
            ),
        ])

    const tot = totals as any
    const rw = rewards as any
    const rewardAddresses: string[] = rw.addresses ?? rw[0] ?? []
    const rewardMeta = await Promise.all(rewardAddresses.map((a) => tokenMeta(r, a)))

    const moat: MoatsContractStats = {
        token: { address: AVXTO_CONTRACT_ADDRESS, name: String(name), symbol: 'AVXTO', decimals: base.decimals },
        totalStaked: toBN(tot._totalStaked ?? tot[0]),
        totalLocked: toBN(tot._totalLocked ?? tot[1]),
        totalBurned: toBN(tot._totalBurned ?? tot[2]),
        totalInContract: toBN(tot._totalInContract ?? tot[3]),
        totalPoints: toBN(totalPoints),
        pointsScalingFactor: toBN(scaling),
        activeUsers: Number(activeUsers),
        stakingEnabled: base.stakingEnabled,
        lockingEnabled: base.lockingEnabled,
        burningEnabled: base.burningEnabled,
        earlyExitEnabled: Boolean(earlyExit),
        emergencyUnlockEnabled: Boolean(emergency),
        paused: base.paused,
        unstakeFeeBps: base.unstakeFeeBps,
        minAmount: base.minAmount,
        owner: String(owner),
        feeCollector: String(feeCollector),
        rewardTokens: rewardMeta.map((meta, i) => ({
            ...meta,
            deposited: toBN((rw.totalDeposited ?? rw[1])[i]),
            claimed: toBN((rw.totalClaimed ?? rw[2])[i]),
            unallocated: toBN((rw.unallocated ?? rw[3])[i]),
        })),
    }

    if (!userAddress) return { moat, user: null }

    const nowSec = Math.floor(Date.now() / 1000)
    const running = base.userLocks.filter((l) => l.end > nowSec)
    const [points, pending, exitFees] = await Promise.all([
        m.getCurrentPoints(userAddress).call(),
        m.getAllPendingRewards(userAddress).call(),
        Promise.all(
            running.map((l) =>
                m
                    .calculateEarlyExitFee(userAddress, l.index)
                    .call()
                    .then((res: any) => ({ index: l.index, res }))
                    // It reverts once the lock ends — a race with the filter
                    // above, not an error worth surfacing.
                    .catch(() => null)
            )
        ),
    ])

    const p = pending as any
    const pendingAddresses: string[] = p[0] ?? []
    const pendingMeta = await Promise.all(
        pendingAddresses.map(
            (a) => rewardMeta.find((x) => x.address.toLowerCase() === a.toLowerCase()) ?? tokenMeta(r, a)
        )
    )

    const earlyExitByIndex: MoatsUserStats['earlyExit'] = {}
    for (const e of exitFees) {
        if (!e) continue
        earlyExitByIndex[e.index] = {
            fee: toBN(e.res.fee ?? e.res[0]),
            afterFee: toBN(e.res.amountAfterFee ?? e.res[1]),
        }
    }

    return {
        moat,
        user: {
            address: userAddress,
            state: base,
            currentPoints: toBN(points),
            pendingRewards: pendingMeta.map((meta, i) => ({ ...meta, amount: toBN(p[1][i]) })),
            earlyExit: earlyExitByIndex,
        },
    }
}

/**
 * Contract points as "AVXTO-weighted" units: 1 per AVXTO staked, the lock
 * multiplier per AVXTO locked, 10 per AVXTO burned. The raw figure is
 * `amount * weight / POINTS_SCALING_FACTOR`, so this divides the remaining
 * 10^(decimals) / scaling back out.
 */
export function pointsAsTokens(points: BN, scaling: BN, decimals: number): number {
    const perToken = new BN(10).pow(new BN(decimals)).div(scaling)
    if (perToken.isZero()) return Number(points.toString())
    return Number(points.toString()) / Number(perToken.toString())
}

// ─── moats.app API ─────────────────────────────────────────────────────────

export interface MoatsApiEpoch {
    epochNumber: number
    startTime: string
    endTime: string | null
    isComplete: boolean
}

export interface MoatsApiUserPoints {
    points: number
    currentEpoch: MoatsApiEpoch | null
    isTimeWeighted: boolean
    boosted: boolean
    boostMultiplier: number
    boostReason: string
    /** Points by source, as moats.app weighs them. */
    breakdown: { staked: number; locked: number; burnt: number }
    breakdownPercent: { staked: number; locked: number; burnt: number }
    /** AVXTO behind each source, as moats.app has indexed it. */
    tokenAmounts: { staked: number; locked: number; burnt: number }
    lockEndTimestamp: number | null
}

export interface MoatsApiLeaderboardEntry {
    rank: number
    address: string
    username: string
    points: number
    /** Share of the epoch's points, in percent. */
    weight: number
    boosted: boolean
}

export interface MoatsApiVotingEpoch {
    epochNumber: number
    startDate: string
    endDate: string
    emission: number
}

export interface MoatsApiConfig {
    status: string
    moatVersion: number
    owner: string
    rewardStrategy: string
    boostActive: boolean
    boostValue: number
    voteEnabled: boolean
    automatedRewards: boolean
    timeWeightedPointsEnabled: boolean
    tags: { name: string; color: string }[]
    createdAt: string
    lastIndexedBlock: number
}

export interface MoatsApiStats {
    userPoints: MoatsApiUserPoints | null
    leaderboard: { epoch: MoatsApiEpoch | null; entries: MoatsApiLeaderboardEntry[] } | null
    averageLock: { seconds: number; count: number } | null
    votingEpoch: MoatsApiVotingEpoch | null
    config: MoatsApiConfig | null
    mapScore: { score: number; epochNumber: number | null } | null
}

async function getJson(url: string, params?: Record<string, string>): Promise<any> {
    const { data } = await axios.get(url, { params, timeout: HTTP_TIMEOUT_MS })
    return data
}

/** Resolves to null instead of rejecting: each panel stands alone. */
async function optional<T>(label: string, work: () => Promise<T>): Promise<T | null> {
    try {
        return await work()
    } catch (e) {
        console.warn(`[MoatsStats] ${label} unavailable:`, e)
        return null
    }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

function parseEpoch(e: any): MoatsApiEpoch | null {
    if (!e || typeof e !== 'object') return null
    return {
        epochNumber: num(e.epochNumber),
        startTime: String(e.startTime ?? ''),
        endTime: e.endTime ? String(e.endTime) : null,
        isComplete: Boolean(e.isComplete),
    }
}

/** Parsers are exported so tests can pin them against the captured payloads. */
export function parseUserPoints(d: any): MoatsApiUserPoints {
    const f = d?.fallbackInfo ?? {}
    const triple = (o: any) => ({ staked: num(o?.staked), locked: num(o?.locked), burnt: num(o?.burnt) })
    return {
        points: num(d?.points),
        currentEpoch: parseEpoch(d?.currentEpoch),
        isTimeWeighted: Boolean(d?.isTimeWeighted),
        boosted: Boolean(f.boosted),
        boostMultiplier: num(f.boostMultiplier) || 1,
        boostReason: String(f.boostReason ?? ''),
        breakdown: triple(f),
        breakdownPercent: triple(f.breakdownPercentages),
        tokenAmounts: triple(f.tokenAmounts),
        lockEndTimestamp: f.lockInfo?.lockEndTimestamp ? num(f.lockInfo.lockEndTimestamp) : null,
    }
}

export function parseLeaderboard(d: any): MoatsApiStats['leaderboard'] {
    const rows: any[] = Array.isArray(d?.leaderboard) ? d.leaderboard : []
    return {
        epoch: parseEpoch(d?.currentEpoch),
        entries: rows.map((r) => ({
            rank: num(r.rank),
            address: String(r.address ?? ''),
            username: String(r.username ?? r.address ?? ''),
            points: num(r.points),
            weight: num(r.weight),
            boosted: Boolean(r.boosted),
        })),
    }
}

export function parseConfig(d: any): MoatsApiConfig {
    return {
        status: String(d?.status ?? ''),
        moatVersion: num(d?.moatVersion),
        owner: String(d?.owner ?? ''),
        rewardStrategy: String(d?.rewardStrategy ?? ''),
        boostActive: Boolean(d?.boostActive),
        boostValue: num(d?.boostValue) || 1,
        voteEnabled: Boolean(d?.voteEnabled),
        automatedRewards: Boolean(d?.automatedRewards),
        timeWeightedPointsEnabled: Boolean(d?.timeWeightedPointsEnabled),
        tags: (Array.isArray(d?.tags) ? d.tags : []).map((t: any) => ({
            name: String(t?.name ?? ''),
            // Only a hex colour reaches a style binding.
            color: /^#[0-9a-f]{3,8}$/i.test(String(t?.color)) ? String(t.color) : '',
        })),
        createdAt: String(d?.createdAt ?? ''),
        lastIndexedBlock: num(d?.lastIndexedBlock),
    }
}

export async function readMoatsApi(userAddress: string | null): Promise<MoatsApiStats> {
    const moat = { contractAddress: MOATS_CONTRACT_ADDRESS, network: 'avalanche' }
    const [userPoints, leaderboard, averageLock, votingEpoch, config, mapScore] = await Promise.all([
        userAddress
            ? optional('user points', async () =>
                  parseUserPoints(await getJson(`${MOATS_API}/moat-points/v2/user/${userAddress}`, moat))
              )
            : Promise.resolve(null),
        optional('leaderboard', async () =>
            parseLeaderboard(await getJson(`${MOATS_API}/moat-points/v2/all`, moat))
        ),
        optional('average lock', async () => {
            const d = await getJson(`${MOATS_API}/moat-points/lock-duration/average`, moat)
            return { seconds: num(d?.averageSeconds), count: num(d?.count) }
        }),
        optional('voting epoch', async () => {
            const d = await getJson(`${MOATS_API}/voting/current-epoch`)
            return {
                epochNumber: num(d?.epochNumber),
                startDate: String(d?.startDate ?? ''),
                endDate: String(d?.endDate ?? ''),
                emission: num(d?.emission),
            }
        }),
        optional('config', async () =>
            parseConfig(
                await getJson(`${MOATS_API}/moat-config/${MOATS_CONTRACT_ADDRESS}`, { network: 'avalanche' })
            )
        ),
        userAddress
            ? optional('map score', async () => {
                  const d = await getJson(`${MOATS_API}/maps/score/${userAddress}`)
                  return { score: num(d?.mapScore), epochNumber: parseEpoch(d?.currentEpoch)?.epochNumber ?? null }
              })
            : Promise.resolve(null),
    ])
    return { userPoints, leaderboard, averageLock, votingEpoch, config, mapScore }
}

// ─── Price ─────────────────────────────────────────────────────────────────

export interface AvxtoMarket {
    priceUsd: number
    priceChange24h: number
    liquidityUsd: number
    volume24hUsd: number
    marketCapUsd: number
    fdvUsd: number
    dex: string
    pairUrl: string
}

/**
 * The deepest AVXTO pair on Avalanche. Thin pairs quote wild prices (the
 * capture had one with $1 of liquidity), so the price comes from whichever
 * pair holds the most.
 */
export function pickMarket(d: any): AvxtoMarket | null {
    const pairs: any[] = (Array.isArray(d?.pairs) ? d.pairs : []).filter(
        (p: any) =>
            p?.chainId === 'avalanche' &&
            String(p?.baseToken?.address).toLowerCase() === AVXTO_CONTRACT_ADDRESS.toLowerCase()
    )
    if (!pairs.length) return null
    const best = pairs.reduce((a, b) => (num(b?.liquidity?.usd) > num(a?.liquidity?.usd) ? b : a))
    return {
        priceUsd: num(best.priceUsd),
        priceChange24h: num(best.priceChange?.h24),
        liquidityUsd: num(best.liquidity?.usd),
        volume24hUsd: num(best.volume?.h24),
        marketCapUsd: num(best.marketCap),
        fdvUsd: num(best.fdv),
        dex: String(best.dexId ?? ''),
        pairUrl: /^https:\/\/dexscreener\.com\//.test(String(best.url)) ? String(best.url) : '',
    }
}

export async function readAvxtoMarket(): Promise<AvxtoMarket | null> {
    return optional('price', async () => pickMarket(await getJson(DEXSCREENER_TOKEN_URL + AVXTO_CONTRACT_ADDRESS)))
}
