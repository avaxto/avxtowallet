/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Etherscan V2 token discovery.
 *
 * V2 is one endpoint for every supported chain, selected by a `chainid` query
 * parameter — so a single user key covers every etherscan-family network in
 * the registry.
 *
 * Etherscan has no free "current token balances" endpoint (that one is behind
 * their paid tier), so discovery walks `tokentx` transfer history and reduces
 * it to the distinct contracts the address has touched. Positions since
 * emptied will appear here with a zero balance; the caller filters those out
 * after reading real balances on-chain.
 */
import type { EvmNetwork } from '../networkRegistry'
import { getEtherscanApiKey } from './apiKey'
import { fetchExplorerJson } from './http'
import { MissingApiKeyError } from './types'
import type { ActivityPage, DiscoveredToken, EvmActivityTx, ExplorerAdapter } from './types'

interface EtherscanTokenTx {
    contractAddress: string
    tokenName: string
    tokenSymbol: string
    tokenDecimal: string
}

interface EtherscanResponse {
    status?: string
    message?: string
    result?: EtherscanTokenTx[] | string
}

/** Classic `txlist` response shape (unchanged by the V2 endpoint migration). */
interface EtherscanTx {
    hash: string
    blockNumber: string
    timeStamp: string
    from: string
    to: string
    value: string
    txreceipt_status: string
    isError: string
    contractAddress: string
    /** e.g. "transfer(address,uint256)", or empty when un-decoded/a plain transfer. */
    functionName: string
}

interface EtherscanTxListResponse {
    status?: string
    message?: string
    result?: EtherscanTx[] | string
}

/** Requests beyond this are almost certainly a bug walking pages forever. */
const TX_PAGE_SIZE = 25
const MAX_PAGE = 1000

function toActivityTx(tx: EtherscanTx): EvmActivityTx {
    // functionName is the full signature ("transfer(address,uint256)");
    // only the name reads as a label.
    const method = tx.functionName ? tx.functionName.split('(')[0].trim() : null
    return {
        hash: tx.hash,
        blockNumber: parseInt(tx.blockNumber, 10) || 0,
        timestampMs: (parseInt(tx.timeStamp, 10) || 0) * 1000,
        from: (tx.from ?? '').toLowerCase(),
        to: tx.to ? tx.to.toLowerCase() : null,
        valueWei: tx.value ?? '0',
        isContractCreation: !tx.to && !!tx.contractAddress,
        methodLabel: method || null,
        status:
            // txreceipt_status is only populated post-Byzantium; isError is
            // the older, always-present signal — checked second so a chain
            // that sets both is read from the more specific field.
            tx.txreceipt_status === '1'
                ? 'ok'
                : tx.txreceipt_status === '0'
                ? 'failed'
                : tx.isError === '1'
                ? 'failed'
                : tx.isError === '0'
                ? 'ok'
                : 'unknown',
    }
}

export const etherscanAdapter: ExplorerAdapter = {
    family: 'etherscan',

    async discoverTokens(address: string, network: EvmNetwork): Promise<DiscoveredToken[]> {
        const apiKey = getEtherscanApiKey()
        if (!apiKey) throw new MissingApiKeyError(network.name)

        const url =
            `${network.explorerApi.url}?chainid=${network.evmChainId}` +
            `&module=account&action=tokentx&address=${address}` +
            `&startblock=0&endblock=99999999&sort=desc&apikey=${apiKey}`

        const raw = await fetchExplorerJson<EtherscanResponse>(url)

        // Etherscan reports failures with HTTP 200 and status '0'. A
        // legitimate empty result also carries status '0' but returns
        // `result` as an (empty) array — real errors return `result` as a
        // string (the error message) or omit it. This is checked ahead of the
        // message-text match below because wording is not something to build
        // on: the same shape of bug in Blockscout's own tokentx endpoint (see
        // ./blockscout.ts) turned out to use different phrasing for the
        // identical case, and would have defeated a text-only check here too.
        if (raw?.status === '0' && !Array.isArray(raw.result)) {
            const message = typeof raw.result === 'string' ? raw.result : raw.message
            if (/no transactions found/i.test(message ?? '')) return []
            throw new Error(`Etherscan: ${message ?? 'request failed'}`)
        }

        const rows = Array.isArray(raw?.result) ? raw.result : []
        const seen = new Map<string, DiscoveredToken>()
        for (const tx of rows) {
            if (!tx?.contractAddress) continue
            const addr = tx.contractAddress.toLowerCase()
            if (seen.has(addr)) continue
            const decimals = parseInt(tx.tokenDecimal, 10)
            seen.set(addr, {
                address: addr,
                symbol: tx.tokenSymbol ?? '',
                name: tx.tokenName ?? '',
                decimals: Number.isFinite(decimals) ? decimals : undefined,
            })
        }
        return [...seen.values()]
    },

    async listTransactions(
        address: string,
        network: EvmNetwork,
        cursor?: unknown
    ): Promise<ActivityPage> {
        const apiKey = getEtherscanApiKey()
        if (!apiKey) throw new MissingApiKeyError(network.name)

        // Classic txlist pages by number rather than a cursor, so the
        // "cursor" here is just next page's index. Clamped rather than
        // trusted blindly: this only ever comes back from this function's own
        // previous nextCursor, but an unbounded page number is still a cheap
        // guard against looping forever if that assumption is ever wrong.
        const page = Math.min(typeof cursor === 'number' && cursor > 0 ? cursor : 1, MAX_PAGE)

        const url =
            `${network.explorerApi.url}?chainid=${network.evmChainId}` +
            `&module=account&action=txlist&address=${address}` +
            `&startblock=0&endblock=99999999&page=${page}&offset=${TX_PAGE_SIZE}` +
            `&sort=desc&apikey=${apiKey}`

        const raw = await fetchExplorerJson<EtherscanTxListResponse>(url)

        // See discoverTokens above for why status/result-shape is checked
        // ahead of message text.
        if (raw?.status === '0' && !Array.isArray(raw.result)) {
            const message = typeof raw.result === 'string' ? raw.result : raw.message
            if (/no transactions found/i.test(message ?? '')) {
                return { transactions: [], nextCursor: null }
            }
            throw new Error(`Etherscan: ${message ?? 'request failed'}`)
        }

        const rows = Array.isArray(raw?.result) ? raw.result : []
        return {
            transactions: rows.map(toActivityTx),
            // A full page means there is likely another; an under-full page
            // (including empty) is the last one — txlist has no other signal
            // for "more remain".
            nextCursor: rows.length === TX_PAGE_SIZE && page < MAX_PAGE ? page + 1 : null,
        }
    },
}
