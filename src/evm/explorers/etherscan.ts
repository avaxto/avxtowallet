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
import { MissingApiKeyError, type DiscoveredToken, type ExplorerAdapter } from './types'

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

        // Etherscan reports failures with HTTP 200 and status '0'. "No
        // transactions found" is a legitimate empty result, not an error —
        // treating it as one would mark a perfectly healthy network as failed.
        if (raw?.status === '0') {
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
}
