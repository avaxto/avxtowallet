/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * X-Chain explorer data, straight from Glacier's REST API (the /wallet/xexplorer page).
 *
 * Plain REST rather than @avalabs/glacier-sdk: the SDK version this project pins
 * predates fields the API now returns (credentials, UTXO lifecycles, vertex
 * details, atomic-memory balances), and the explorer's job is to show all of it.
 * The production host answers CORS for browser origins.
 *
 * X-Chain history has two formats: "linear" transactions (since the Cortina
 * upgrade, April 2023) sit in blocks; older "non-linear" ones sit in DAG
 * vertices. Both are handled.
 */
import axios from 'axios'

export const GLACIER_BASE = 'https://glacier-api.avax.network/v1'
const TIMEOUT_MS = 20_000

export type XNetwork = 'mainnet' | 'fuji'

export interface XAsset {
    assetId: string
    name: string
    symbol: string
    denomination: number
    type: string
    amount: string
}

export interface XUtxo {
    addresses: string[]
    utxoId: string
    asset: XAsset
    utxoType: string
    outputIndex: string
    timestamp: number
    creationTxHash: string
    consumingTxHash?: string
    consumingTxTimestamp?: number
    locktime: number
    threshold: number
    createdOnChainId: string
    consumedOnChainId?: string
    credentials?: { publicKey: string; signature: string }[]
    utxoBytes?: string
    [extra: string]: unknown
}

export interface XTransaction {
    txHash: string
    chainFormat: 'linear' | 'non-linear' | string
    blockHash?: string
    blockHeight?: number
    vertices?: { hash: string; height: number; timestamp: number }[]
    txType: string
    timestamp: number
    sourceChain?: string
    destinationChain?: string
    memo?: string
    consumedUtxos: XUtxo[]
    emittedUtxos: XUtxo[]
    amountUnlocked: XAsset[]
    amountCreated: XAsset[]
    [extra: string]: unknown
}

export interface XBalanceEntry extends XAsset {
    utxoCount: number
}

export interface XBalances {
    unlocked: XBalanceEntry[]
    locked: XBalanceEntry[]
    atomicMemoryUnlocked: XBalanceEntry[]
    atomicMemoryLocked: XBalanceEntry[]
    [extra: string]: unknown
}

export interface XAssetDetails {
    assetId: string
    name: string
    symbol: string
    denomination: number
    createdAtTimestamp?: number
    type: string
    cap?: string
    [extra: string]: unknown
}

export interface XBlock {
    blockNumber: string
    blockHash: string
    parentHash: string
    blockTimestamp: number
    blockType: string
    txCount: number
    blockSizeBytes: number
    transactions: string[]
    proposerDetails?: Record<string, unknown>
    [extra: string]: unknown
}

export interface XVertex {
    vertexHash: string
    vertexHeight: number
    parentHashes: string[]
    txCount: number
    transactions: string[]
    vertexIndex: number
    vertexSizeBytes: number
    vertexTimestamp: number
    [extra: string]: unknown
}

export interface Page<T> {
    items: T[]
    nextPageToken?: string
}

// ── input ─────────────────────────────────────────────────────────────────────

export type ExplorerQuery = { kind: 'address'; address: string; network: XNetwork } | { kind: 'tx'; txHash: string } | { kind: 'invalid'; reason: string }

const BECH32_CHARS = '[02-9ac-hj-np-z]'
const ADDRESS_RE = new RegExp(`^(avax|fuji)1${BECH32_CHARS}{38}$`)
const CB58_RE = /^[1-9A-HJ-NP-Za-km-z]{48,52}$/

/**
 * What the search box holds: an X-Chain address (with or without "X-"; the
 * network comes from its prefix) or a transaction ID (CB58, network chosen
 * separately). P- and C- addresses are refused with a pointer, not guessed at.
 */
export function classifyQuery(raw: string): ExplorerQuery {
    const q = raw.trim()
    if (!q) return { kind: 'invalid', reason: 'Enter an X-Chain address or a transaction ID.' }
    if (/^[PC]-/i.test(q)) return { kind: 'invalid', reason: 'That is a P- or C-Chain address. This explorer searches the X-Chain.' }
    if (/^0x[0-9a-fA-F]{40}$/.test(q)) return { kind: 'invalid', reason: 'That is an EVM (C-Chain) address. This explorer searches the X-Chain.' }
    const bare = q.replace(/^X-/i, '').toLowerCase()
    if (ADDRESS_RE.test(bare)) return { kind: 'address', address: bare, network: bare.startsWith('fuji') ? 'fuji' : 'mainnet' }
    if (CB58_RE.test(q)) return { kind: 'tx', txHash: q }
    return { kind: 'invalid', reason: 'Not an X-Chain address (X-avax1…) or a transaction ID.' }
}

// ── requests ──────────────────────────────────────────────────────────────────

export class ExplorerError extends Error {
    constructor(message: string, readonly status?: number) {
        super(message)
    }
}

async function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    try {
        const { data } = await axios.get(url, { params, timeout: TIMEOUT_MS })
        return data as T
    } catch (e: any) {
        const status: number | undefined = e?.response?.status
        const body = e?.response?.data
        const detail = Array.isArray(body?.message) ? body.message.join('; ') : body?.message
        if (status === 404) throw new ExplorerError('Not found on this network.', 404)
        if (status === 429) throw new ExplorerError('Glacier is rate limiting requests. Wait a moment and try again.', 429)
        if (status) throw new ExplorerError(`Glacier error ${status}${detail ? `: ${detail}` : ''}`, status)
        throw new ExplorerError(e?.message === 'Network Error' ? 'Could not reach the Glacier API.' : e?.message || 'Request failed.')
    }
}

const xBase = (network: XNetwork) => `${GLACIER_BASE}/networks/${network}/blockchains/x-chain`

export const getTransaction = (network: XNetwork, txHash: string) => get<XTransaction>(`${xBase(network)}/transactions/${encodeURIComponent(txHash)}`)

export async function listTransactions(network: XNetwork, address: string, pageToken?: string, pageSize = 25): Promise<Page<XTransaction>> {
    const r = await get<{ transactions?: XTransaction[]; nextPageToken?: string }>(`${xBase(network)}/transactions`, {
        addresses: address,
        pageSize,
        pageToken,
        sortOrder: 'desc',
    })
    return { items: r.transactions ?? [], nextPageToken: r.nextPageToken || undefined }
}

export async function listUtxos(network: XNetwork, address: string, includeSpent: boolean, pageToken?: string, pageSize = 50): Promise<Page<XUtxo>> {
    const r = await get<{ utxos?: XUtxo[]; nextPageToken?: string }>(`${xBase(network)}/utxos`, {
        addresses: address,
        pageSize,
        pageToken,
        includeSpent,
        sortOrder: 'desc',
    })
    return { items: r.utxos ?? [], nextPageToken: r.nextPageToken || undefined }
}

export async function getBalances(network: XNetwork, address: string): Promise<XBalances> {
    const r = await get<{ balances: XBalances }>(`${xBase(network)}/balances`, { addresses: address })
    return r.balances
}

export const getAssetDetails = (network: XNetwork, assetId: string) => get<XAssetDetails>(`${xBase(network)}/assets/${encodeURIComponent(assetId)}`)
export const getBlock = (network: XNetwork, blockHash: string) => get<XBlock>(`${xBase(network)}/blocks/${encodeURIComponent(blockHash)}`)
export const getVertex = (network: XNetwork, vertexHash: string) => get<XVertex>(`${xBase(network)}/vertices/${encodeURIComponent(vertexHash)}`)

/** Every chain (by blockchain ID) the address has appeared on. */
export async function listChainIds(network: XNetwork, address: string): Promise<string[]> {
    const r = await get<{ addresses?: { address: string; blockchainIds: string[] }[] }>(`${GLACIER_BASE}/networks/${network}/addresses:listChainIds`, {
        addresses: address,
    })
    return r.addresses?.find((a) => a.address === address)?.blockchainIds ?? r.addresses?.[0]?.blockchainIds ?? []
}

/**
 * A transaction ID carries no network: try the one the user picked, then the
 * other, so a Fuji ID pasted while on Mainnet still resolves.
 */
export async function findTransaction(txHash: string, preferred: XNetwork): Promise<{ network: XNetwork; tx: XTransaction }> {
    const order: XNetwork[] = preferred === 'mainnet' ? ['mainnet', 'fuji'] : ['fuji', 'mainnet']
    let notFound: unknown
    for (const network of order) {
        try {
            return { network, tx: await getTransaction(network, txHash) }
        } catch (e) {
            if (e instanceof ExplorerError && (e.status === 404 || e.status === 400)) {
                notFound = e
                continue
            }
            throw e
        }
    }
    throw notFound instanceof ExplorerError && notFound.status === 400 ? notFound : new ExplorerError('No X-Chain transaction with this ID on Mainnet or Fuji.', 404)
}

// ── presentation helpers ──────────────────────────────────────────────────────

const CHAIN_NAMES: Record<string, string> = {
    '2oYMBNV4eNHyqk2fjjV5nVQLDbtmNJzq5s3qs3Lo6ftnC6FByM': 'X-Chain',
    '11111111111111111111111111111111LpoYY': 'P-Chain',
    '2q9e4r6Mu3U68nU1fYjgbR6JvwrRx36CohpAX5UQxse55x1Q5': 'C-Chain',
    '2JVSBoinj9C2J33VntvzYtVJNZdN2NKiwwKjcumHUWEb5DbBrm': 'X-Chain (Fuji)',
    yH8D7ThNJkxmtkuv2jgBa4P1Rn3Qpr4pPr7QYNfcdoS6k6HWp: 'C-Chain (Fuji)',
}

/** "X-Chain", "C-Chain", … for the primary network's chains; the raw ID otherwise. */
export const chainName = (blockchainId?: string) => (blockchainId ? CHAIN_NAMES[blockchainId] ?? blockchainId : '')

/** `amount` (base units, a decimal string) shown with `denomination` decimals, exactly — no float rounding. */
export function formatAmount(amount: string | number | bigint, denomination: number): string {
    let v: bigint
    try {
        v = BigInt(amount)
    } catch {
        return String(amount)
    }
    const negative = v < BigInt(0)
    if (negative) v = -v
    const s = v.toString().padStart(denomination + 1, '0')
    const whole = s.slice(0, s.length - denomination) || '0'
    const frac = denomination ? s.slice(s.length - denomination).replace(/0+$/, '') : ''
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`
}

export interface AssetChange {
    assetId: string
    symbol: string
    name: string
    denomination: number
    /** Base units: received minus spent, for the queried address. */
    net: bigint
}

/**
 * What `tx` did to `address`, per asset: everything emitted to it minus
 * everything it spent. UTXOs shared with other owners (multisig) count fully,
 * as an explorer would.
 */
export function netChangeFor(tx: XTransaction, address: string): AssetChange[] {
    const a = address.toLowerCase()
    const byAsset = new Map<string, AssetChange>()
    const add = (u: XUtxo, sign: 1 | -1) => {
        if (!u.addresses?.some((x) => x.toLowerCase() === a)) return
        const k = u.asset.assetId
        const cur = byAsset.get(k) ?? { assetId: k, symbol: u.asset.symbol, name: u.asset.name, denomination: u.asset.denomination, net: BigInt(0) }
        cur.net += BigInt(u.asset.amount) * BigInt(sign)
        byAsset.set(k, cur)
    }
    tx.emittedUtxos?.forEach((u) => add(u, 1))
    tx.consumedUtxos?.forEach((u) => add(u, -1))
    return Array.from(byAsset.values())
}

/**
 * The fee per asset: what the inputs held (`amountUnlocked`) minus what the
 * outputs hold (`amountCreated`). Exported outputs are among the outputs (their
 * `consumedOnChainId` names the destination chain), so exports aren't
 * mistaken for fee.
 */
export function feesOf(tx: XTransaction): AssetChange[] {
    const map = new Map<string, AssetChange>()
    const add = (x: XAsset, sign: 1 | -1) => {
        const cur = map.get(x.assetId) ?? { assetId: x.assetId, symbol: x.symbol, name: x.name, denomination: x.denomination, net: BigInt(0) }
        cur.net += BigInt(x.amount) * BigInt(sign)
        map.set(x.assetId, cur)
    }
    tx.amountUnlocked?.forEach((x) => add(x, 1))
    tx.amountCreated?.forEach((x) => add(x, -1))
    return Array.from(map.values()).filter((c) => c.net > BigInt(0))
}

/** Unix seconds → local date and time, plus the ISO form for a tooltip. */
export function formatTime(seconds?: number): { local: string; iso: string } {
    if (!seconds) return { local: '', iso: '' }
    const d = new Date(seconds * 1000)
    return { local: d.toLocaleString(), iso: d.toISOString() }
}

/** The memo, decoded when it is printable UTF-8 ("0x" is Glacier's empty memo). */
export function decodeMemo(memo?: string): { hex: string; text: string | null } {
    const hex = memo && memo !== '0x' ? memo : ''
    if (!hex) return { hex: '', text: null }
    try {
        const bytes = new Uint8Array((hex.replace(/^0x/, '').match(/../g) ?? []).map((b) => parseInt(b, 16)))
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return { hex, text: /^[\P{C}\n\r\t]*$/u.test(text) ? text : null }
    } catch {
        return { hex, text: null }
    }
}
