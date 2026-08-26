/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * HD address discovery.
 *
 * Two distinct problems, solved separately:
 *
 * 1. **Which address type?** The same recovery phrase produces four completely
 *    different sets of addresses (see ./networks.ts). A wallet that assumes
 *    one shows an empty account to anyone whose funds are on another, which
 *    reads as lost money. `probeAddressTypes` checks a handful of addresses
 *    from each and reports which actually have history.
 *
 * 2. **Which addresses within that type?** BIP-44 wallets do not use address
 *    0, 1, 2… contiguously — gaps appear whenever an address is generated but
 *    never paid. The convention is to scan forward until `GAP_LIMIT`
 *    consecutive addresses have no history at all, then stop.
 *
 * Both are read-only: everything here works from an extended PUBLIC key, so
 * a watch-only wallet scans exactly the same way a signing one does.
 */
import type { BIP32Interface } from 'bip32'

import { addressFromPublicKey, addressPath } from './keys'
import { getAddressStats, getAddressUtxos, type EsploraUtxo } from './esplora'
import { ADDRESS_TYPES, type BitcoinNetwork, type BtcAddressType } from './networks'
import type { BtcChain } from './keys'
import type { SelectableUtxo } from './coinSelect'

/**
 * BIP-44's recommended gap limit. Scanning stops after this many consecutive
 * unused addresses; going higher costs proportionally more indexer requests,
 * going lower risks missing funds past a gap another wallet created.
 */
export const GAP_LIMIT = 20

/** How many addresses of each type to check when deciding which type is in use. */
const TYPE_PROBE_DEPTH = 5

/**
 * Concurrent indexer requests. Public Esplora endpoints throttle aggressively,
 * and a full scan is dozens of requests — this keeps it fast without tripping
 * the rate limiter.
 */
const CONCURRENCY = 4

export interface ScannedAddress {
    address: string
    path: string
    chain: BtcChain
    index: number
    type: BtcAddressType
    /** Confirmed + unconfirmed balance in satoshis. */
    balanceSats: number
    /** True if this address has ever been involved in a transaction. */
    used: boolean
}

export interface AccountScan {
    type: BtcAddressType
    addresses: ScannedAddress[]
    balanceSats: number
    /** The first receive address with no history — what to show for "Receive". */
    nextReceiveAddress: string
    hasHistory: boolean
}

/** Runs `fn` over `items` with a bounded number in flight at once. */
async function mapLimited<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let cursor = 0

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        for (;;) {
            const i = cursor++
            if (i >= items.length) return
            results[i] = await fn(items[i])
        }
    })

    await Promise.all(workers)
    return results
}

/** Derives one address from an account-level node. */
function deriveAt(
    accountNode: BIP32Interface,
    type: BtcAddressType,
    network: BitcoinNetwork,
    chain: BtcChain,
    index: number,
    account: number
): { address: string; path: string } {
    const node = accountNode.derive(chain === 'receive' ? 0 : 1).derive(index)
    return {
        address: addressFromPublicKey(node.publicKey, type, network),
        path: addressPath(type, network, account, chain, index),
    }
}

/**
 * Scans one chain (receive or change) of one account until the gap limit.
 *
 * Works by extending a frontier rather than re-walking: the scan must cover
 * `GAP_LIMIT` addresses past the last USED one, so each round fetches exactly
 * the indices not yet checked, and finding a used address pushes the target
 * further out. No address is ever requested twice, which matters because the
 * public indexers throttle and a naive sliding window re-fetches most of a
 * batch every round.
 */
async function scanChain(
    accountNode: BIP32Interface,
    type: BtcAddressType,
    network: BitcoinNetwork,
    chain: BtcChain,
    account: number
): Promise<ScannedAddress[]> {
    const seen = new Map<number, ScannedAddress>()
    let lastUsedIndex = -1
    let checkedUpTo = -1

    for (;;) {
        // The gap rule: keep going until GAP_LIMIT unused addresses sit past
        // the last used one.
        const needUpTo = lastUsedIndex + GAP_LIMIT
        if (checkedUpTo >= needUpTo) break

        const indices: number[] = []
        for (let i = checkedUpTo + 1; i <= needUpTo; i++) indices.push(i)

        const derived = indices.map((index) =>
            deriveAt(accountNode, type, network, chain, index, account)
        )
        const stats = await mapLimited(derived, CONCURRENCY, (d) =>
            getAddressStats(d.address, network)
        )

        stats.forEach((s, k) => {
            const index = indices[k]
            const funded = s.chain_stats.funded_txo_sum + s.mempool_stats.funded_txo_sum
            const spent = s.chain_stats.spent_txo_sum + s.mempool_stats.spent_txo_sum
            const used = s.chain_stats.tx_count + s.mempool_stats.tx_count > 0

            seen.set(index, {
                address: derived[k].address,
                path: derived[k].path,
                chain,
                index,
                type,
                balanceSats: funded - spent,
                used,
            })

            if (used && index > lastUsedIndex) lastUsedIndex = index
        })

        checkedUpTo = needUpTo
    }

    return Array.from({ length: checkedUpTo + 1 }, (_, i) => seen.get(i)).filter(
        (a): a is ScannedAddress => a !== undefined
    )
}

/** Full scan of one address type's account: both chains, gap-limited. */
export async function scanAccount(
    accountNode: BIP32Interface,
    type: BtcAddressType,
    network: BitcoinNetwork,
    account = 0
): Promise<AccountScan> {
    const [receive, change] = await Promise.all([
        scanChain(accountNode, type, network, 'receive', account),
        scanChain(accountNode, type, network, 'change', account),
    ])

    const addresses = [...receive, ...change]
    const balanceSats = addresses.reduce((sum, a) => sum + a.balanceSats, 0)
    const firstUnused = receive.find((a) => !a.used)

    return {
        type,
        addresses,
        balanceSats,
        // A scan always ends on unused addresses, so this is only absent if
        // every one checked was used — fall back to the next index along.
        nextReceiveAddress:
            firstUnused?.address ??
            deriveAt(accountNode, type, network, 'receive', receive.length, account).address,
        hasHistory: addresses.some((a) => a.used),
    }
}

export interface TypeProbe {
    type: BtcAddressType
    hasHistory: boolean
    balanceSats: number
}

/**
 * Checks the first few addresses of every address type to find which one a
 * phrase is actually using.
 *
 * Deliberately shallow — `TYPE_PROBE_DEPTH` addresses per type rather than a
 * full gap-limit scan of each — because this runs at import time while the
 * user waits, and four full scans would be ~160 indexer requests. Any wallet
 * that has ever received funds used its address 0 first, so a shallow probe
 * finds it; the full scan then happens once, on the type that won.
 *
 * Never throws for indexer failure: a phrase must remain importable with the
 * network down. On failure every type reports no history and the caller falls
 * back to the default type.
 */
export async function probeAddressTypes(
    accountNodeFor: (type: BtcAddressType) => BIP32Interface,
    network: BitcoinNetwork,
    account = 0
): Promise<TypeProbe[]> {
    try {
        return await mapLimited(ADDRESS_TYPES, 2, async (type) => {
            const node = accountNodeFor(type)
            const derived = Array.from({ length: TYPE_PROBE_DEPTH }, (_, i) =>
                deriveAt(node, type, network, 'receive', i, account)
            )
            const stats = await mapLimited(derived, CONCURRENCY, (d) =>
                getAddressStats(d.address, network)
            )

            let balanceSats = 0
            let hasHistory = false
            for (const s of stats) {
                const funded = s.chain_stats.funded_txo_sum + s.mempool_stats.funded_txo_sum
                const spent = s.chain_stats.spent_txo_sum + s.mempool_stats.spent_txo_sum
                balanceSats += funded - spent
                if (s.chain_stats.tx_count + s.mempool_stats.tx_count > 0) hasHistory = true
            }
            return { type, hasHistory, balanceSats }
        })
    } catch (e) {
        console.warn('[bitcoin/discovery] type probe failed, using the default type:', e)
        return ADDRESS_TYPES.map((type) => ({ type, hasHistory: false, balanceSats: 0 }))
    }
}

/**
 * Which address type to open a freshly-imported phrase on.
 *
 * Prefers the type holding the most value; falls back to any type with history
 * (a wallet that has been fully swept still tells us which type it was), and
 * finally to the caller's default for a phrase with no history at all.
 */
export function pickAddressType(
    probes: TypeProbe[],
    fallback: BtcAddressType
): BtcAddressType {
    const funded = probes.filter((p) => p.balanceSats > 0)
    if (funded.length > 0) {
        return funded.reduce((best, p) => (p.balanceSats > best.balanceSats ? p : best)).type
    }
    const used = probes.find((p) => p.hasHistory)
    if (used) return used.type
    return fallback
}

/**
 * Fetches spendable UTXOs for every address a scan found to be used.
 *
 * Only used addresses are queried — an address with no history by definition
 * has no unspent outputs, so asking would be a wasted request against a
 * rate-limited endpoint.
 */
export async function collectUtxos(
    scan: AccountScan,
    network: BitcoinNetwork
): Promise<SelectableUtxo[]> {
    const funded = scan.addresses.filter((a) => a.used && a.balanceSats > 0)

    const perAddress = await mapLimited(funded, CONCURRENCY, async (a) => {
        const utxos = await getAddressUtxos(a.address, network)
        return utxos.map(
            (u: EsploraUtxo): SelectableUtxo => ({
                txid: u.txid,
                vout: u.vout,
                value: u.value,
                address: a.address,
                addressType: a.type,
                path: a.path,
                confirmed: u.status.confirmed,
            })
        )
    })

    return perAddress.flat()
}
