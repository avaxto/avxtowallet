/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Avalanche (Glacier / chainkit) token discovery.
 *
 * Ava Labs' own indexer, and the best source for the two Avalanche networks:
 * it returns current ERC-20 holdings directly, so unlike the transfer-history
 * approach the other families need, it does not resurface positions the
 * address emptied long ago.
 *
 * Registry-gated on purpose. The SDK is constructed per chain id and only
 * indexes Avalanche, so selecting this family for any other network would
 * silently return nothing (or throw) rather than falling back to something
 * that works — the gate makes that a loud configuration error instead.
 */
import { Avalanche } from '@avalanche-sdk/chainkit'

import type { EvmNetwork } from '../networkRegistry'
import type { DiscoveredToken, ExplorerAdapter } from './types'

/** Chain ids Glacier actually indexes. */
const GLACIER_CHAIN_IDS = new Set([43114, 43113])

export const glacierAdapter: ExplorerAdapter = {
    family: 'glacier',

    async discoverTokens(address: string, network: EvmNetwork): Promise<DiscoveredToken[]> {
        if (!GLACIER_CHAIN_IDS.has(network.evmChainId)) {
            throw new Error(
                `Glacier does not index chain ${network.evmChainId} (${network.name}). ` +
                    'Use the blockscout or etherscan family for this network.'
            )
        }

        const sdk = new Avalanche({
            chainId: String(network.evmChainId),
            enableTelemetry: false,
        })

        const out: DiscoveredToken[] = []
        const pages = await sdk.data.evm.address.balances.listErc20({ address })
        for await (const page of pages) {
            for (const token of page.result.erc20TokenBalances) {
                if (!token?.address) continue
                out.push({
                    address: token.address.toLowerCase(),
                    symbol: token.symbol ?? '',
                    name: token.name ?? '',
                    decimals: token.decimals ?? undefined,
                    logoUri: token.logoUri,
                })
            }
        }
        return out
    },
}
