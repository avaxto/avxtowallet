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

/** One transaction involving an address, as reported by an explorer. */
export interface EvmActivityTx {
    hash: string
    blockNumber: number
    timestampMs: number
    from: string
    /** Null for a contract-creation transaction — there is no recipient. */
    to: string | null
    /** Native-asset amount moved, in wei. */
    valueWei: string
    isContractCreation: boolean
    /**
     * A human-readable label for what the call did — a decoded function name
     * when the explorer has one, or null for a plain value transfer or an
     * unrecognised selector. Never a raw `0x…` selector: showing one of those
     * as if it were a label reads as more informative than it actually is.
     */
    methodLabel: string | null
    status: 'ok' | 'failed' | 'unknown'
}

/** One page of `EvmActivityTx`, with whatever the adapter needs to fetch the next one. */
export interface ActivityPage {
    transactions: EvmActivityTx[]
    /**
     * Opaque — pass back as-is (as `cursor`) to fetch the next page. Its
     * shape is a private detail of whichever adapter produced it (Blockscout
     * hands back a param object to echo verbatim; Etherscan's classic API
     * just wants a page number) — callers must not construct or inspect one.
     * Null when there is not a next page.
     */
    nextCursor: unknown | null
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
    /**
     * Recent transactions where `address` is sender, recipient, or (for a
     * contract creation) the deployer — newest first. Omit `cursor` for the
     * first page.
     *
     * Optional: Avalanche's `glacierAdapter` deliberately does not implement
     * this — the wallet's existing Glacier-backed activity page already
     * covers Avalanche in full, with far richer detail (staking, X/P atomic
     * transfers, decoded ERC-20 transfers) than a generic explorer API can
     * offer. This exists only for the networks that path can't reach.
     */
    listTransactions?(address: string, network: EvmNetwork, cursor?: unknown): Promise<ActivityPage>
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
