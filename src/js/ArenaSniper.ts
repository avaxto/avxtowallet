/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The newest tokens launched on ArenaTrade, read straight from the chain.
 *
 * arenatrade.ai's own "New" tab reads a signed private API; this reads the
 * public contract underneath it instead. Every ArenaTrade launch goes through
 * Arena's `TokenManager` (a UUPS proxy at `ARENA_TOKEN_MANAGER`, verified
 * source on Snowtrace/Routescan) on Avalanche C-Chain, which emits:
 *
 *   - `TokenCreated(tokenId, params, tokenSupply)` — one per launch; `params`
 *     carries the token contract, its creator, pair and fee settings;
 *   - `Buy` / `Sell(user, tokenId, tokenAmount, cost|reward, …)` — one per
 *     trade on the bonding curve, priced in AVAX;
 *   - `TokenLPCreated(tokenId, …)` — the token graduated to a DEX pool.
 *
 * None of their fields are indexed, so logs are fetched for the manager as a
 * whole and grouped here by `tokenId`. That also means every trade in the
 * scanned range is counted, and a token's trades can only happen after its
 * launch — so scanning back to the oldest launch shown captures each one's
 * whole curve history.
 *
 * What the figures do NOT include: trades after graduation happen on a DEX
 * pool, not the curve, and are not in these events. Graduated tokens are
 * marked so their transaction and volume figures read as curve-only.
 */
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'

export const ARENA_TOKEN_MANAGER = '0x8315f1eb449dd4b779495c3a0b05e5d194446c6e'
const C_CHAIN_ID = 43114

/**
 * Blocks per `eth_getLogs` call. publicnode caps a range at 50,000 blocks;
 * api.avax.network allows more, but staying under the lower cap keeps the
 * scan working whichever C-Chain RPC is configured.
 */
export const LOG_CHUNK_BLOCKS = 50_000
/** How far back a first load may look for launches: ~2M blocks, weeks. */
const MAX_LOOKBACK_CHUNKS = 40
/** Parallel requests while scanning / reading token metadata. */
const CONCURRENCY = 4

const PARAMS_COMPONENTS = [
    { name: 'curveScaler', type: 'uint128' },
    { name: 'a', type: 'uint16' },
    { name: 'b', type: 'uint8' },
    { name: 'lpDeployed', type: 'bool' },
    { name: 'lpPercentage', type: 'uint8' },
    { name: 'salePercentage', type: 'uint8' },
    { name: 'creatorFeeBasisPoints', type: 'uint8' },
    { name: 'creatorAddress', type: 'address' },
    { name: 'pairAddress', type: 'address' },
    { name: 'tokenContractAddress', type: 'address' },
]

const tradeInputs = (amountName: string) => [
    { name: 'user', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'tokenAmount', type: 'uint256' },
    { name: amountName, type: 'uint256' },
    { name: 'tokenSupply', type: 'uint256' },
    { name: 'referrerAddress', type: 'address' },
    { name: 'referralFee', type: 'uint256' },
    { name: 'creatorFee', type: 'uint256' },
    { name: 'protocolFee', type: 'uint256' },
]

/** The slice of TokenManager's ABI read here. */
export const TOKEN_MANAGER_EVENTS = {
    TokenCreated: {
        name: 'TokenCreated',
        type: 'event',
        anonymous: false,
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: false },
            { name: 'params', type: 'tuple', indexed: false, components: PARAMS_COMPONENTS },
            { name: 'tokenSupply', type: 'uint256', indexed: false },
        ],
    },
    Buy: {
        name: 'Buy',
        type: 'event',
        anonymous: false,
        inputs: tradeInputs('cost').map((i) => ({ ...i, indexed: false })),
    },
    Sell: {
        name: 'Sell',
        type: 'event',
        anonymous: false,
        inputs: tradeInputs('reward').map((i) => ({ ...i, indexed: false })),
    },
    TokenLPCreated: {
        name: 'TokenLPCreated',
        type: 'event',
        anonymous: false,
        inputs: [
            { name: 'tokenId', type: 'uint256', indexed: false },
            { name: 'amountToken', type: 'uint256', indexed: false },
            { name: 'amountAVAX', type: 'uint256', indexed: false },
            { name: 'liquidity', type: 'uint256', indexed: false },
        ],
    },
} as const

type EventName = keyof typeof TOKEN_MANAGER_EVENTS

const codec = new Web3().eth.abi
const TOPICS: Record<string, EventName> = Object.fromEntries(
    (Object.keys(TOKEN_MANAGER_EVENTS) as EventName[]).map((n) => [
        codec.encodeEventSignature(TOKEN_MANAGER_EVENTS[n] as any),
        n,
    ])
)

export interface SniperToken {
    tokenId: string
    address: string
    name: string
    symbol: string
    creator: string
    /** Unix seconds of the launch block. */
    createdAt: number
    createdBlock: number
    /** Curve trades seen since launch. */
    buys: number
    sells: number
    /** AVAX spent on buys plus received on sells, in wei. */
    volumeWei: BN
    /** Moved to a DEX pool; figures above are curve-only from then on. */
    graduated: boolean
}

export interface RawLog {
    topics: string[]
    data: string
    blockNumber: number | string
    logIndex?: number | string
}

/** One decoded TokenManager event, or null for any other log. */
export function decodeManagerLog(log: RawLog):
    | { event: 'TokenCreated'; tokenId: string; token: string; creator: string; graduated: boolean }
    | { event: 'Buy' | 'Sell'; tokenId: string; avax: BN }
    | { event: 'TokenLPCreated'; tokenId: string }
    | null {
    const name = TOPICS[String(log.topics?.[0] ?? '').toLowerCase()]
    if (!name) return null
    const decoded: any = codec.decodeLog(TOKEN_MANAGER_EVENTS[name].inputs as any, log.data, [])
    const tokenId = String(decoded.tokenId)
    switch (name) {
        case 'TokenCreated': {
            const p = decoded.params
            return {
                event: name,
                tokenId,
                token: String(p.tokenContractAddress ?? p[9]).toLowerCase(),
                creator: String(p.creatorAddress ?? p[7]).toLowerCase(),
                graduated: Boolean(p.lpDeployed ?? p[3]),
            }
        }
        case 'Buy':
            return { event: name, tokenId, avax: new BN(String(decoded.cost)) }
        case 'Sell':
            return { event: name, tokenId, avax: new BN(String(decoded.reward)) }
        case 'TokenLPCreated':
            return { event: name, tokenId }
    }
}

/** Runs `tasks` with at most `limit` in flight, preserving order. */
async function pooled<T>(tasks: (() => Promise<T>)[], limit = CONCURRENCY): Promise<T[]> {
    const out: T[] = new Array(tasks.length)
    let next = 0
    const worker = async () => {
        while (next < tasks.length) {
            const i = next++
            out[i] = await tasks[i]()
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
    return out
}

function cChain(): Web3 {
    const network = getEvmNetworkByChainId(C_CHAIN_ID)
    if (!network) throw new Error('Avalanche C-Chain is missing from the network registry.')
    return web3For(network)
}

/**
 * The feed behind /wallet/arenatrade/sniper. Holds what it has scanned, so a
 * refresh only asks for blocks it has not seen yet.
 */
export class ArenaSniperFeed {
    private readonly web3: Web3
    private readonly tokens = new Map<string, SniperToken>()
    /** Trades seen for tokens whose launch has not been scanned yet (older). */
    private readonly orphanTrades = new Map<string, { buys: number; sells: number; volumeWei: BN }>()
    private readonly graduatedIds = new Set<string>()
    private readonly blockTimes = new Map<number, number>()
    /** Highest block scanned so far; the next refresh starts after it. */
    private scannedTo = 0

    constructor(web3?: Web3) {
        this.web3 = web3 ?? cChain()
    }

    /** The newest launches first. */
    list(): SniperToken[] {
        return [...this.tokens.values()].sort((a, b) => b.createdBlock - a.createdBlock)
    }

    /**
     * Scans back from the chain head until `limit` launches are found (or the
     * look-back runs out), then reads their names and launch times.
     */
    async loadNewest(limit: number): Promise<SniperToken[]> {
        const head = Number(await this.web3.eth.getBlockNumber())
        this.scannedTo = head

        let to = head
        for (let i = 0; i < MAX_LOOKBACK_CHUNKS && this.tokens.size < limit && to > 0; i += CONCURRENCY) {
            // A few chunks at a time, newest first.
            const ranges: [number, number][] = []
            for (let k = 0; k < CONCURRENCY && to > 0; k++) {
                const from = Math.max(0, to - LOG_CHUNK_BLOCKS + 1)
                ranges.push([from, to])
                to = from - 1
            }
            const batches = await pooled(ranges.map(([f, t]) => () => this.getLogs(f, t)))
            // Apply oldest-first within the batch so a launch precedes its trades.
            for (const logs of batches.reverse()) this.apply(logs)
        }

        // Keep only the newest `limit`; anything older was scanned only
        // partially (its launch may sit in the next, unscanned chunk).
        const keep = this.list().slice(0, limit)
        this.tokens.clear()
        for (const t of keep) this.tokens.set(t.tokenId, t)
        await this.fillDetails(keep)
        return this.list()
    }

    /** Folds in every block since the last scan: new launches and trades. */
    async refresh(): Promise<SniperToken[]> {
        const head = Number(await this.web3.eth.getBlockNumber())
        if (head <= this.scannedTo) return this.list()
        const before = new Set(this.tokens.keys())
        for (let from = this.scannedTo + 1; from <= head; from += LOG_CHUNK_BLOCKS) {
            this.apply(await this.getLogs(from, Math.min(head, from + LOG_CHUNK_BLOCKS - 1)))
        }
        this.scannedTo = head
        await this.fillDetails(this.list().filter((t) => !before.has(t.tokenId)))
        return this.list()
    }

    private async getLogs(fromBlock: number, toBlock: number): Promise<RawLog[]> {
        return (await this.web3.eth.getPastLogs({
            address: ARENA_TOKEN_MANAGER,
            fromBlock,
            toBlock,
        })) as unknown as RawLog[]
    }

    private apply(logs: RawLog[]): void {
        const ordered = [...logs].sort(
            (a, b) =>
                Number(a.blockNumber) - Number(b.blockNumber) || Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0)
        )
        for (const log of ordered) {
            const ev = decodeManagerLog(log)
            if (!ev) continue
            if (ev.event === 'TokenCreated') {
                if (this.tokens.has(ev.tokenId)) continue
                const early = this.orphanTrades.get(ev.tokenId)
                this.orphanTrades.delete(ev.tokenId)
                this.tokens.set(ev.tokenId, {
                    tokenId: ev.tokenId,
                    address: ev.token,
                    name: '',
                    symbol: '',
                    creator: ev.creator,
                    createdAt: 0,
                    createdBlock: Number(log.blockNumber),
                    buys: early?.buys ?? 0,
                    sells: early?.sells ?? 0,
                    volumeWei: early?.volumeWei ?? new BN(0),
                    graduated: ev.graduated || this.graduatedIds.has(ev.tokenId),
                })
            } else if (ev.event === 'TokenLPCreated') {
                this.graduatedIds.add(ev.tokenId)
                const t = this.tokens.get(ev.tokenId)
                if (t) t.graduated = true
            } else {
                // Scanning newest-first, a trade can be seen before the launch
                // it belongs to (in an older chunk not yet applied).
                const t =
                    this.tokens.get(ev.tokenId) ??
                    (() => {
                        let o = this.orphanTrades.get(ev.tokenId)
                        if (!o) {
                            o = { buys: 0, sells: 0, volumeWei: new BN(0) }
                            this.orphanTrades.set(ev.tokenId, o)
                        }
                        return o
                    })()
                if (ev.event === 'Buy') t.buys++
                else t.sells++
                t.volumeWei = t.volumeWei.add(ev.avax)
            }
        }
    }

    /** Names, symbols and launch times, for tokens that lack them. */
    private async fillDetails(tokens: SniperToken[]): Promise<void> {
        await pooled(
            tokens.map((t) => async () => {
                const erc20 = new this.web3.eth.Contract(ERC20Abi.abi as any, t.address).methods
                const [name, symbol, createdAt] = await Promise.all([
                    t.name ? t.name : erc20.name().call().catch(() => ''),
                    t.symbol ? t.symbol : erc20.symbol().call().catch(() => ''),
                    t.createdAt || this.blockTime(t.createdBlock),
                ])
                t.name = String(name).slice(0, 64)
                t.symbol = String(symbol).slice(0, 16)
                t.createdAt = Number(createdAt)
            })
        )
    }

    private async blockTime(block: number): Promise<number> {
        const known = this.blockTimes.get(block)
        if (known) return known
        const b = await this.web3.eth.getBlock(block)
        const ts = Number(b?.timestamp ?? 0)
        this.blockTimes.set(block, ts)
        return ts
    }
}

export type SniperSort = 'age' | 'transactions' | 'volume'

/** Sorted copy. `age` is newest first; the other two, largest first. */
export function sortSniperTokens(tokens: SniperToken[], by: SniperSort): SniperToken[] {
    const txs = (t: SniperToken) => t.buys + t.sells
    return [...tokens].sort((a, b) => {
        if (by === 'transactions') return txs(b) - txs(a) || b.createdBlock - a.createdBlock
        if (by === 'volume') return b.volumeWei.cmp(a.volumeWei) || b.createdBlock - a.createdBlock
        return b.createdBlock - a.createdBlock
    })
}
