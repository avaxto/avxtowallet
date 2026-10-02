/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The universal bridge layer: one interface every bridge provider implements,
 * so the wallet's bridge page, transfer history and claims never depend on any
 * one provider. Wormhole (Token Bridge for any ERC-20/native/SPL token, NTT for
 * AVXTO) and THORChain (native Bitcoin) are implementations; switching or
 * adding a provider means implementing `BridgeProvider` and registering it in
 * ./registry.ts — nothing else changes.
 *
 * Amounts are always `bigint` base units of the asset concerned. Transfers are
 * persisted (./history.ts), so everything in `BridgeTransfer` is JSON-safe:
 * amounts as decimal strings, provider data as plain values.
 */
import type { EvmSigner } from '@/evm/signer'
import type { SolanaWallet } from '@/platforms/solana/wallet'
import type { BitcoinWallet } from '@/platforms/bitcoin/wallet'

export type BridgeChainKind = 'evm' | 'solana' | 'bitcoin'

/** A chain the bridge can move value from or to. */
export interface BridgeChain {
    /** Stable id: `evm:<chainId>`, `solana:<network id>`, `bitcoin:<network id>`. */
    id: string
    kind: BridgeChainKind
    name: string
    shortName: string
    isTestnet: boolean
    native: { symbol: string; name: string; decimals: number }
    /** EVM only: numeric chain id, and the registry id the wallet switches networks by. */
    evmChainId?: number
    evmNetworkId?: string
    /** Solana / Bitcoin only: the wallet's network id. */
    networkId?: string
    /** Explorer link for a transaction on this chain, or '' when none is configured. */
    txUrl(hash: string): string
}

/** The chain's native coin, rather than a token contract. */
export const NATIVE = 'native'

/** Something to bridge: a chain's native coin, or a token on it. */
export interface BridgeAsset {
    chainId: string
    /** `NATIVE`, or the token's contract address / SPL mint. */
    address: string
    symbol: string
    decimals: number
    name?: string
}

export interface BridgeQuoteRequest {
    from: BridgeAsset
    toChain: BridgeChain
    amount: bigint
    /** Address paying on the source chain. */
    sender: string
    /** Address receiving on the destination chain. */
    recipient: string
}

export interface BridgeFee {
    label: string
    amount: bigint
    symbol: string
    decimals: number
    /**
     * Who pays and how: an extra payment on the source or destination chain,
     * or an amount deducted from what arrives (already reflected in `receive`).
     */
    paidAs: 'source' | 'destination' | 'deducted'
}

/** How what arrives relates to what was sent. */
export type ReceiveKind = 'native' | 'canonical' | 'wrapped'

export interface BridgeQuote {
    providerId: string
    /** Stable route id, e.g. `wormhole:token-bridge`, `wormhole:ntt`, `thorchain:swap`. */
    routeId: string
    routeName: string
    request: BridgeQuoteRequest
    receive: { asset: BridgeAsset; amount: bigint; kind: ReceiveKind }
    /** Lowest amount the route guarantees, when it can vary (market routes). */
    minReceive?: bigint
    fees: BridgeFee[]
    /** Typical seconds until the funds are spendable on the destination. */
    etaSeconds: number
    /** True when the user must sign a claim on the destination chain to finish. */
    needsClaim: boolean
    /** Unix ms after which the quote must not be executed. */
    expiresAt?: number
    warnings: string[]
    /** Provider-private data `execute` needs. Not persisted. */
    data: unknown
}

export type TransferStatus =
    /** Sent on the source chain; waiting for it to be picked up. */
    | 'in_transit'
    /** Delivered as far as the provider goes; the user must claim on the destination. */
    | 'ready_to_claim'
    | 'completed'
    | 'refunded'
    | 'failed'

/** A transfer the wallet started, persisted so it can be tracked and claimed later. */
export interface BridgeTransfer {
    /** `${providerId}:${sourceTxHash}`. */
    id: string
    providerId: string
    routeId: string
    routeName: string
    fromChainId: string
    toChainId: string
    fromSymbol: string
    toSymbol: string
    fromDecimals: number
    toDecimals: number
    /** Base units, as decimal strings. */
    amountIn: string
    expectedOut: string
    sender: string
    recipient: string
    sourceTxHash: string
    destTxHash?: string
    status: TransferStatus
    statusDetail?: string
    createdAt: number
    updatedAt: number
    /** Provider-private resumable state. JSON-safe. */
    data: Record<string, unknown>
}

/**
 * The wallet's signers, by chain. Each returns null when there is no wallet
 * able to sign on that chain right now (not connected, or on another network).
 */
export interface BridgeSigners {
    evm(chain: BridgeChain): EvmSigner | null
    solana(chain: BridgeChain): SolanaWallet | null
    bitcoin(chain: BridgeChain): BitcoinWallet | null
}

export type BridgeProgress = (step: string, state: 'running' | 'done') => void

export interface BridgeProvider {
    readonly id: string
    readonly name: string
    /**
     * Whether this provider can ever move `from` to `toChain` — a static check,
     * no network calls, used to decide which providers to ask for quotes.
     */
    supports(from: BridgeAsset, toChain: BridgeChain): boolean
    quote(req: BridgeQuoteRequest): Promise<BridgeQuote>
    /**
     * Sends the transfer from the source chain and returns its record. Runs
     * inside an authorization scope covering the source wallet's signatures.
     */
    execute(quote: BridgeQuote, signers: BridgeSigners, onProgress?: BridgeProgress): Promise<BridgeTransfer>
    /** Re-reads a transfer's status from the provider. */
    refresh(transfer: BridgeTransfer): Promise<BridgeTransfer>
    /** Finishes a `ready_to_claim` transfer on the destination chain. */
    claim?(transfer: BridgeTransfer, signers: BridgeSigners, onProgress?: BridgeProgress): Promise<BridgeTransfer>
}

/** A transfer record from a quote and its source transaction. */
export function newTransfer(
    quote: BridgeQuote,
    sourceTxHash: string,
    data: Record<string, unknown> = {},
    status: TransferStatus = 'in_transit'
): BridgeTransfer {
    const now = Date.now()
    return {
        id: `${quote.providerId}:${sourceTxHash}`,
        providerId: quote.providerId,
        routeId: quote.routeId,
        routeName: quote.routeName,
        fromChainId: quote.request.from.chainId,
        toChainId: quote.request.toChain.id,
        fromSymbol: quote.request.from.symbol,
        toSymbol: quote.receive.asset.symbol,
        fromDecimals: quote.request.from.decimals,
        toDecimals: quote.receive.asset.decimals,
        amountIn: quote.request.amount.toString(),
        expectedOut: quote.receive.amount.toString(),
        sender: quote.request.sender,
        recipient: quote.request.recipient,
        sourceTxHash,
        status,
        createdAt: now,
        updatedAt: now,
        data,
    }
}
