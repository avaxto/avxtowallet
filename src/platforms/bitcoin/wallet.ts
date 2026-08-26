/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin wallets.
 *
 * Three concrete kinds behind one base class:
 *
 *   `HdBitcoinWallet`     A BIP-39 phrase. Full HD: gap-limit address
 *                         discovery, change addresses, many UTXOs. Key
 *                         material is encrypted in a `SessionVault`.
 *   `WifBitcoinWallet`    A single imported WIF key — exactly one address, no
 *                         derivation, and change comes back to that same
 *                         address because there is nowhere else to send it.
 *   `WatchBitcoinWallet`  An xpub (full HD scanning, no keys) or a bare
 *                         address. Can never sign.
 *
 * ## How the signing gate applies
 *
 * `js/security/authorize.ts` authorizes on either a `vault` field (prompt for
 * the session password) or a `type` in its externally-authorized set. The two
 * key-holding wallets expose `vault`; the watch-only one deliberately exposes
 * neither, so that gate refuses it — correct for a wallet holding no key.
 */
import Big from 'big.js'
import type { BIP32Interface } from 'bip32'

import type { PlatformAddress, PlatformBalance, PlatformWallet } from '../types'
import { SessionVault } from '@/js/security/SessionVault'
import { requireAuth } from '@/js/security/session'
import { wipe } from '@/js/security/memory'
import {
    ADDRESS_TYPE_INFO,
    SATS_PER_BTC,
    BTC_DECIMALS,
    type BitcoinNetwork,
    type BtcAddressType,
} from '@/bitcoin/networks'
import {
    ECPair,
    addressFromPublicKey,
    accountPath,
    bip32,
    destroyNode,
    isValidBitcoinAddress,
    detectAddressType,
} from '@/bitcoin/keys'
import {
    collectUtxos,
    scanAccount,
    type AccountScan,
} from '@/bitcoin/discovery'
import { getAddressStats, getAddressUtxos, broadcastTx } from '@/bitcoin/esplora'
import {
    DUST_THRESHOLD_SATS,
    selectCoins,
    type SelectableUtxo,
} from '@/bitcoin/coinSelect'
import { assertFeeSane, buildAndSignTx, type TxSigner } from '@/bitcoin/tx'

/** Chain label for `PlatformAddress.chain`. Bitcoin has exactly one chain. */
export const BITCOIN_CHAIN = 'BTC'

/** A pseudo-path for wallets with no derivation behind them (a single WIF key). */
const SINGLE_KEY_PATH = 'imported'

export interface SendRequest {
    to: string
    /** Amount in satoshis. Ignored when `sendMax`. */
    amountSats: number
    /** sat/vB. */
    feeRate: number
    sendMax?: boolean
}

export interface SendPreview {
    inputCount: number
    outputSats: number
    changeSats: number
    feeSats: number
    vbytes: number
    /** Effective rate the built transaction will actually pay. */
    effectiveFeeRate: number
}

export abstract class BitcoinWallet implements PlatformWallet {
    readonly platformId = 'bitcoin'
    abstract readonly accessMethodId: string
    abstract readonly isReadonly: boolean
    readonly native = null

    readonly network: BitcoinNetwork
    readonly addressType: BtcAddressType

    /** Result of the most recent chain scan. Null until `refresh()` runs. */
    protected scan: AccountScan | null = null
    protected utxos: SelectableUtxo[] = []

    protected constructor(network: BitcoinNetwork, addressType: BtcAddressType) {
        this.network = network
        this.addressType = addressType
    }

    /**
     * Network is part of the identity: the same key is a different wallet on
     * testnet, with different addresses and no shared history.
     */
    get id(): string {
        return `bitcoin:${this.network.id}:${this.addressType}:${this.getPrimaryAddress()}`
    }

    /** Duck-typed to match the `.type` field `authorizeWalletOp` reads. */
    get type(): string {
        return this.accessMethodId
    }

    /** Human label for the derivation scheme in use, e.g. "Native SegWit". */
    get addressTypeLabel(): string {
        return ADDRESS_TYPE_INFO[this.addressType].label
    }

    /** Total confirmed + unconfirmed balance, in satoshis. */
    get balanceSats(): number {
        return this.scan?.balanceSats ?? 0
    }

    /** The address to show under "Receive" — the first unused receive address. */
    abstract getReceiveAddress(): string

    abstract getPrimaryAddress(): string

    /** Re-scans the chain. Every balance and UTXO on this object comes from here. */
    abstract refresh(): Promise<void>

    getAddresses(): PlatformAddress[] {
        return [
            {
                chain: BITCOIN_CHAIN,
                address: this.getPrimaryAddress(),
                label: `${this.network.name} · ${this.addressTypeLabel}`,
            },
        ]
    }

    async getBalances(): Promise<PlatformBalance[]> {
        // The scan is the single source of truth; refresh if it has not run.
        if (!this.scan) await this.refresh()
        return [
            {
                assetId: 'native',
                symbol: this.network.native.symbol,
                name: this.network.native.name,
                decimals: BTC_DECIMALS,
                amount: Big(this.balanceSats).div(SATS_PER_BTC),
                chain: BITCOIN_CHAIN,
            },
        ]
    }

    /** Every spendable output currently known. Empty until `refresh()`. */
    getSpendableUtxos(): SelectableUtxo[] {
        return this.utxos
    }

    /**
     * Works out what a send would cost WITHOUT signing or broadcasting.
     *
     * Split from `send` deliberately: the fee depends on how many UTXOs get
     * pulled in, which the user cannot predict, so the form shows this before
     * asking for a password.
     */
    previewSend(req: SendRequest): SendPreview {
        const selection = this.selectFor(req)
        return {
            inputCount: selection.inputs.length,
            outputSats: selection.outputSats,
            changeSats: selection.changeSats,
            feeSats: selection.feeSats,
            vbytes: selection.vbytes,
            effectiveFeeRate: selection.feeSats / selection.vbytes,
        }
    }

    protected selectFor(req: SendRequest) {
        const to = req.to.trim()
        if (!isValidBitcoinAddress(to, this.network)) {
            throw new Error(`Enter a valid ${this.network.name} Bitcoin address.`)
        }
        return selectCoins({
            utxos: this.utxos,
            targetSats: req.amountSats,
            feeRate: req.feeRate,
            recipientType: detectAddressType(to, this.network) ?? 'p2wpkh',
            changeType: this.addressType,
            sendMax: req.sendMax,
        })
    }

    /** Signs and broadcasts. Returns the txid. */
    abstract send(req: SendRequest): Promise<string>

    /**
     * Shared tail of every send: build, sanity-check the fee, broadcast.
     *
     * `assertFeeSane` runs between signing and broadcast on purpose — a sizing
     * bug that overpays the fee is as unrecoverable as sending to a wrong
     * address, and this is the last moment it can still be caught.
     */
    protected async finishSend(
        req: SendRequest,
        changeAddress: string,
        signerFor: (path: string) => TxSigner
    ): Promise<string> {
        const selection = this.selectFor(req)

        const built = await buildAndSignTx({
            selection,
            toAddress: req.to.trim(),
            changeAddress,
            network: this.network,
            signerFor,
        })

        assertFeeSane(built.feeSats, selection.feeSats)

        const txid = await broadcastTx(built.hex, this.network)
        // The scan is stale the moment a transaction is accepted.
        this.scan = null
        this.utxos = []
        return txid
    }

    async signMessage(): Promise<string> {
        // Bitcoin message signing (BIP-137 / BIP-322) is a separate format per
        // address type and is not wired up — declaring it unsupported is
        // better than returning something no verifier accepts.
        throw new Error('Message signing is not supported for Bitcoin yet.')
    }
}

/** Shared HD scanning for anything with an account-level extended key. */
abstract class HdScanningWallet extends BitcoinWallet {
    /** Account-level extended PUBLIC key node. Never holds a private key. */
    protected readonly accountNode: BIP32Interface

    protected constructor(
        network: BitcoinNetwork,
        addressType: BtcAddressType,
        accountNode: BIP32Interface,
        protected readonly account: number
    ) {
        super(network, addressType)
        this.accountNode = accountNode
    }

    getPrimaryAddress(): string {
        return this.getReceiveAddress()
    }

    getReceiveAddress(): string {
        if (this.scan) return this.scan.nextReceiveAddress
        // Before the first scan, index 0 is the right answer for a fresh
        // wallet and a safe one for any wallet — it is always ours.
        const node = this.accountNode.derive(0).derive(0)
        return addressFromPublicKey(node.publicKey, this.addressType, this.network)
    }

    /** The next unused CHANGE address — where a send's remainder goes. */
    protected getChangeAddress(): string {
        const used = new Set(
            (this.scan?.addresses ?? [])
                .filter((a) => a.chain === 'change' && a.used)
                .map((a) => a.index)
        )
        let index = 0
        while (used.has(index)) index++
        const node = this.accountNode.derive(1).derive(index)
        return addressFromPublicKey(node.publicKey, this.addressType, this.network)
    }

    async refresh(): Promise<void> {
        this.scan = await scanAccount(
            this.accountNode,
            this.addressType,
            this.network,
            this.account
        )
        this.utxos = await collectUtxos(this.scan, this.network)
    }

    /** Every address this wallet controls, for a detail view. */
    getScannedAddresses() {
        return this.scan?.addresses ?? []
    }
}

/**
 * A wallet from a BIP-39 recovery phrase.
 *
 * The seed lives encrypted in a `SessionVault`; signing re-derives the needed
 * key inside one authorized scope and wipes it on the way out. The
 * account-level extended PUBLIC key is kept in the clear — it can scan for
 * funds but cannot spend, which is what lets balances refresh without a
 * password prompt.
 */
export class HdBitcoinWallet extends HdScanningWallet {
    readonly accessMethodId = 'mnemonic'
    readonly isReadonly = false
    readonly vault: SessionVault

    constructor(opts: {
        network: BitcoinNetwork
        addressType: BtcAddressType
        accountNode: BIP32Interface
        vault: SessionVault
        account?: number
    }) {
        super(opts.network, opts.addressType, opts.accountNode, opts.account ?? 0)
        this.vault = opts.vault
    }

    /**
     * Re-derives every key the transaction needs inside one authorized scope,
     * signs, and wipes.
     *
     * The whole build happens inside `withSecret` because a PSBT signs input
     * by input — pulling the keys out first and holding them across an async
     * broadcast would keep private material live far longer than the signing
     * itself needs.
     */
    async send(req: SendRequest): Promise<string> {
        const auth = requireAuth(this.vault)
        const changeAddress = this.getChangeAddress()

        return this.vault.withSecret(auth, 'seed', async (seed) => {
            const root = bip32.fromSeed(seed, this.network.params)
            const derived: BIP32Interface[] = []
            try {
                return await this.finishSend(req, changeAddress, (path) => {
                    const node = root.derivePath(path)
                    derived.push(node)
                    return node as unknown as TxSigner
                })
            } finally {
                for (const node of derived) destroyNode(node)
                destroyNode(root)
            }
        })
    }
}

/**
 * A wallet from a single imported WIF private key.
 *
 * One address, no derivation, and no change address other than itself — a
 * single key has no second address to send a remainder to, so change comes
 * straight back. That is standard for an imported key and worth knowing: it
 * means every transaction links the change to the same address publicly.
 */
export class WifBitcoinWallet extends BitcoinWallet {
    readonly accessMethodId = 'privatekey'
    readonly isReadonly = false
    readonly vault: SessionVault

    private readonly address: string

    constructor(opts: {
        network: BitcoinNetwork
        addressType: BtcAddressType
        address: string
        vault: SessionVault
    }) {
        super(opts.network, opts.addressType)
        this.address = opts.address
        this.vault = opts.vault
    }

    getPrimaryAddress(): string {
        return this.address
    }

    getReceiveAddress(): string {
        return this.address
    }

    async refresh(): Promise<void> {
        const [stats, utxos] = await Promise.all([
            getAddressStats(this.address, this.network),
            getAddressUtxos(this.address, this.network),
        ])

        const funded = stats.chain_stats.funded_txo_sum + stats.mempool_stats.funded_txo_sum
        const spent = stats.chain_stats.spent_txo_sum + stats.mempool_stats.spent_txo_sum
        const used = stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0

        this.scan = {
            type: this.addressType,
            addresses: [
                {
                    address: this.address,
                    path: SINGLE_KEY_PATH,
                    chain: 'receive',
                    index: 0,
                    type: this.addressType,
                    balanceSats: funded - spent,
                    used,
                },
            ],
            balanceSats: funded - spent,
            nextReceiveAddress: this.address,
            hasHistory: used,
        }

        this.utxos = utxos.map((u) => ({
            txid: u.txid,
            vout: u.vout,
            value: u.value,
            address: this.address,
            addressType: this.addressType,
            path: SINGLE_KEY_PATH,
            confirmed: u.status.confirmed,
        }))
    }

    async send(req: SendRequest): Promise<string> {
        const auth = requireAuth(this.vault)

        return this.vault.withSecret(auth, 'pk', async (priv) => {
            const pair = ECPair.fromPrivateKey(Buffer.from(priv), {
                network: this.network.params,
            })
            try {
                return await this.finishSend(
                    req,
                    // Change returns to the only address this wallet has.
                    this.address,
                    () => pair as unknown as TxSigner
                )
            } finally {
                // ECPair copies the key; zero the copy we can reach.
                const pk = (pair as { privateKey?: Uint8Array }).privateKey
                if (pk) wipe(pk)
            }
        })
    }
}

/**
 * Watch-only from an account xpub — full HD scanning, no signing.
 *
 * Satisfies neither branch of the signing gate (no `vault`, and `watch` is not
 * externally authorized), so every signing path refuses it by construction
 * rather than by a UI check that could be bypassed.
 */
export class WatchBitcoinWallet extends HdScanningWallet {
    readonly accessMethodId = 'watch'
    readonly isReadonly = true

    constructor(opts: {
        network: BitcoinNetwork
        addressType: BtcAddressType
        accountNode: BIP32Interface
        account?: number
    }) {
        super(opts.network, opts.addressType, opts.accountNode, opts.account ?? 0)
    }

    async send(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot send.')
    }
}

/** Watch-only from a single pasted address — no derivation, no scanning. */
export class WatchAddressBitcoinWallet extends BitcoinWallet {
    readonly accessMethodId = 'watch'
    readonly isReadonly = true

    private readonly address: string

    constructor(opts: { network: BitcoinNetwork; address: string }) {
        const type = detectAddressType(opts.address, opts.network)
        if (!type) {
            throw new Error(`That is not a valid ${opts.network.name} Bitcoin address.`)
        }
        super(opts.network, type)
        this.address = opts.address.trim()
    }

    getPrimaryAddress(): string {
        return this.address
    }

    getReceiveAddress(): string {
        return this.address
    }

    async refresh(): Promise<void> {
        const stats = await getAddressStats(this.address, this.network)
        const funded = stats.chain_stats.funded_txo_sum + stats.mempool_stats.funded_txo_sum
        const spent = stats.chain_stats.spent_txo_sum + stats.mempool_stats.spent_txo_sum

        this.scan = {
            type: this.addressType,
            addresses: [
                {
                    address: this.address,
                    path: SINGLE_KEY_PATH,
                    chain: 'receive',
                    index: 0,
                    type: this.addressType,
                    balanceSats: funded - spent,
                    used: stats.chain_stats.tx_count + stats.mempool_stats.tx_count > 0,
                },
            ],
            balanceSats: funded - spent,
            nextReceiveAddress: this.address,
            hasHistory: stats.chain_stats.tx_count > 0,
        }
        // Watch-only: never populate spendable UTXOs, so nothing can even
        // attempt to build a transaction from this wallet.
        this.utxos = []
    }

    async send(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot send.')
    }
}

export { DUST_THRESHOLD_SATS, accountPath }
