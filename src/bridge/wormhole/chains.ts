/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Which wallet chains Wormhole serves, under which Wormhole network and chain
 * name. Spelled out rather than derived from the SDK at runtime so the SDK
 * stays out of the main bundle until a bridge is actually used; a test pins
 * this table against the SDK's own chain-id table so it cannot drift.
 */
import type { BridgeChain } from '../types'

export type WormholeNetwork = 'Mainnet' | 'Testnet'

export interface WormholeChainRef {
    network: WormholeNetwork
    /** The SDK's chain name, e.g. 'Avalanche', 'Ethereum', 'Solana'. */
    chain: string
}

/** EVM chain id → Wormhole. Chains not listed (Robinhood, custom networks) are not served. */
export const WORMHOLE_EVM_CHAINS: Record<number, WormholeChainRef> = {
    1: { network: 'Mainnet', chain: 'Ethereum' },
    43114: { network: 'Mainnet', chain: 'Avalanche' },
    8453: { network: 'Mainnet', chain: 'Base' },
    42161: { network: 'Mainnet', chain: 'Arbitrum' },
    10: { network: 'Mainnet', chain: 'Optimism' },
    137: { network: 'Mainnet', chain: 'Polygon' },
    56: { network: 'Mainnet', chain: 'Bsc' },
    43113: { network: 'Testnet', chain: 'Avalanche' },
    11155111: { network: 'Testnet', chain: 'Sepolia' },
    84532: { network: 'Testnet', chain: 'BaseSepolia' },
    421614: { network: 'Testnet', chain: 'ArbitrumSepolia' },
    11155420: { network: 'Testnet', chain: 'OptimismSepolia' },
}

/** Solana network id → Wormhole. Wormhole's Testnet uses Solana devnet. */
export const WORMHOLE_SOLANA_CHAINS: Record<string, WormholeChainRef> = {
    'mainnet-beta': { network: 'Mainnet', chain: 'Solana' },
    devnet: { network: 'Testnet', chain: 'Solana' },
}

/** The Wormhole chain for a bridge chain, or null when Wormhole does not serve it (e.g. Bitcoin). */
export function wormholeChainFor(chain: BridgeChain): WormholeChainRef | null {
    if (chain.kind === 'evm') return WORMHOLE_EVM_CHAINS[chain.evmChainId ?? -1] ?? null
    if (chain.kind === 'solana') return WORMHOLE_SOLANA_CHAINS[chain.networkId ?? ''] ?? null
    return null
}

/**
 * Typical seconds until Wormhole's guardians sign a message from each source
 * chain — they wait for the chain's finality. L2s inherit Ethereum's.
 */
const FINALITY_SECONDS: Record<string, number> = {
    Ethereum: 19 * 60,
    Sepolia: 19 * 60,
    Base: 19 * 60,
    BaseSepolia: 19 * 60,
    Arbitrum: 19 * 60,
    ArbitrumSepolia: 19 * 60,
    Optimism: 19 * 60,
    OptimismSepolia: 19 * 60,
    Polygon: 2 * 60,
    Bsc: 60,
    Avalanche: 5,
    Solana: 15,
}

export function wormholeFinalitySeconds(chain: string): number {
    return FINALITY_SECONDS[chain] ?? 20 * 60
}
