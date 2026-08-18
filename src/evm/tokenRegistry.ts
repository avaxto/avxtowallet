/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Per-network token registries.
 *
 * Lives here, next to the network registry, rather than under
 * `platforms/evm/`: building a registry for an *explicitly given* network is
 * pure data and has no business reaching into platform session state. Keeping
 * it separate is what stops a data module like `stores/evmPortfolio` from
 * transitively importing the platform store — and through it the router and
 * the whole view layer.
 *
 * `platforms/evm/tokenRegistry.ts` wraps this with the "for the *active*
 * network" variant, which is the part that does need the store.
 *
 * Unlike a single-chain platform's registry this cannot be one static list:
 * `isReservedNativeSymbol` has to answer "is this the native asset?", and the
 * answer depends on the network — ETH on Ethereum, POL on Polygon, AVAX on
 * Avalanche C-Chain. A fixed registry would either pick one and be wrong
 * everywhere else, or list several native entries and make `getNativeEntry()`
 * ambiguous.
 */
import type { PlatformTokenRegistry, PlatformTokenRegistryEntry } from '@/platforms/types'
import { createTokenRegistry } from '@/platforms/tokenRegistryHelpers'
import type { EvmNetwork } from './networkRegistry'

const cache = new Map<number, PlatformTokenRegistry>()

/** The registry for one specific network. */
export function tokenRegistryFor(network: EvmNetwork): PlatformTokenRegistry {
    const cached = cache.get(network.evmChainId)
    if (cached) return cached

    const entries: PlatformTokenRegistryEntry[] = [
        {
            contractAddress: null,
            name: network.native.name,
            description: `Native gas asset of ${network.name}.`,
            symbol: network.native.symbol,
            websiteUrl: network.explorerUrl,
        },
    ]

    const registry = createTokenRegistry(entries)
    cache.set(network.evmChainId, registry)
    return registry
}
