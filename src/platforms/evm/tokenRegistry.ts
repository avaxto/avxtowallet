/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM platform's token registry.
 *
 * Unlike a single-chain platform's registry, this one cannot be a static list:
 * `isReservedNativeSymbol` has to answer "is this the native asset?", and the
 * answer depends on which network is active — ETH on Ethereum, POL on Polygon,
 * AVAX on Avalanche C-Chain. A fixed registry would either pick one and be
 * wrong everywhere else, or list several native entries and make
 * `getNativeEntry()` ambiguous.
 *
 * So a registry is built per network and memoised. Entries are otherwise
 * empty for now: pinned per-chain token addresses arrive with the aggregated
 * portfolio, which is what needs them. The anti-spoofing machinery itself is
 * shared with every other platform (see `platforms/tokenRegistryHelpers.ts`)
 * so the homoglyph/confusables handling cannot drift between them.
 */
import type { PlatformTokenRegistry, PlatformTokenRegistryEntry } from '../types'
import { createTokenRegistry } from '../tokenRegistryHelpers'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { peekActiveNetwork } from './store'

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

/**
 * The registry for whichever network is currently active — what
 * `evmPlatform.tokenRegistry` exposes.
 */
export function activeEvmTokenRegistry(): PlatformTokenRegistry {
    const network = peekActiveNetwork()
    // peekActiveNetwork always resolves to a real network (it falls back to
    // the default), so there is no null case to handle here.
    return tokenRegistryFor(network as EvmNetwork)
}
