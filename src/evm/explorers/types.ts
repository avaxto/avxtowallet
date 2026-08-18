/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The one interface every block-explorer family implements.
 *
 * Token discovery differs per explorer family only in how the request is
 * shaped and the response is read — "which contracts has this address ever
 * touched?" is the same question everywhere. Keeping that behind a single
 * interface means the aggregation layer never branches on family, and adding
 * a new family is a new file rather than an edit to the portfolio.
 *
 * Note what an adapter deliberately does NOT return: a balance. Explorers
 * report stale, wrongly-scaled, or outright fabricated balances (a spam token
 * can claim anything). Adapters return *candidates*; the caller reads the real
 * balance and decimals from the contract.
 */
import type { EvmNetwork } from '../networkRegistry'

/** A token an explorer says this address has interacted with. */
export interface DiscoveredToken {
    /** Lowercased contract address. */
    address: string
    /** Symbol as reported by the explorer — untrusted, used only for display and spoof checks. */
    symbol: string
    /** Name as reported by the explorer — untrusted. */
    name: string
    /**
     * Decimals as reported by the explorer. A hint only: it is verified
     * on-chain before the token is usable, because a wrong value silently
     * misplaces the decimal point on every balance and every send.
     */
    decimals?: number
    logoUri?: string
}

export interface ExplorerAdapter {
    /** Which `explorerApi.family` value this adapter serves. */
    readonly family: string
    /**
     * Contracts `address` has interacted with on `network`.
     *
     * Throws on transport/API failure — the caller isolates per network, so a
     * throw degrades one network rather than the whole portfolio.
     */
    discoverTokens(address: string, network: EvmNetwork): Promise<DiscoveredToken[]>
}

/** Thrown when a network's explorer needs an API key that has not been set. */
export class MissingApiKeyError extends Error {
    constructor(networkName: string) {
        super(`${networkName} needs an Etherscan API key to list tokens.`)
        this.name = 'MissingApiKeyError'
    }
}

/**
 * Thrown when a host is still inside its post-429 cooldown.
 *
 * Declared here with the other error types rather than in ./http, so consumers
 * that only need to *classify* a failure (the portfolio store distinguishing
 * "temporarily backed off" from "actually broken") do not have to import the
 * transport layer — and with it the rate limiter and the app config behind it.
 */
export class ExplorerThrottledError extends Error {
    constructor(url: string) {
        super(`Explorer host for ${url} is in rate-limit cooldown.`)
        this.name = 'ExplorerThrottledError'
    }
}
