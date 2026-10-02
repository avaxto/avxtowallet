/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Every chain the bridge knows, in its own provider-neutral shape: each EVM
 * network in the wallet's registry, Solana, and Bitcoin. Which pairs actually
 * work is each provider's call (`BridgeProvider.supports`), not this list's.
 */
import { explorerTxUrl, getEvmNetworkByChainId, getEvmNetworks, type EvmNetwork } from '@/evm/networkRegistry'
import { getSolanaNetworks, getSolanaTxUrl, type SolanaNetwork } from '@/solana/networks'
import { getBitcoinNetworks, getBitcoinTxUrl, type BitcoinNetwork } from '@/bitcoin/networks'
import type { BridgeChain } from './types'

export function evmBridgeChain(n: EvmNetwork): BridgeChain {
    return {
        id: `evm:${n.evmChainId}`,
        kind: 'evm',
        name: n.name,
        shortName: n.shortName,
        isTestnet: n.isTestnet,
        native: { ...n.native },
        evmChainId: n.evmChainId,
        evmNetworkId: n.id,
        txUrl: (hash) => explorerTxUrl(n, hash),
    }
}

function solanaBridgeChain(n: SolanaNetwork): BridgeChain {
    return {
        id: `solana:${n.id}`,
        kind: 'solana',
        name: n.isTestnet ? `Solana ${n.name}` : 'Solana',
        shortName: n.isTestnet ? `SOL ${n.name}` : 'Solana',
        isTestnet: n.isTestnet,
        native: { symbol: n.native.symbol, name: n.native.name, decimals: n.native.decimals },
        networkId: n.id,
        txUrl: (hash) => getSolanaTxUrl(hash, n),
    }
}

function bitcoinBridgeChain(n: BitcoinNetwork): BridgeChain {
    return {
        id: `bitcoin:${n.id}`,
        kind: 'bitcoin',
        name: n.isTestnet ? `Bitcoin ${n.name}` : 'Bitcoin',
        shortName: n.isTestnet ? `BTC ${n.name}` : 'Bitcoin',
        isTestnet: n.isTestnet,
        native: { symbol: n.native.symbol, name: n.native.name, decimals: n.native.decimals },
        networkId: n.id,
        txUrl: (hash) => getBitcoinTxUrl(hash, n),
    }
}

/** Every chain, mainnets and testnets. Solana's "testnet" cluster is left out: no bridge serves it. */
export function listBridgeChains(): BridgeChain[] {
    return [
        ...getEvmNetworks().map(evmBridgeChain),
        ...getSolanaNetworks()
            .filter((n) => n.id !== 'testnet')
            .map(solanaBridgeChain),
        ...getBitcoinNetworks().map(bitcoinBridgeChain),
    ]
}

export function getBridgeChain(id: string): BridgeChain | undefined {
    return listBridgeChains().find((c) => c.id === id)
}

export function bridgeChainForEvmChainId(chainId: number): BridgeChain | undefined {
    const n = getEvmNetworkByChainId(chainId)
    return n ? evmBridgeChain(n) : undefined
}
