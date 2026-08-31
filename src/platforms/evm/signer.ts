/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `EvmSigner` over the unified EVM platform's wallets.
 *
 * Two implementations, one per custody model, differing ONLY in how a
 * transaction is sent — every read (gas price, nonce, estimate, receipt, token
 * registry) is identical because reads are just reads, and they live on the
 * shared base below:
 *
 *   `InjectedEvmSigner`  hands the transaction to the extension, which prices,
 *                        confirms and broadcasts it.
 *   `LocalEvmSigner`     signs locally from the vaulted seed and broadcasts to
 *                        the network's own RPC. This is what makes the token
 *                        launcher and the swap work for a wallet opened from a
 *                        recovery phrase, with no extension installed at all.
 *
 * Either way the work lands on whichever registry network the wallet is bound
 * to — which is what lets those features run on Robinhood Chain, Ethereum, Base
 * or any other entry in `evm/networks.json` without either feature knowing a
 * chain exists.
 *
 * **Gas price is deliberately not set on the injected path.** That platform
 * spans every network in the registry — some legacy, some EIP-1559 — and the
 * extension already knows how to price a transaction for the chain it is
 * connected to. Setting the fields would mean re-implementing per-chain fee
 * rules for a number the extension's own confirmation screen shows the user
 * anyway, and getting it wrong on a 1559 chain means a transaction that never
 * confirms. The local path has no such helper, so it does price its own
 * transactions — see `LocalEvmWallet.signAndSend`.
 *
 * `getGasPrice()` still answers honestly on both — it is a read of the chain's
 * current price, for display and budgeting.
 */
import type Web3 from 'web3'

import { BN } from '@/avalanche'
import { gasFor } from '@/evm/gas'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'
import { estimateGasWith, toHexWei, waitForReceiptWith } from '@/evm/signer'
import { tokenRegistryFor } from '@/evm/tokenRegistry'
import type { PlatformTokenRegistry } from '@/platforms/types'
import type { EvmSigner, EvmTxReceipt, EvmTxRequest } from '@/evm/signer'

import type { EvmWallet, InjectedEvmWallet, LocalEvmWallet } from './wallet'

/** Fallback gas when the node refuses to estimate — routine for deployments. */
const DEPLOY_GAS_FALLBACK = 6_000_000

abstract class BaseEvmSigner implements EvmSigner {
    protected abstract readonly wallet: EvmWallet

    get network(): EvmNetwork {
        return this.wallet.network
    }

    get address(): string {
        return this.wallet.getPrimaryAddress()
    }

    /**
     * The wallet itself, which is what `authorizeWalletOp` inspects: a local
     * wallet exposes `vault` (prompt for the session password), an injected
     * one's `type` is 'injected' (the extension prompts), and a watch-only
     * one satisfies neither and is correctly refused.
     */
    get authSubject(): unknown {
        return this.wallet
    }

    reader(): Web3 {
        return web3For(this.network)
    }

    /**
     * The registry for this chain. Per-network by necessity — "is this the
     * native asset?" has a different answer on every chain — and currently
     * only pins the native symbol, so a token this chain has no opinion on
     * resolves unchallenged.
     */
    tokenRegistry(): PlatformTokenRegistry {
        return tokenRegistryFor(this.network)
    }

    getGasPrice(): Promise<BN> {
        return gasFor(this.network)
    }

    async getNonce(): Promise<number> {
        return await this.reader().eth.getTransactionCount(this.address, 'pending')
    }

    estimateGas(req: EvmTxRequest, fallbackGasLimit: number): Promise<number> {
        return estimateGasWith(this.reader(), this.address, req, fallbackGasLimit)
    }

    waitForReceipt(txHash: string): Promise<EvmTxReceipt> {
        return waitForReceiptWith(this.reader(), txHash)
    }

    assertOnChain(): Promise<void> {
        return this.wallet.assertOnChain()
    }

    abstract send(req: EvmTxRequest): Promise<string>
}

export class InjectedEvmSigner extends BaseEvmSigner {
    protected readonly wallet: InjectedEvmWallet

    constructor(wallet: InjectedEvmWallet) {
        super()
        this.wallet = wallet
    }

    async send(req: EvmTxRequest): Promise<string> {
        // Immediately before signing, never at page load: the user can move the
        // extension to another chain at any moment, and `eth_sendTransaction`
        // goes wherever it currently points.
        await this.assertOnChain()

        const params: Record<string, string> = {
            from: this.address,
            value: toHexWei(req.value),
        }
        // Omitted entirely for a contract creation — an empty `to` is not the
        // same thing to a node.
        if (req.to) params.to = req.to
        if (req.data) params.data = req.data
        if (req.gasLimit !== undefined) params.gas = '0x' + req.gasLimit.toString(16)
        if (req.nonce !== undefined) params.nonce = '0x' + req.nonce.toString(16)

        return await this.wallet.native.request({
            method: 'eth_sendTransaction',
            params: [params],
        })
    }
}

/**
 * Signs with the vaulted seed and broadcasts to the network's own RPC.
 *
 * The whole send — nonce, gas price, gas limit, EIP-155 signature, broadcast —
 * belongs to `LocalEvmWallet.signAndSend`, deliberately: `sendNative`,
 * `sendErc20` and this signer all go through that one method, so a transaction
 * from the send form and a transaction from the token launcher cannot end up
 * priced or chain-bound differently.
 *
 * The gas-limit fallback is the one thing this adds. A signer's transactions
 * are contract deployments and aggregator routes, which routinely refuse to
 * estimate against current state; falling back to a plain transfer's 21000
 * would guarantee an out-of-gas failure.
 */
export class LocalEvmSigner extends BaseEvmSigner {
    protected readonly wallet: LocalEvmWallet

    constructor(wallet: LocalEvmWallet) {
        super()
        this.wallet = wallet
    }

    async send(req: EvmTxRequest): Promise<string> {
        return await this.wallet.signAndSend({
            to: req.to,
            data: req.data,
            value: req.value,
            gasLimit: req.gasLimit,
            nonce: req.nonce,
            fallbackGasLimit: DEPLOY_GAS_FALLBACK,
        })
    }
}
