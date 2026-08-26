/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana RPC connections.
 *
 * One `Connection` per endpoint, cached. web3.js `Connection` objects are
 * cheap to hold but not free to create — each carries its own request queue and
 * (lazily) a websocket for subscriptions — so handing out a fresh one per call
 * would open a socket per balance refresh.
 *
 * Keyed on the URL rather than the cluster id so a user changing a cluster's
 * RPC override (see ./networks.ts) transparently gets a new connection instead
 * of a stale one pointed at the old endpoint.
 */
import { Connection } from '@solana/web3.js'

import type { SolanaNetwork } from './networks'

const connections = new Map<string, Connection>()

/**
 * `confirmed` rather than `finalized`: it is the commitment level wallets
 * conventionally use for balances and sends. `finalized` adds ~13 seconds of
 * latency for a guarantee that does not change what the user should do next,
 * and `processed` can report state that later gets rolled back.
 */
const COMMITMENT = 'confirmed' as const

export function connectionFor(network: SolanaNetwork): Connection {
    const existing = connections.get(network.rpcUrl)
    if (existing) return existing

    const connection = new Connection(network.rpcUrl, {
        commitment: COMMITMENT,
        // The public endpoints rate-limit hard. Letting web3.js sit in its
        // internal retry loop turns a 429 into a request that hangs for tens of
        // seconds with no way to surface progress; failing fast lets the caller
        // show a real error and suggest a custom RPC.
        disableRetryOnRateLimit: true,
    })
    connections.set(network.rpcUrl, connection)
    return connection
}

/** Drops cached connections. Used when clearing session state on logout. */
export function resetConnections(): void {
    connections.clear()
}

/**
 * Wraps an RPC call with an error message a user can act on.
 *
 * The public Solana endpoints return bare 403/429s under load, which surface
 * from web3.js as opaque `failed to get X` strings that read like the wallet
 * is broken rather than like the free endpoint being busy.
 */
export async function withRpcErrors<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn()
    } catch (e: any) {
        const message = String(e?.message ?? e)
        if (/429|rate|too many/i.test(message)) {
            throw new Error(
                `${what} failed: the RPC endpoint is rate-limiting this wallet. ` +
                    'Public Solana endpoints are heavily throttled — set a custom RPC ' +
                    'in Settings for reliable use.'
            )
        }
        if (/403|forbidden/i.test(message)) {
            throw new Error(
                `${what} failed: the RPC endpoint refused the request (403). ` +
                    'Public endpoints often block browser origins — set a custom RPC in Settings.'
            )
        }
        if (/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(message)) {
            throw new Error(`${what} failed: could not reach the Solana RPC endpoint.`)
        }
        throw new Error(`${what} failed: ${message}`)
    }
}
