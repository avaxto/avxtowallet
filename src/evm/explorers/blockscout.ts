/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Blockscout token discovery.
 *
 * Blockscout's v2 API has a real "what does this address hold" endpoint
 * (`/api/v2/addresses/{hash}/token-balances`), which is a much better source
 * than transfer history: it returns current holdings directly instead of every
 * contract the address ever touched, so it does not surface long-since-emptied
 * positions.
 *
 * Older or trimmed-down instances only expose the Etherscan-compatible
 * `tokentx` endpoint, so that is kept as a fallback rather than assuming every
 * Blockscout deployment is current.
 */
import type { EvmNetwork } from '../networkRegistry'
import { fetchExplorerJson } from './http'
import type { ActivityPage, DiscoveredToken, EvmActivityTx, ExplorerAdapter } from './types'

interface BlockscoutV2TokenBalance {
    token?: {
        address?: string
        address_hash?: string
        name?: string
        symbol?: string
        decimals?: string | number
        type?: string
        icon_url?: string
    }
}

interface BlockscoutTokenTx {
    contractAddress: string
    tokenName: string
    tokenSymbol: string
    tokenDecimal: string
}

interface BlockscoutTokenTxResponse {
    status?: string
    message?: string
    result?: BlockscoutTokenTx[] | null
}

function parseDecimals(raw: string | number | undefined): number | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined
    const n = typeof raw === 'number' ? raw : parseInt(raw, 10)
    return Number.isFinite(n) ? n : undefined
}

async function viaV2(address: string, network: EvmNetwork): Promise<DiscoveredToken[]> {
    const url = `${network.explorerApi.url}/v2/addresses/${address}/token-balances`
    const raw = await fetchExplorerJson<BlockscoutV2TokenBalance[]>(url)
    if (!Array.isArray(raw)) throw new Error('Unexpected Blockscout v2 response shape')

    const out: DiscoveredToken[] = []
    for (const entry of raw) {
        const token = entry?.token
        const contract = token?.address ?? token?.address_hash
        if (!contract) continue
        // ERC-20 only here; NFTs are a separate surface.
        if (token?.type && !/ERC-?20/i.test(token.type)) continue
        out.push({
            address: contract.toLowerCase(),
            symbol: token?.symbol ?? '',
            name: token?.name ?? '',
            decimals: parseDecimals(token?.decimals),
            logoUri: token?.icon_url,
        })
    }
    return out
}

async function viaTokenTx(address: string, network: EvmNetwork): Promise<DiscoveredToken[]> {
    const url =
        `${network.explorerApi.url}?module=account&action=tokentx` + `&address=${address}&sort=desc`
    const raw = await fetchExplorerJson<BlockscoutTokenTxResponse>(url)

    // This endpoint reports failure with HTTP 200 and status '0' — verified
    // directly against polygon.blockscout.com, which under load returns
    // `{"status":"0","message":"Something went wrong.","result":null}` on the
    // very same address that a moment earlier or later gave the legitimate
    // `{"status":"0","message":"No token transfers found","result":[]}` for
    // an address that has genuinely never held a token. The distinguishing
    // signal is `result` being an array (possibly empty) vs `null` — message
    // TEXT is not reliable to branch on: Blockscout's wording here ("No token
    // transfers found") differs from Etherscan's own ("No transactions
    // found") for the identical case. Without this check, a transient server
    // error silently read as "this address holds nothing", which is a much
    // worse failure than reporting the network as unavailable — it looks like
    // an accurate answer instead of a missing one.
    if (raw?.status === '0' && !Array.isArray(raw?.result)) {
        throw new Error(`Blockscout: ${raw?.message ?? 'request failed'}`)
    }

    const rows = Array.isArray(raw?.result) ? raw.result : []

    // Transfer history repeats a contract once per transfer; only the first
    // occurrence's metadata is needed.
    const seen = new Map<string, DiscoveredToken>()
    for (const tx of rows) {
        if (!tx?.contractAddress) continue
        const addr = tx.contractAddress.toLowerCase()
        if (seen.has(addr)) continue
        seen.set(addr, {
            address: addr,
            symbol: tx.tokenSymbol ?? '',
            name: tx.tokenName ?? '',
            decimals: parseDecimals(tx.tokenDecimal),
        })
    }
    return [...seen.values()]
}

/**
 * v2 transaction-list response shape.
 *
 * Confirmed directly against `eth.blockscout.com` — `method` comes back as
 * either a decoded function name ("transfer") or, for a call the instance
 * hasn't decoded, the raw 4-byte selector as a hex string; `toActivityTx`
 * below is what tells those two apart before treating it as a label.
 */
interface BlockscoutV2Address {
    hash?: string
}

interface BlockscoutV2Tx {
    hash: string
    block_number: number
    /** ISO 8601, e.g. "2026-08-20T20:03:59.000000Z". */
    timestamp: string
    from?: BlockscoutV2Address
    to?: BlockscoutV2Address | null
    value?: string
    status?: string
    method?: string | null
    created_contract?: BlockscoutV2Address | null
}

interface BlockscoutV2TxList {
    items?: BlockscoutV2Tx[]
    /** Echo verbatim as query params to fetch the next page; null on the last one. */
    next_page_params?: Record<string, string | number> | null
}

function toActivityTx(tx: BlockscoutV2Tx): EvmActivityTx {
    // A decoded name is a plain identifier; an un-decoded selector is "0x"
    // followed by hex. Showing the latter as if it were a label would read as
    // more informative than it actually is — see the interface doc.
    const method = tx.method && !/^0x[0-9a-f]*$/i.test(tx.method) ? tx.method : null
    return {
        hash: tx.hash,
        blockNumber: tx.block_number,
        timestampMs: Date.parse(tx.timestamp) || 0,
        from: (tx.from?.hash ?? '').toLowerCase(),
        to: tx.to?.hash ? tx.to.hash.toLowerCase() : null,
        valueWei: tx.value ?? '0',
        isContractCreation: !!tx.created_contract,
        methodLabel: method,
        status: tx.status === 'ok' ? 'ok' : tx.status === 'error' ? 'failed' : 'unknown',
    }
}

/** Builds the next-page query string from a `next_page_params` object, verbatim. */
function cursorQueryString(cursor: unknown): string {
    if (!cursor || typeof cursor !== 'object') return ''
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(cursor as Record<string, unknown>)) {
        if (value !== undefined && value !== null) params.set(key, String(value))
    }
    const qs = params.toString()
    return qs ? `?${qs}` : ''
}

export const blockscoutAdapter: ExplorerAdapter = {
    family: 'blockscout',

    async discoverTokens(address: string, network: EvmNetwork): Promise<DiscoveredToken[]> {
        try {
            return await viaV2(address, network)
        } catch (e) {
            // Only the modern endpoint is optional — if the fallback also
            // fails, the error propagates and this one network degrades.
            console.warn(
                `[explorers/blockscout] v2 endpoint unavailable for ${network.name}, ` +
                    'falling back to tokentx:',
                e
            )
            return await viaTokenTx(address, network)
        }
    },

    async listTransactions(
        address: string,
        network: EvmNetwork,
        cursor?: unknown
    ): Promise<ActivityPage> {
        const url =
            `${network.explorerApi.url}/v2/addresses/${address}/transactions` +
            cursorQueryString(cursor)
        const raw = await fetchExplorerJson<BlockscoutV2TxList>(url)
        const items = Array.isArray(raw?.items) ? raw.items : []
        return {
            transactions: items.map(toActivityTx),
            nextCursor: raw?.next_page_params ?? null,
        }
    },
}
