/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `EvmSigner` over the Avalanche wallet hierarchy (`@/js/wallets/*`).
 *
 * Wraps the exact path the token launcher and the swap used before this
 * interface existed, so C-Chain behaviour is unchanged: the same `web3`
 * singleton, the same `GasHelper` gas price, the same ethereumjs signing, and
 * the same `broadcastEvm` — which is where offline signing intercepts, and the
 * reason this implementation cannot simply be replaced by the injected one for
 * Core App users.
 *
 * Two wallet shapes live behind this class:
 *
 *   - mnemonic / private key / Ledger — sign locally, broadcast through
 *     `broadcastEvm`, and can therefore be captured for offline signing.
 *   - injected (Core App) — hand the transaction to the extension, which signs
 *     and broadcasts it. No local signature exists to capture.
 */
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { Transaction } from '@ethereumjs/tx'
import type Web3 from 'web3'

import { commonFromWeb3 } from '@/evm/common'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { estimateGasWith, toHexWei, waitForReceiptWith } from '@/evm/signer'
import type { EvmSigner, EvmTxReceipt, EvmTxRequest } from '@/evm/signer'
import { broadcastEvm } from '@/helpers/broadcastEvm'
import { getAdjustedGasPrice } from '@/avalanche-wallet-sdk/helpers/gas_helper'
import type { AvaWalletCore } from '@/js/wallets/types'
import type { PlatformTokenRegistry } from '@/platforms/types'
import { getProviderChainId } from '@/platforms/evm/wallet'
import { avalancheTokenRegistry } from './tokenRegistry'
import type { Eip1193Provider } from '@/platforms/evm/wallet'

export class AvalancheEvmSigner implements EvmSigner {
    readonly network: EvmNetwork

    private readonly wallet: AvaWalletCore

    constructor(wallet: AvaWalletCore, network: EvmNetwork) {
        this.wallet = wallet
        this.network = network
    }

    get address(): string {
        return '0x' + this.wallet.getEvmAddress()
    }

    get authSubject(): unknown {
        return this.wallet
    }

    /**
     * The app-wide C-Chain singleton, deliberately — not `web3For(network)`.
     *
     * The rest of the Avalanche flow (base fee, atomic export/import gas, the
     * assets store) is already consistent with this instance, and it is the one
     * `commonFromWeb3` below reads the chain id from when signing. Handing
     * reads to a second instance pointed at the same chain would add a second
     * source of truth for no benefit.
     */
    reader(): Web3 {
        return web3
    }

    /**
     * Avalanche's own pinned-contract allowlist — the full 24-entry list, not
     * a per-network stub. This is the whole reason the registry hangs off the
     * signer; see the interface doc.
     */
    tokenRegistry(): PlatformTokenRegistry {
        return avalancheTokenRegistry
    }

    getGasPrice(): Promise<BN> {
        return getAdjustedGasPrice()
    }

    async getNonce(): Promise<number> {
        return await web3.eth.getTransactionCount(this.address, 'pending')
    }

    estimateGas(req: EvmTxRequest, fallbackGasLimit: number): Promise<number> {
        return estimateGasWith(web3, this.address, req, fallbackGasLimit)
    }

    async send(req: EvmTxRequest): Promise<string> {
        const gasLimit = req.gasLimit ?? (await this.estimateGas(req, 6_000_000))

        if (this.wallet.type === 'injected') {
            return await this.sendViaExtension(req, gasLimit)
        }

        const gasPrice = await this.getGasPrice()
        const nonce = req.nonce ?? (await this.getNonce())
        const chainParams = await commonFromWeb3(web3)

        const tx = new Transaction(
            {
                nonce,
                gasPrice,
                gasLimit,
                // Omitting `to` entirely is what makes this a contract
                // creation — an empty string here would not.
                ...(req.to ? { to: req.to } : {}),
                value: req.value ?? new BN(0),
                data: req.data ?? '0x',
            },
            chainParams
        )

        const signed = await this.wallet.signEvm(tx)
        return await broadcastEvm(
            signed.serialize().toString('hex'),
            req.label ?? 'C-Chain transaction'
        )
    }

    waitForReceipt(txHash: string): Promise<EvmTxReceipt> {
        return waitForReceiptWith(web3, txHash)
    }

    /**
     * Only the injected wallet can drift: the extension owns which chain it is
     * on and the user can change it mid-flow. The local signing path folds the
     * chain id into the signature (see `commonFromWeb3`), so a mismatch there
     * produces a rejected transaction rather than a misdirected one.
     */
    async assertOnChain(): Promise<void> {
        if (this.wallet.type !== 'injected') return

        const provider = ((this.wallet as unknown) as { provider?: Eip1193Provider }).provider
        if (!provider) return

        const current = await getProviderChainId(provider)
        if (current === null || current === this.network.evmChainId) return

        throw new Error(
            `Your wallet is on chain ${current}, but this transaction is for ` +
                `${this.network.name} (${this.network.evmChainId}). Switch networks and try again.`
        )
    }

    /**
     * Injected wallets sign and broadcast through their own provider.
     *
     * `chain: null` tells viem not to assert a chain of its own — the guard
     * above is what establishes the extension is where it should be, and it
     * runs immediately before this rather than at page load.
     */
    private async sendViaExtension(req: EvmTxRequest, gasLimit: number): Promise<string> {
        await this.assertOnChain()

        const provider = ((this.wallet as unknown) as { provider: unknown }).provider
        const gasPrice = await this.getGasPrice()

        const { createWalletClient, custom, publicActions } = await import('viem')
        const walletClient = createWalletClient({ transport: custom(provider as any) }).extend(
            publicActions
        )

        return await walletClient.sendTransaction({
            account: this.address as `0x${string}`,
            ...(req.to ? { to: req.to as `0x${string}` } : {}),
            ...(req.data ? { data: req.data as `0x${string}` } : {}),
            value: BigInt((req.value ?? new BN(0)).toString()),
            gasPrice: BigInt(gasPrice.toString()),
            gas: BigInt(gasLimit),
            ...(req.nonce !== undefined ? { nonce: req.nonce } : {}),
            chain: null,
        } as any)
    }
}

/**
 * The C-Chain network entry matching an Avalanche chain id.
 *
 * Falls back to mainnet: the registry always carries 43114, and a signer with
 * no network at all could not enforce the chain guard or build an explorer
 * link.
 */
export function cChainNetworkFor(evmChainId: number): EvmNetwork {
    const network = getEvmNetworkByChainId(evmChainId) ?? getEvmNetworkByChainId(43114)
    if (!network) {
        throw new Error('Avalanche C-Chain is missing from the EVM network registry.')
    }
    return network
}

/** Hex wei, re-exported so callers do not reach past this module for it. */
export { toHexWei }
