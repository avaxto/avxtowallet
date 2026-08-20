/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `EvmSigner` over the unified EVM platform's wallet.
 *
 * Every send goes out through the extension's own `eth_sendTransaction`, on
 * whichever registry network the wallet is bound to — which is what makes the
 * token launcher and the swap work on Robinhood Chain, Ethereum, Base or any
 * other entry in `evm/networks.json` without either feature knowing a chain
 * exists.
 *
 * **Gas price is deliberately not set here.** This platform spans every network
 * in the registry — some legacy, some EIP-1559 — and the extension already
 * knows how to price a transaction for the chain it is connected to. Setting
 * the fields would mean re-implementing per-chain fee rules for a number the
 * extension's own confirmation screen shows the user anyway, and getting it
 * wrong on a 1559 chain means a transaction that never confirms. Same reasoning
 * (and the same decision) as `EvmWallet.sendNative`.
 *
 * `getGasPrice()` still answers honestly — it is a read of the chain's current
 * price, for display and budgeting — it is simply not plumbed into `send`.
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

import type { EvmWallet, Eip1193Provider } from './wallet'

export class InjectedEvmSigner implements EvmSigner {
    private readonly wallet: EvmWallet

    constructor(wallet: EvmWallet) {
        this.wallet = wallet
    }

    get network(): EvmNetwork {
        return this.wallet.network
    }

    get address(): string {
        return this.wallet.getPrimaryAddress()
    }

    get authSubject(): unknown {
        // `EvmWallet.type` duck-types Avalanche's wallet `.type`, which is what
        // `authorizeWalletOp` inspects — 'injected' passes (the extension
        // prompts), 'watch' correctly falls through to that gate's refusal.
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

    async send(req: EvmTxRequest): Promise<string> {
        // Immediately before signing, never at page load: the user can move the
        // extension to another chain at any moment, and `eth_sendTransaction`
        // goes wherever it currently points.
        await this.assertOnChain()

        const provider = this.requireProvider()

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

        return await provider.request({
            method: 'eth_sendTransaction',
            params: [params],
        })
    }

    waitForReceipt(txHash: string): Promise<EvmTxReceipt> {
        return waitForReceiptWith(this.reader(), txHash)
    }

    assertOnChain(): Promise<void> {
        return this.wallet.assertOnChain()
    }

    private requireProvider(): Eip1193Provider {
        const provider = this.wallet.native
        if (!provider) {
            throw new Error('This wallet is watch-only and cannot sign.')
        }
        return provider
    }
}
