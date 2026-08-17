/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Per-network web3 instances.
 *
 * The app's original `web3` (./index.ts) is a single instance pinned to the
 * Avalanche C-Chain and re-pointed via `setProvider` on every network switch.
 * That works for one-chain-at-a-time, but it cannot back a portfolio that
 * reads several chains at once, and it makes "which chain did this call go
 * to?" a question about ambient state at the moment of the call.
 *
 * This module is additive: it does NOT touch the existing singleton, so every
 * Avalanche path keeps behaving exactly as before. New multi-network code asks
 * for the instance belonging to a specific network instead.
 *
 * **Invariant — resolve the network once at the top of a flow and thread it
 * through; never re-resolve mid-flow.** A send is a chain of awaits (nonce →
 * chain id → estimate → sign → broadcast). If any step re-reads an ambient
 * "current network" that a background refresh changed underneath it, the
 * result is a transaction signed for one chain and broadcast on another — a
 * silent loss of funds rather than a visible error.
 */
import Web3 from 'web3'

import { FetchHttpProvider } from './index'
import type { EvmNetwork } from './networkRegistry'

/**
 * One instance per chain id, cached.
 *
 * Cached rather than constructed per call because a `web3.eth.Contract` binds
 * to the provider of the instance that created it, for the lifetime of that
 * contract object. Handing out a fresh Web3 each time would mean two contracts
 * for the same token could sit on different provider objects, which is exactly
 * the class of bug this module exists to remove.
 */
const instances = new Map<number, Web3>()

/**
 * The web3 instance for `network`.
 *
 * Uses `FetchHttpProvider` (not web3's default XHR provider) so these requests
 * go through the app's global rate limiter and its 429 handling, same as every
 * other request the wallet makes.
 */
export function web3For(network: EvmNetwork): Web3 {
    const existing = instances.get(network.evmChainId)
    if (existing) return existing

    const instance = new Web3(new FetchHttpProvider(network.rpcUrl) as any)
    instances.set(network.evmChainId, instance)
    return instance
}

/**
 * Re-points the cached instance for a network whose RPC URL changed (a user
 * editing a custom endpoint), keeping the same Web3 object so contracts
 * already bound to it follow the change instead of silently talking to the
 * old host.
 */
export function updateEvmProvider(network: EvmNetwork): void {
    const existing = instances.get(network.evmChainId)
    if (!existing) return
    existing.setProvider(new FetchHttpProvider(network.rpcUrl) as any)
}

/** Drops a cached instance — for a network the user removed. */
export function clearEvmProvider(chainId: number): void {
    instances.delete(chainId)
}
