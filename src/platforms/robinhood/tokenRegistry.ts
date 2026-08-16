/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Robinhood Chain's token registry.
 *
 * Minimal by design: just the native asset entry (ETH, `contractAddress:
 * null`), which is the one every platform's registry MUST have — see
 * `getNativeEntry` in ../tokenRegistryHelpers.ts, which throws if it's
 * missing. Everything else works exactly like Avalanche's registry (see
 * ./tokenRegistry/index.ts there for the full design rationale): a token
 * with no entry here isn't blocked, only a candidate claiming "ETH" at a
 * contract address (impossible — ETH is native, so any contract claiming
 * that symbol is automatically a spoof) gets rejected.
 *
 * Add entries here the same way Avalanche's registry.json does, as this
 * chain's own well-known tokens become worth pinning.
 */
import type { PlatformTokenRegistryEntry } from '../types'
import { createTokenRegistry } from '../tokenRegistryHelpers'

// No chainId on the native entry: it's valid regardless of which Robinhood
// Chain network (mainnet/testnet) is active, same as Avalanche's AVAX entry.
const REGISTRY: PlatformTokenRegistryEntry[] = [
    {
        contractAddress: null,
        name: 'Ethereum',
        description: 'Native gas asset of Robinhood Chain, an Arbitrum L2 on Ethereum.',
        symbol: 'ETH',
        websiteUrl: 'https://docs.robinhood.com/chain',
    },
]

export const robinhoodTokenRegistry = createTokenRegistry(REGISTRY)
