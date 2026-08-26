/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Esplora REST client.
 *
 * Bitcoin has no public JSON-RPC — a node's RPC interface is authenticated and
 * not internet-facing — so a wallet has to read the chain through an indexer.
 * Esplora is Blockstream's, and mempool.space serves the same API, which makes
 * it the closest thing to a standard public read layer Bitcoin has.
 *
 * Everything here is read-only except `broadcastTx`.
 */
import type { BitcoinNetwork } from './networks'

/** One unspent output, as Esplora reports it. */
export interface EsploraUtxo {
    txid: string
    vout: number
    value: number // satoshis
    status: {
        confirmed: boolean
        block_height?: number
        block_time?: number
    }
}

/** Cumulative funded/spent totals for an address. */
export interface EsploraAddressStats {
    address: string
    chain_stats: {
        funded_txo_count: number
        funded_txo_sum: number
        spent_txo_count: number
        spent_txo_sum: number
        tx_count: number
    }
    mempool_stats: {
        funded_txo_count: number
        funded_txo_sum: number
        spent_txo_count: number
        spent_txo_sum: number
        tx_count: number
    }
}

export interface EsploraTx {
    txid: string
    version: number
    locktime: number
    size: number
    weight: number
    fee: number
    status: {
        confirmed: boolean
        block_height?: number
        block_time?: number
    }
    vin: {
        txid: string
        vout: number
        prevout: { scriptpubkey_address?: string; value: number } | null
    }[]
    vout: { scriptpubkey_address?: string; value: number }[]
}

/**
 * Fee rates in sat/vB, keyed by target confirmation depth in blocks.
 * Esplora returns a sparse map — '1', '2', '3', '6', '10', '144', '504', '1008'.
 */
export type EsploraFeeEstimates = Record<string, number>

async function request<T>(
    network: BitcoinNetwork,
    path: string,
    what: string,
    init?: RequestInit
): Promise<T> {
    const url = `${network.esploraUrl}${path}`
    let res: Response
    try {
        res = await fetch(url, {
            ...init,
            headers: { accept: 'application/json', ...(init?.headers ?? {}) },
        })
    } catch {
        throw new Error(
            `${what} failed: could not reach the Bitcoin indexer at ${network.esploraUrl}.`
        )
    }

    const text = await res.text()

    if (!res.ok) {
        // Esplora returns a bare text body for errors, which is often the most
        // useful thing available — surface it rather than just the status.
        const detail = text.trim().slice(0, 200)
        if (res.status === 429) {
            throw new Error(
                `${what} failed: the indexer is rate-limiting this wallet. ` +
                    'Public Esplora endpoints are throttled — set a custom indexer in Settings.'
            )
        }
        throw new Error(`${what} failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}.`)
    }

    return text ? (JSON.parse(text) as T) : (undefined as T)
}

export async function getAddressStats(
    address: string,
    network: BitcoinNetwork
): Promise<EsploraAddressStats> {
    return request(network, `/address/${address}`, 'Reading address balance')
}

/**
 * Unspent outputs for one address.
 *
 * Esplora caps this at 500 UTXOs per address and returns HTTP 400 beyond that.
 * A normal wallet address never approaches it, but the failure is opaque
 * ("Too many unspent outputs"), so it is translated into something a user can
 * act on rather than left as a raw indexer error.
 */
export async function getAddressUtxos(
    address: string,
    network: BitcoinNetwork
): Promise<EsploraUtxo[]> {
    try {
        return await request(network, `/address/${address}/utxo`, 'Reading unspent outputs')
    } catch (e: any) {
        if (/too many unspent/i.test(String(e?.message))) {
            throw new Error(
                `The address ${address} holds more unspent outputs than the indexer will ` +
                    'return (its limit is 500). This wallet cannot currently spend from it.'
            )
        }
        throw e
    }
}

/** Confirmed + mempool transactions touching an address, newest first. */
export async function getAddressTxs(
    address: string,
    network: BitcoinNetwork
): Promise<EsploraTx[]> {
    return request(network, `/address/${address}/txs`, 'Reading transaction history')
}

/** The full raw transaction, hex-encoded. Needed as `nonWitnessUtxo` for legacy inputs. */
export async function getTxHex(txid: string, network: BitcoinNetwork): Promise<string> {
    const url = `${network.esploraUrl}/tx/${txid}/hex`
    let res: Response
    try {
        res = await fetch(url)
    } catch {
        throw new Error('Fetching a previous transaction failed: could not reach the indexer.')
    }
    if (!res.ok) {
        throw new Error(`Fetching a previous transaction failed (HTTP ${res.status}).`)
    }
    return (await res.text()).trim()
}

export async function getFeeEstimates(network: BitcoinNetwork): Promise<EsploraFeeEstimates> {
    return request(network, '/fee-estimates', 'Reading fee estimates')
}

/**
 * Broadcasts a signed transaction. Returns its txid.
 *
 * Node rejections come back as a plain-text reason with HTTP 400 — those are
 * the most diagnostic errors in the whole flow (`min relay fee not met`,
 * `bad-txns-inputs-missingorspent`), so they are passed through rather than
 * flattened into a generic failure.
 */
export async function broadcastTx(txHex: string, network: BitcoinNetwork): Promise<string> {
    const url = `${network.esploraUrl}/tx`
    let res: Response
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: txHex,
        })
    } catch {
        throw new Error('Broadcast failed: could not reach the Bitcoin indexer.')
    }

    const text = (await res.text()).trim()
    if (!res.ok) {
        throw new Error(`The network rejected this transaction: ${text || `HTTP ${res.status}`}`)
    }
    if (!/^[0-9a-f]{64}$/i.test(text)) {
        throw new Error(`Broadcast returned an unexpected response: ${text.slice(0, 200)}`)
    }
    return text
}

/** Current chain tip height, used to age confirmations. */
export async function getTipHeight(network: BitcoinNetwork): Promise<number> {
    const url = `${network.esploraUrl}/blocks/tip/height`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Reading the chain tip failed (HTTP ${res.status}).`)
    return Number.parseInt((await res.text()).trim(), 10)
}
