/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Wormhole SDK, loaded on first use and configured with the wallet's own
 * RPC endpoints (including any the user set in Settings), one context per
 * Wormhole network. Kept behind dynamic imports so the SDK only downloads when
 * someone actually bridges.
 */
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { getSolanaNetworkById } from '@/solana/networks'
import { WORMHOLE_EVM_CHAINS, WORMHOLE_SOLANA_CHAINS, type WormholeNetwork } from './chains'

const contexts = new Map<WormholeNetwork, Promise<any>>()

/** RPC overrides for every chain the wallet knows on `network`. */
export function rpcOverrides(network: WormholeNetwork): Record<string, { rpc: string }> {
    const chains: Record<string, { rpc: string }> = {}
    for (const [id, ref] of Object.entries(WORMHOLE_EVM_CHAINS)) {
        if (ref.network !== network) continue
        const n = getEvmNetworkByChainId(Number(id))
        if (n?.rpcUrl) chains[ref.chain] = { rpc: n.rpcUrl }
    }
    for (const [id, ref] of Object.entries(WORMHOLE_SOLANA_CHAINS)) {
        if (ref.network !== network) continue
        const n = getSolanaNetworkById(id)
        if (n?.rpcUrl) chains[ref.chain] = { rpc: n.rpcUrl }
    }
    return chains
}

async function create(network: WormholeNetwork): Promise<any> {
    const [{ Wormhole }, { EvmPlatform }, { SolanaPlatform }] = await Promise.all([
        import('@wormhole-foundation/sdk-connect'),
        import('@wormhole-foundation/sdk-evm'),
        import('@wormhole-foundation/sdk-solana'),
        // Protocol implementations register themselves on import.
        import('@wormhole-foundation/sdk-evm-core'),
        import('@wormhole-foundation/sdk-evm-tokenbridge'),
        import('@wormhole-foundation/sdk-solana-core'),
        import('@wormhole-foundation/sdk-solana-tokenbridge'),
        import('@wormhole-foundation/sdk-definitions-ntt'),
        import('@wormhole-foundation/sdk-evm-ntt'),
    ])
    return new Wormhole(network, [EvmPlatform, SolanaPlatform], { chains: rpcOverrides(network) } as any)
}

/** The shared Wormhole context for `network`. */
export function getWormhole(network: WormholeNetwork): Promise<any> {
    let ctx = contexts.get(network)
    if (!ctx) {
        ctx = create(network)
        // A failed load is retried next time rather than cached.
        ctx.catch(() => contexts.delete(network))
        contexts.set(network, ctx)
    }
    return ctx
}

/** Drops cached contexts — after an RPC override changes. */
export function resetWormhole(): void {
    contexts.clear()
}

/** The SDK's address helpers, for building addresses without a context. */
export async function wormholeStatics(): Promise<{
    parseAddress(chain: string, address: string): any
    chainAddress(chain: string, address: string): any
    tokenId(chain: string, address: string): any
    canonicalAddress(chainAddressOrTokenId: any): string
}> {
    const { Wormhole } = await import('@wormhole-foundation/sdk-connect')
    return Wormhole as any
}
