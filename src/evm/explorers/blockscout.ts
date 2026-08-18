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
import type { DiscoveredToken, ExplorerAdapter } from './types'

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
        `${network.explorerApi.url}?module=account&action=tokentx` +
        `&address=${address}&sort=desc`
    const raw = await fetchExplorerJson<{ result?: BlockscoutTokenTx[] }>(url)
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
}
