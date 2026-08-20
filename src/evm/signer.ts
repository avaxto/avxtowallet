/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM signing interface — one contract, several wallet stacks behind it.
 *
 * This exists because the token launcher and the swap were written against
 * `AvaWalletCore` plus the module-scope `web3` singleton in `@/evm`, which is
 * permanently pointed at the Avalanche C-Chain. Every layer of those features
 * was therefore Avalanche-only for reasons that had nothing to do with what
 * they actually do: deploying an ERC-20 and executing an aggregator route are
 * ordinary EVM operations that work identically on any chain.
 *
 * There are two wallet hierarchies in this app and they do not share a base
 * class:
 *
 *   - `@/js/wallets/*` (`AvaWalletCore`) — mnemonic / Ledger / private key /
 *     injected. Signs locally with ethereumjs and broadcasts through
 *     `broadcastEvm`, which is also where offline signing intercepts.
 *   - `@/platforms/evm/wallet` (`EvmWallet`) — injected only, hands the
 *     transaction to the extension and lets it price and confirm.
 *
 * Rather than force one onto the other, both implement this. A feature written
 * against `EvmSigner` runs on either, on whatever chain that wallet is pointed
 * at, and a third wallet stack can be added later by implementing seven
 * methods.
 *
 * **Invariant: an `EvmSigner` is bound to one network for its whole lifetime.**
 * Resolve it once at the top of a flow and thread it through. A send is a chain
 * of awaits (nonce -> estimate -> sign -> broadcast); re-resolving mid-flow
 * against an ambient "current network" that changed underneath is how a
 * transaction gets signed for one chain and broadcast on another. Same rule,
 * and the same reason, as `evm/providers.ts`.
 */
import type Web3 from 'web3'

import { BN } from '@/avalanche'

import type { PlatformTokenRegistry } from '@/platforms/types'

import type { EvmNetwork } from './networkRegistry'

/**
 * One transaction to send.
 *
 * Note what is absent: **gas price**. Callers do not set it, because the two
 * implementations price transactions in genuinely different ways — one quotes
 * the chain's RPC and signs a legacy transaction itself, the other leaves the
 * fields unset so the extension applies whatever that chain needs (including
 * EIP-1559, which the local signing path does not emit). Letting a caller pass
 * a price would mean passing a value one of them must ignore.
 */
export interface EvmTxRequest {
    /** Omit for a contract creation. */
    to?: string
    data?: string
    /** Wei. Defaults to zero. */
    value?: BN
    /** Skips estimation. Pass when a quote already carries a trustworthy figure. */
    gasLimit?: number
    /**
     * Explicit nonce, for sequencing sends that go out back-to-back.
     *
     * Letting each send ask for "the" pending nonce independently is racy: the
     * previous one may not be visible as pending yet, so both get the same
     * number and the second is rejected as "nonce too low".
     */
    nonce?: number
    /** Human description, used when offline signing captures instead of sending. */
    label?: string
}

export interface EvmTxReceipt {
    txHash: string
    /** Set only for a contract creation. */
    contractAddress: string | null
    status: boolean
}

export interface EvmSigner {
    /**
     * The chain this signer acts on. Fixed for the signer's lifetime — see the
     * invariant in the module doc.
     */
    readonly network: EvmNetwork

    /** The 0x address transactions are sent from. */
    readonly address: string

    /**
     * The underlying wallet object, to pass to `authorizeWalletOp`.
     *
     * That gate inspects `.vault` / `.type` to decide whether a password
     * prompt is required, and both wallet hierarchies expose those. Kept as
     * `unknown` so this interface does not have to name either of them.
     */
    readonly authSubject: unknown

    /**
     * A web3 bound to this signer's network, for reads.
     *
     * An escape hatch, in the same spirit as `PlatformWallet.native`: ERC-20
     * `allowance` / `symbol` / `decimals` reads need a contract object, and
     * re-declaring every one of them on this interface would be worse than
     * admitting that reads are just reads. It must not be used to send —
     * `send()` is the only path that signs, and the only one offline signing
     * and the chain guard know about.
     */
    reader(): Web3

    /**
     * The pinned-address allowlist to check tokens against on this chain.
     *
     * Comes from the signer rather than being looked up per network, because
     * the two are not the same thing: Avalanche's registry carries 24 pinned
     * contracts (AVXTO, USDC, WBTC, …) that a generic per-network registry
     * knows nothing about, and it is what stops a token claiming a well-known
     * symbol at the wrong address. Deriving it from the network alone would
     * silently downgrade that check to "is this pretending to be AVAX?" the
     * moment a feature stopped naming Avalanche explicitly.
     */
    tokenRegistry(): PlatformTokenRegistry

    /**
     * Current gas price on this chain, in wei, padded and capped.
     *
     * For display and budgeting. `send()` prices itself; this is not plumbed
     * into it.
     */
    getGasPrice(): Promise<BN>

    /** The next pending nonce for `address`. */
    getNonce(): Promise<number>

    /**
     * Estimated gas for `req`, padded by 20%, falling back to
     * `fallbackGasLimit` when the node refuses to estimate (a revert on a
     * contract creation, an unfunded probe, a node quirk).
     */
    estimateGas(req: EvmTxRequest, fallbackGasLimit: number): Promise<number>

    /**
     * Signs and broadcasts, returning the transaction hash.
     *
     * May return an offline-signing sentinel id instead of a real hash when the
     * wallet captured the transaction rather than sending it — callers that
     * need the difference should test with `isOfflineTxId`.
     */
    send(req: EvmTxRequest): Promise<string>

    /** Polls until the transaction is mined. */
    waitForReceipt(txHash: string): Promise<EvmTxReceipt>

    /**
     * Throws unless the wallet is really on `network`, immediately before a
     * signature.
     *
     * Only meaningful for wallets that sign through an extension, where the
     * user can switch chains at any moment without the app hearing about it. A
     * locally-signing wallet folds the chain id into the signature itself, so
     * there is nothing to drift.
     */
    assertOnChain(): Promise<void>
}

/** Wei as the 0x-hex string `eth_sendTransaction` expects. */
export function toHexWei(value: BN | undefined): string {
    return '0x' + (value ?? new BN(0)).toString(16)
}

/**
 * Shared gas estimation.
 *
 * Both implementations estimate the same way — against the network's own RPC,
 * from the sender's address — because estimation is a read and neither wallet
 * stack has anything to add to it.
 */
export async function estimateGasWith(
    web3: Web3,
    from: string,
    req: EvmTxRequest,
    fallbackGasLimit: number
): Promise<number> {
    try {
        const estimate = await web3.eth.estimateGas({
            from,
            ...(req.to ? { to: req.to } : {}),
            ...(req.data ? { data: req.data } : {}),
            ...(req.value && !req.value.isZero() ? { value: req.value.toString() } : {}),
        })
        return Math.round(Number(estimate) * 1.2)
    } catch {
        // A failed estimate is not a failed transaction: contract creations and
        // aggregator routes routinely refuse to estimate against current state.
        return fallbackGasLimit
    }
}

/** How long `waitForReceiptWith` polls before giving up. */
const RECEIPT_TIMEOUT_MS = 180_000
const RECEIPT_POLL_MS = 2_000

/**
 * Shared receipt polling.
 *
 * Polls the network's own RPC rather than asking the wallet, so it behaves the
 * same whether the transaction was broadcast locally or handed to an extension
 * — an extension resolves `eth_sendTransaction` on *broadcast*, not on mine,
 * so anything needing the mined result (a deployed contract's address) has to
 * wait for it here regardless.
 */
export async function waitForReceiptWith(web3: Web3, txHash: string): Promise<EvmTxReceipt> {
    const deadline = Date.now() + RECEIPT_TIMEOUT_MS

    for (;;) {
        try {
            const receipt = await web3.eth.getTransactionReceipt(txHash)
            if (receipt) {
                return {
                    txHash: (receipt.transactionHash as string) ?? txHash,
                    contractAddress: (receipt.contractAddress as string) ?? null,
                    status: receipt.status !== false,
                }
            }
        } catch {
            /* transient RPC hiccup — keep polling until the deadline */
        }

        if (Date.now() > deadline) {
            throw new Error(
                `Transaction ${txHash} was broadcast but has not been mined after ` +
                    `${Math.round(RECEIPT_TIMEOUT_MS / 1000)}s. It may still confirm — ` +
                    'check the explorer before retrying.'
            )
        }
        await new Promise((resolve) => setTimeout(resolve, RECEIPT_POLL_MS))
    }
}
