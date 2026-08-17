/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The `Common` (chain parameters) object every signed EVM transaction is built
 * against.
 *
 * This exists to give the block below exactly one definition:
 *
 *     const chainId = await web3.eth.getChainId()
 *     const networkId = await web3.eth.net.getId()
 *     Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul')
 *
 * which was copy-pasted into six places (`TxHelper` ×3, `TokenLauncher`,
 * `ArenaSwap`, `LedgerWallet`). Six copies is not just duplication — the chain
 * id here IS the EIP-155 replay protection baked into the signature, so a copy
 * that reads it from a different source than the one that signed produces a
 * transaction the network rejects, or worse, one valid on a chain the user did
 * not intend.
 *
 * Note on hardforks: `'istanbul'` is a legacy type-0 (pre-EIP-1559) envelope.
 * Every network in the registry accepts it today. `EvmNetwork.txType` records
 * the intent to support typed transactions later; it is not yet honoured here.
 */
import Common from '@ethereumjs/common'
import type Web3 from 'web3'

import type { EvmNetwork } from './networkRegistry'
import { web3For } from './providers'

export interface ChainParams {
    common: any
}

/**
 * Builds chain parameters from an explicit chain id.
 *
 * `networkId` defaults to the chain id: for a legacy transaction only
 * `chainId` is load-bearing (it is what EIP-155 folds into `v`); the network
 * id is carried for completeness and is not part of the signature.
 */
export function commonForChainId(chainId: number, networkId: number = chainId): ChainParams {
    return {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }
}

/**
 * Chain parameters read live from `web3`.
 *
 * Deliberately queries the node rather than trusting a configured value: a
 * custom or local endpoint can legitimately serve a different chain id than
 * whatever the app has on file for it, and signing against the configured
 * value in that case yields a transaction that node will refuse.
 */
export async function commonFromWeb3(instance: Web3): Promise<ChainParams> {
    const chainId = await instance.eth.getChainId()
    const networkId = await instance.eth.net.getId()
    return commonForChainId(Number(chainId), Number(networkId))
}

/** Chain parameters for a registry network, read live from that network's RPC. */
export async function commonFor(network: EvmNetwork): Promise<ChainParams> {
    return await commonFromWeb3(web3For(network))
}
