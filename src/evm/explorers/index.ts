/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Explorer adapter lookup.
 *
 * The aggregation layer asks for "the adapter for this network" and never
 * branches on family itself, so supporting a new explorer family is a new file
 * plus one line here.
 */
import type { EvmNetwork } from '../networkRegistry'
import { blockscoutAdapter } from './blockscout'
import { etherscanAdapter } from './etherscan'
import { glacierAdapter } from './glacier'
import type { ExplorerAdapter } from './types'

const ADAPTERS: Record<string, ExplorerAdapter> = {
    blockscout: blockscoutAdapter,
    etherscan: etherscanAdapter,
    glacier: glacierAdapter,
}

export function explorerAdapterFor(network: EvmNetwork): ExplorerAdapter | undefined {
    return ADAPTERS[network.explorerApi?.family]
}

export { MissingApiKeyError, ExplorerThrottledError } from './types'
export type { ActivityPage, DiscoveredToken, EvmActivityTx, ExplorerAdapter } from './types'
export { getEtherscanApiKey, setEtherscanApiKey, hasEtherscanApiKey } from './apiKey'
