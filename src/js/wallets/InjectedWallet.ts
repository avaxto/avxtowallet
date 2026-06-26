/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * InjectedWallet - A wallet implementation that connects to injected browser providers
 * (MetaMask, Core App, etc.) using viem.
 *
 * Unlike other wallet types which hold private keys in memory, this wallet delegates
 * all signing operations to the injected provider.
 */

import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { ITransaction } from '@/components/wallet/transfer/types'
import { WalletNameType } from '@/js/wallets/types'
import HDKey from 'hdkey'
import { Avalanche as ChainKitAvalanche } from '@avalanche-sdk/chainkit'
import { isMainnetNetworkId } from '@/avalanche-wallet-sdk/Network'

import { Buffer as BufferAvalanche, BN } from '@/avalanche'
import { getPreferredHRP } from '@/avalanche/utils/helperfunctions'
import {
    KeyPair as AVMKeyPair,
    KeyChain as AVMKeyChain,
    UTXOSet as AVMUTXOSet,
    UTXO,
    UnsignedTx,
} from '@/avalanche/apis/avm'
import {
    KeyChain as PlatformKeyChain,
    UTXOSet as PlatformUTXOSet,
} from '@/avalanche/apis/platformvm'
import { KeyChain as EVMKeyChain, UTXOSet as EVMUTXOSet } from '@/avalanche/apis/evm'
import { PayloadBase } from '@/avalanche/utils'
import { AvaWalletCore } from './types'
import { UTXO as PlatformUTXO } from '@/avalanche/apis/platformvm/utxos'
import { Tx as AVMTx, UnsignedTx as AVMUnsignedTx } from '@/avalanche/apis/avm/tx'
import {
    Tx as PlatformTx,
    UnsignedTx as PlatformUnsignedTx,
} from '@/avalanche/apis/platformvm/tx'
import { Tx as EvmTx, UnsignedTx as EVMUnsignedTx } from '@/avalanche/apis/evm/tx'
import Erc20Token from '@/js/Erc20Token'
import { AbstractWallet } from '@/js/wallets/AbstractWallet'
import { WalletHelper } from '@/helpers/wallet_helper'
import { avmGetAllUTXOs, platformGetAllUTXOs } from '@/helpers/utxo_helper'
import { UTXO as AVMUTXO } from '@/avalanche/apis/avm/utxos'
import { Transaction } from '@ethereumjs/tx'
import { ExportChainsC, ExportChainsP, ExportChainsX } from '@/avalanche-wallet-sdk'
import { AvmImportChainType } from '@/js/wallets/types'
import { createAvalancheWalletClient } from '@avalanche-sdk/client'
import { activeNetwork } from '@/avalanche-wallet-sdk/Network/network'

import * as TxHelper from '@/avalanche-wallet-sdk/helpers/tx_helper'
import * as UtxoHelper from '@/avalanche-wallet-sdk/helpers/utxo_helper'
import { buildUnsignedTransaction } from '@/js/TxHelper'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { defineChain } from 'viem'

import {
    createWalletClient,
    custom,
    publicActions,
    type WalletClient,
    type PublicClient,
    type Chain,
    type Transport,
    type Account,
    hexToBytes,
    bytesToHex,
    toHex,
    type Hash,
    type TransactionSerializable,
} from 'viem'

import { avalanche } from 'viem/chains'
import { address } from 'bitcoinjs-lib'


/**
 * Represents one account entry returned by Core App's `avalanche_getAccounts` RPC method.
 */
export class CoreAppAccount {
    active: boolean
    addressC: string
    addressBTC: string
    /** Full X-chain address including prefix, e.g. "X-avax1..." */
    addressAVM: string
    /** Full P-chain address including prefix, e.g. "P-avax1..." */
    addressPVM: string
    addressCoreEth: string
    addressSVM: string
    name: string
    type: string
    id: string
    xpAddresses: string[]
    /** Base58check-encoded BIP32 extended public key for X/P-chain HD derivation. */
    xpubXP: string
    index: number
    walletType: string
    walletId: string
    walletName: string

    constructor(raw: Record<string, any>) {
        this.active = raw.active ?? false
        this.addressC = raw.addressC ?? ''
        this.addressBTC = raw.addressBTC ?? ''
        this.addressAVM = raw.addressAVM ?? ''
        this.addressPVM = raw.addressPVM ?? ''
        this.addressCoreEth = raw.addressCoreEth ?? ''
        this.addressSVM = raw.addressSVM ?? ''
        this.name = raw.name ?? ''
        this.type = raw.type ?? ''
        this.id = raw.id ?? ''
        this.xpAddresses = Array.isArray(raw.xpAddresses) ? raw.xpAddresses : []
        this.xpubXP = raw.xpubXP ?? ''
        this.index = raw.index ?? 0
        this.walletType = raw.walletType ?? ''
        this.walletId = raw.walletId ?? ''
        this.walletName = raw.walletName ?? ''
    }
}

/**
 * Get an EIP-1193 provider from the browser window object.
 * Supports MetaMask, Core App, and other injected providers.
 */
function getInjectedProvider(): any {
    const win = window as any
    // Prefer Core App provider if available
    if (win.avalanche) return win.avalanche
    // Fall back to generic ethereum provider (MetaMask, etc.)
    if (win.ethereum) return win.ethereum
    return null
}

class InjectedWallet extends AbstractWallet implements AvaWalletCore {
    type: WalletNameType = 'injected' as WalletNameType

    chainId: string
    chainIdP: string

    ethAddress: string

    avmAddress: string
    platformAddress: string

    stakeAmount: BN

    // HD derivation support — populated when the provider returns an extended public key
    private _accountKey: HDKey | null = null
    // Flat lists of derived addresses, filled by the Glacier lot-scan in getUTXOs().
    private _hdXExternal: string[] = []
    private _hdXInternal: string[] = []
    private _hdP: string[] = []
    // Resolves once the lot-scan has finished (or immediately if no HD key).
    private _hdScanPromise: Promise<void> | null = null
    // Last address index reached by each lot-scan (useful for the next incremental scan).
    private _hdXExternalLastIdx: number = 0
    private _hdXInternalLastIdx: number = 0
    private _hdPLastIdx: number = 0
    // Tracks the next HD index to hand out via getNextXAddress().
    private _nextXIdx: number | null = null

    /** Accounts fetched from Core App via avalanche_getAccounts. */
    coreAccounts: CoreAppAccount[] = []

    private walletClient: WalletClient
    private provider: any

    constructor(provider: any, evmAddress: string) {
        super()

        this.provider = provider
        // Store the EVM address without '0x' prefix (matching other wallet types)
        this.ethAddress = evmAddress.toLowerCase().replace('0x', '')

        this.avmAddress = ''
        this.platformAddress = ''

        this.chainId = avm.getBlockchainAlias() || avm.getBlockchainID()
        this.chainIdP = pChain.getBlockchainAlias() || pChain.getBlockchainID()

        this.stakeAmount = new BN(0)

        // Create viem wallet client from the injected provider
        this.walletClient = createWalletClient({
            chain: avalanche,
            transport: custom(provider),
        }).extend(publicActions)

        this.isInit = true
    }

    /**
     * Static factory: requests accounts from the injected provider and creates the wallet.
     */
    static async connect(): Promise<InjectedWallet> {
        const provider = getInjectedProvider()
        if (!provider) {
            throw new Error(
                'No wallet provider found. Please install MetaMask or Core App extension.'
            )
        }

        // Request accounts via EIP-1102
        const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
        if (!accounts || accounts.length === 0) {
            throw new Error('No accounts returned from the injected wallet.')
        }

        const wallet = new InjectedWallet(provider, accounts[0])
        await wallet._applyAccountInfo()
        return wallet
    }

    /**
     * Faster reconnect: create a wallet from an already-known EVM address.
     * Skips `eth_requestAccounts` (expensive / may show popup) since the caller
     * already obtained the address from an `accountsChanged` event.
     */
    static async connectWithAddress(address: string): Promise<InjectedWallet> {
        const provider = getInjectedProvider()
        if (!provider) {
            throw new Error(
                'No wallet provider found. Please install MetaMask or Core App extension.'
            )
        }

        const wallet = new InjectedWallet(provider, address)
        await wallet._applyAccountInfo()
        return wallet
    }

    /**
     * Call Core App's `avalanche_getAccounts` RPC, populate `this.coreAccounts`,
     * and return the parsed array.
     */
    async avalancheGetAccounts(): Promise<CoreAppAccount[]> {
        const raw: Record<string, any>[] = await this.provider.request({
            method: 'avalanche_getAccounts',
            params: [],
        })
        this.coreAccounts = raw.map((a) => new CoreAppAccount(a))
        return this.coreAccounts
    }

    /**
     * Fetch account info from the provider and apply addresses / HD key.
     * Tries `avalanche_getAccounts` first (gives full xpubXP);
     * falls back to `avalanche_getAccountPubKey`.
     */
    private async _applyAccountInfo(): Promise<void> {
        // --- Primary: avalanche_getAccounts (Core App) ---
        try {
            const accounts = await this.avalancheGetAccounts()
            // Match the active account to the connected EVM address.
            const evmAddrLower = ('0x' + this.ethAddress).toLowerCase()
            const match = accounts.find(
                (a) => a.active || a.addressC.toLowerCase() === evmAddrLower
            ) ?? accounts[0]

            if (match?.xpubXP) {
                this._applyXpKey(match.xpubXP)
                return
            }
        } catch {
            // Extension does not expose avalanche_getAccounts — try legacy method.
        }

        // --- Fallback: avalanche_getAccountPubKey ---
        try {
            const pubKeys: { xp?: string; evm?: string } = await this.provider.request({
                method: 'avalanche_getAccountPubKey',
                params: {},
            })
            if (pubKeys?.xp) {
                this._applyXpKey(pubKeys.xp)
            }
        } catch (err) {
            console.warn('InjectedWallet: could not obtain X/P chain key from provider.', err)
        }
    }

    /**
     * Parse the xp key returned by avalanche_getAccountPubKey.
     *
     * Core App may return one of:
     *   a) A 33-byte compressed secp256k1 public key in hex (66 chars)  — single address
     *   b) A 78-byte BIP32 extended public key in hex (156 chars)        — HD derivation
     *   c) A base58check-encoded extended public key (starts with xpub…) — HD derivation
     *
     * For cases (b) and (c) we initialise HdHelper instances that scan all derived
     * addresses using a gap limit of 20, matching Core App's BIP44 derivation.
     */
    private _applyXpKey(xp: string): void {
        const hrp = getPreferredHRP(ava.getNetworkID())
        const xpStripped = xp.replace(/^0x/, '')

        console.log('[InjectedWallet] xp raw:', xp)
        console.log('[InjectedWallet] xp stripped len:', xpStripped.length, 'value:', xpStripped.slice(0, 80))

        // --- Try to parse as extended public key (xpub) ---
        let accountKey: HDKey | null = null

        if (/^[0-9a-fA-F]{156}$/.test(xpStripped)) {
            // 78-byte BIP32 serialisation encoded as plain hex.
            // Layout: 4 version | 1 depth | 4 fingerprint | 4 index | 32 chaincode | 33 pubkey
            const xpBuf = BufferAvalanche.from(xpStripped, 'hex')
            const hdKey = new HDKey()
            // @ts-ignore — HDKey exposes these as writeable internals
            hdKey.publicKey = xpBuf.slice(45, 78)
            // @ts-ignore
            hdKey.chainCode = xpBuf.slice(13, 45)
            accountKey = hdKey
        } else if (/^[0-9a-fA-F]{66}$/.test(xpStripped)) {
            // Plain 33-byte compressed public key — no HD derivation possible.
            console.log('[InjectedWallet] xp is 33-byte compressed pubkey — single address only, no HD scan')
            const addrBuf = AVMKeyPair.addressFromPublicKey(BufferAvalanche.from(xpStripped, 'hex'))
            this.avmAddress      = bintools.addressToString(hrp, 'X', addrBuf)
            this.platformAddress = bintools.addressToString(hrp, 'P', addrBuf)
            return
        } else {
            // Assume base58check-encoded xpub.
            try {
                accountKey = (HDKey as any).fromExtendedKey(xpStripped) as HDKey
            } catch (e) {
                console.warn('InjectedWallet: unable to parse xp key', e)
                return
            }
        }

        // --- We have an account-level extended public key ---
        this._accountKey = accountKey

        // Derive the first external address (m/0/0 from account key) as the primary address.
        const firstExternalNode = accountKey.derive('m/0/0')
        const addrBuf = AVMKeyPair.addressFromPublicKey(
            BufferAvalanche.from(firstExternalNode.publicKey!.toString('hex'), 'hex')
        )
        this.avmAddress      = bintools.addressToString(hrp, 'X', addrBuf)
        this.platformAddress = bintools.addressToString(hrp, 'P', addrBuf)

        // Kick off the Glacier lot-scan (async, awaited in getUTXOs).
        this._startHdScan()
    }

    async getAddressForIndex(index: number, change: boolean = false, chain: 'X' | 'P' = 'X'): Promise<string> {
        if (!this._accountKey) {
            throw new Error('No account key available for HD derivation.')
        }
        const changeIdx = change ? 1 : 0
        const node = this._accountKey.derive(`m/${changeIdx}/${index}`)
        const addrBuf = AVMKeyPair.addressFromPublicKey(
            BufferAvalanche.from(node.publicKey!.toString('hex'), 'hex')
        )
        const hrp = getPreferredHRP(ava.getNetworkID())
        return bintools.addressToString(hrp, chain, addrBuf)
    }

    /**
     * Returns the next fresh external X-chain address beyond all previously scanned UTXOs.
     * Waits for any in-progress HD scan to finish before deriving.
     * Each call advances the internal counter by 1.
     */
    async getNextXAddress(): Promise<string> {
        if (this._hdScanPromise) await this._hdScanPromise
        if (this._nextXIdx === null) {
            this._nextXIdx = this._hdXExternal.length
        } else {
            this._nextXIdx++
        }
        return this.getAddressForIndex(this._nextXIdx)
    }

    /**
     * Scan one change-index (0=external, 1=internal) of the X-chain or P-chain
     * by querying Glacier in lots of LOT_SIZE addresses.
     * Stops after MAX_EMPTY_LOTS consecutive lots with zero UTXOs.
     * Returns the flat list of all addresses that belonged to non-empty lots.
     */
    private async _scanHdLot(changeIdx: 0 | 1, chainId: 'X' | 'P'): Promise<{ addresses: string[]; lastIdx: number }> {
        const LOT_SIZE = 200
        const MAX_EMPTY_LOTS = 1

        const netID = ava.getNetworkID()
        const hrp = getPreferredHRP(netID)
        const network = isMainnetNetworkId(netID) ? 'mainnet' : 'fuji'
        const blockchainId = chainId === 'X' ? 'x-chain' : 'p-chain'
        const sdk = new ChainKitAvalanche({ network, enableTelemetry: false })

        const active: string[] = []
        let emptyLots = 0
        let addrIdx = 0

        while (emptyLots < MAX_EMPTY_LOTS) {
            
            const lotAddrs: string[] = []
            for (let i = 0; i < LOT_SIZE; i++) {
                const addr = await this.getAddressForIndex(addrIdx + i, changeIdx === 1, chainId)
                lotAddrs.push(addr)
            }

            
            let hasUtxos = false
            try {
                const pageIter = await sdk.data.primaryNetwork.utxos.listByAddressesV2({
                    pageSize: 1,
                    blockchainId,
                    primaryNetworkAddressesBodyDto: {
                        addresses: lotAddrs.join(','),
                    },
                })
                for await (const page of pageIter) {
                    hasUtxos = page.result.utxos.length > 0
                    break // first page is enough for the presence check
                }
                console.log(`[InjectedWallet] scan ${chainId} change=${changeIdx} idx=${addrIdx}-${addrIdx + LOT_SIZE - 1} hasUTXOs=${hasUtxos}`)
            } catch {
                console.error('Glacier API error during HD scan. Aborting further scans to avoid rate limits.')
                break
            }

            if (hasUtxos) {
                active.push(...lotAddrs)
                emptyLots = 0
            } else {
                emptyLots++
            }

            addrIdx += LOT_SIZE
        }

        return { addresses: active, lastIdx: addrIdx }
    }

    /**
     * Kick off the Glacier lot-scan for all three derivation paths.
     * Stores the promise in _hdScanPromise so getUTXOs() can await it.
     */
    private _startHdScan(): void {
        this._hdXExternal = []
        this._hdXInternal = []
        this._hdP = []
        this._hdXExternalLastIdx = 0
        this._hdXInternalLastIdx = 0
        this._hdPLastIdx = 0

        this._hdScanPromise = Promise.all([
            this._scanHdLot(0, 'X'),
            this._scanHdLot(1, 'X'),
            this._scanHdLot(0, 'P'),
        ]).then(([xExt, xInt, p]) => {
            this._hdXExternal = xExt.addresses
            this._hdXInternal = xInt.addresses
            this._hdP = p.addresses
            this._hdXExternalLastIdx = xExt.lastIdx
            this._hdXInternalLastIdx = xInt.lastIdx
            this._hdPLastIdx = p.lastIdx
        }).catch((e) => console.warn('HD lot scan error', e))
    }

    // ---- Address methods ----

    getCurrentAddressAvm(): string {
        // Use the last discovered external address as the current receive address,
        // falling back to the base address when no scan has run yet.
        return this._hdXExternal.at(-1) ?? this.avmAddress
    }

    /**
     * Returns Core App's active account X-chain address — the address that
     * avalanche_signTransaction signs as.  This is the canonical address to use
     * for X-chain export destinations and import outputs so that the UTXO owner
     * always matches the signer.
     *
     * Core App's current address comes from avalanche_getAccounts (addressAVM field)
     * and may be at a higher HD index than m/0/0 (avmAddress).  Using avmAddress
     * as the export destination causes "nothing to sign" because the UTXO owner
     * (avmAddress = index 0) doesn't match Core App's current signer address.
     */
    private getActiveXChainAddress(): string {
        const active = this.coreAccounts.find((a) => a.active) ?? this.coreAccounts[0]
        return active?.addressAVM || this.avmAddress
    }

    getChangeAddressAvm(): string {
        return this._hdXInternal.at(-1) ?? this.avmAddress
    }

    getCurrentAddressPlatform(): string {
        return this._hdP.at(-1) ?? this.platformAddress
    }

    getAllExternalAddressesX(): string[] {
        return this._hdXExternal.length > 0 ? this._hdXExternal
            : this.avmAddress ? [this.avmAddress] : []
    }

    getAllChangeAddressesX(): string[] {
        return this._hdXInternal.length > 0 ? this._hdXInternal
            : this.avmAddress ? [this.avmAddress] : []
    }

    getDerivedAddresses(): string[] {
        const hdCombined = [...this._hdXExternal, ...this._hdXInternal]
        const coreX = this.coreAccounts.map((a) => a.addressAVM).filter(Boolean)
        const all = [...new Set([...hdCombined, ...coreX])]
        return all.length > 0 ? all : this.avmAddress ? [this.avmAddress] : []
    }

    getDerivedAddressesP(): string[] {
        const coreP = this.coreAccounts.map((a) => a.addressPVM).filter(Boolean)
        const all = [...new Set([...this._hdP, ...coreP])]
        return all.length > 0 ? all : this.platformAddress ? [this.platformAddress] : []
    }

    getAllDerivedExternalAddresses(): string[] {
        return this._hdXExternal.length > 0 ? this._hdXExternal
            : this.avmAddress ? [this.avmAddress] : []
    }

    getHistoryAddresses(): string[] {
        return ['0x' + this.ethAddress]
    }

    getBaseAddress(): string {
        return '0x' + this.ethAddress
    }

    getPlatformUTXOSet(): PlatformUTXOSet {
        return this.platformUtxoset
    }

    getEvmAddress(): string {
        return this.ethAddress
    }

    getEvmAddressBech(): string {
        const addrBuf = BufferAvalanche.from(this.ethAddress, 'hex')
        return bintools.addressToString(ava.getHRP(), 'C', addrBuf)
    }

    /**
     * Returns the active Core account's "Core-Eth" atomic address — the bech32
     * "C-..." form whose 20 bytes are `ripemd160(sha256(compressed_EVM_pubkey))`.
     *
     * This is a THIRD derivation distinct from both the standard EVM address
     * (keccak256 of the uncompressed EVM pubkey, what `getEvmAddressBech()`
     * encodes) and the XP-style atomic address (ripemd160 of the *X-chain*
     * compressed pubkey, what `addressAVM` / `addressPVM` carry).
     *
     * Core App's `avalanche_sendTransaction` for chainAlias='C' matches UTXO
     * owner bytes against EXACTLY this derivation when picking a signing key —
     * neither of the other two forms works.  Verified empirically against the
     * `avalanche_getAccounts` response (the `addressCoreEth` field on each
     * Core account) and the share of bytes with `addressBTC`.
     *
     * Returns '' when no Core account is loaded (e.g. providers that don't
     * expose `avalanche_getAccounts`).  Callers should handle that explicitly.
     */
    getActiveCChainAtomicAddress(): string {
        const active = this.coreAccounts.find((a) => a.active) ?? this.coreAccounts[0]
        return active?.addressCoreEth || ''
    }

    getAllAddressesX(): string[] {
        const hdCombined = [...this._hdXExternal, ...this._hdXInternal]
        const coreX = this.coreAccounts.map((a) => a.addressAVM).filter(Boolean)
        const all = [...new Set([...hdCombined, ...coreX])]
        return all.length > 0 ? all : this.avmAddress ? [this.avmAddress] : []
    }

    getAllAddressesP(): string[] {
        const coreP = this.coreAccounts.map((a) => a.addressPVM).filter(Boolean)
        const all = [...new Set([...this._hdP, ...coreP])]
        return all.length > 0 ? all : this.platformAddress ? [this.platformAddress] : []
    }

    // ---- UTXO management ----
    // Injected wallets are primarily EVM; X/P UTXO sets remain empty (check this)

    async getUTXOs(): Promise<void> {
        this.isFetchingUtxos = true
        try {
            await this.getEthBalance()

            // Only start a new HD scan if one is not already running.
            // On startup _applyXpKey already kicked off _startHdScan(); we just
            // await that promise instead of cancelling and restarting it.
            // On subsequent calls (polling after transactions) _hdScanPromise is
            // null (cleared below after the scan resolves), so a fresh scan starts.
            if (!this._hdScanPromise && this._accountKey) {
                this._startHdScan()
            }

            if (this._hdScanPromise) {
                // HD mode: wait for the Glacier lot-scan to finish discovering all
                // addresses that have (or had) UTXOs, then fetch the actual UTXO
                // objects from the node for each address.
                await this._hdScanPromise
                // Clear so the next getUTXOs() call (after a tx) triggers a fresh scan.
                this._hdScanPromise = null

                // Merge HD-scanned addresses with Core App account addresses (deduplicated).
                const xSet = new Set([...this._hdXExternal, ...this._hdXInternal])
                const pSet = new Set([...this._hdP])

                if (xSet.size > 0) {
                    this.utxoset = await avmGetAllUTXOs([...xSet])
                }
                if (pSet.size > 0) {
                    this.platformUtxoset = await platformGetAllUTXOs([...pSet])
                }
            } else {
                // Single-address fallback — still include all Core App account addresses.
                const xAddrs = new Set([
                    ...(this.avmAddress ? [this.avmAddress] : []),
                    
                ])
                const pAddrs = new Set([
                    ...(this.platformAddress ? [this.platformAddress] : []),
                    
                ])

                if (xAddrs.size > 0) {
                    this.utxoset = await avmGetAllUTXOs([...xAddrs])
                }
                if (pAddrs.size > 0) {
                    this.platformUtxoset = await platformGetAllUTXOs([...pAddrs])
                }
            }
        } finally {
            this.isFetchingUtxos = false
        }
    }

    /**
     * Refresh X-chain UTXOs. Called by the polling manager to keep the X-chain
     * balance up to date without a full getUTXOs() cycle.
     */
    async updateUTXOsX(): Promise<AVMUTXOSet> {
        const addrs = this.getAllAddressesX()
        if (addrs.length > 0) {
            this.utxoset = await avmGetAllUTXOs(addrs)
        }
        return this.utxoset
    }

    // ---- Transaction building ----

    async buildUnsignedTransaction(
        orders: (ITransaction | UTXO)[],
        addr: string,
        memo?: BufferAvalanche
    ) {
        const changeAddress = this.getChangeAddressAvm()
        const derivedAddresses: string[] = this.getDerivedAddresses()
        const utxoset = this.getUTXOSet()
        return buildUnsignedTransaction(orders, addr, derivedAddresses, utxoset, changeAddress, memo)
    }

    async issueBatchTx(
        orders: (ITransaction | AVMUTXO)[],
        addr: string,
        memo: BufferAvalanche | undefined
    ): Promise<string> {
        const unsignedTx = await this.buildUnsignedTransaction(orders, addr, memo)

        // Populate SigIdx sources (required before calling getSigIdxs)
        unsignedTx.toBuffer()

        // Build address → HD index maps using actual derivation indices.
        // _hdXExternal[i] is the address generated at getAddressForIndex(i, false),
        // so for the common case (lot 0 scanned first) array position equals HD index.
        const externalAddrToIdx = new Map<string, number>()
        const internalAddrToIdx = new Map<string, number>()
        this._hdXExternal.forEach((a, i) => externalAddrToIdx.set(a, i))
        this._hdXInternal.forEach((a, i) => internalAddrToIdx.set(a, i))

        const hrp = getPreferredHRP(ava.getNetworkID())
        const externalIndicesSet = new Set<number>()
        const internalIndicesSet = new Set<number>()

        for (const input of unsignedTx.getTransaction().getIns()) {
            for (const sigIdx of (input.getInput() as any).getSigIdxs()) {
                const addrStr = bintools.addressToString(hrp, 'X', sigIdx.getSource())
                if (externalAddrToIdx.has(addrStr)) {
                    externalIndicesSet.add(externalAddrToIdx.get(addrStr)!)
                } else if (internalAddrToIdx.has(addrStr)) {
                    internalIndicesSet.add(internalAddrToIdx.get(addrStr)!)
                }
            }
        }

        // If no HD indices found (scan not done yet, or coreAccount primary address),
        // default to external[0] — the primary derived address.
        if (externalIndicesSet.size === 0 && internalIndicesSet.size === 0) {
            externalIndicesSet.add(0)
        }

        // avalanche_sendTransaction signs AND submits in one step.
        // Passing explicit externalIndices/internalIndices is required by Core App
        // for ALL transactions (single- and multi-address) so it knows which HD keys to use,
        // without relying on its own UTXO cache lookup.
        const txHex = Buffer.from(unsignedTx.toBuffer()).toString('hex')
        const txId = await this.provider.request({
            method: 'avalanche_sendTransaction',
            params: {
                transactionHex: txHex,
                chainAlias: 'X',
                externalIndices: Array.from(externalIndicesSet).sort((a, b) => a - b),
                internalIndices: Array.from(internalIndicesSet).sort((a, b) => a - b),
            },
        })
        return typeof txId === 'string' ? txId : (txId as any).txHash ?? (txId as any).txID
    }

    // ---- Network change ----

    onnetworkchange(): void {
        this.chainId = avm.getBlockchainAlias() || avm.getBlockchainID()
        this.chainIdP = pChain.getBlockchainAlias() || pChain.getBlockchainID()
        this.utxoset = new AVMUTXOSet()
        this.platformUtxoset = new PlatformUTXOSet()
        this.ethBalance = new BN(0)

        // Re-run the Glacier lot-scan on the new network.
        if (this._accountKey) {
            this._hdScanPromise = null
            this._startHdScan()
        }

        this.getUTXOs()
    }

    // ---- Signing ----
    // X/P chain signing is not supported. EVM signing delegates to the injected provider.

    /**
     * Sign an X-chain transaction via the Core App provider (avalanche_signTransaction).
     * Only Core App (window.avalanche) supports this; MetaMask will reject.
     */
    async signX(unsignedTx: AVMUnsignedTx): Promise<AVMTx> {
        const txHex = Buffer.from(unsignedTx.toBuffer()).toString('hex')
        // Core App may return a plain hex string or { signedTransactionHex: '...' }
        const raw = await this.provider.request({
            method: 'avalanche_signTransaction',
            params: { transactionHex: txHex, chainAlias: 'X' },
        })
        const signedHex: string = typeof raw === 'string' ? raw : raw.signedTransactionHex
        const tx = new AVMTx()
        tx.fromBuffer(Buffer.from(signedHex.replace(/^0x/, ''), 'hex') as any)
        return tx
    }

    /**
     * Sign a P-chain transaction via the Core App provider (avalanche_signTransaction).
     */
    async signP(unsignedTx: PlatformUnsignedTx): Promise<PlatformTx> {
        const txHex = Buffer.from(unsignedTx.toBuffer()).toString('hex')
        const raw = await this.provider.request({
            method: 'avalanche_signTransaction',
            params: { transactionHex: txHex, chainAlias: 'P' },
        })
        const signedHex: string = typeof raw === 'string' ? raw : raw.signedTransactionHex
        const tx = new PlatformTx()
        tx.fromBuffer(Buffer.from(signedHex.replace(/^0x/, ''), 'hex') as any)
        return tx
    }

    /**
     * Sign a C-chain atomic transaction via the Core App provider (avalanche_signTransaction).
     */
    async signC(unsignedTx: EVMUnsignedTx): Promise<EvmTx> {
        const txHex = Buffer.from(unsignedTx.toBuffer()).toString('hex')
        const raw = await this.provider.request({
            method: 'avalanche_signTransaction',
            params: { transactionHex: txHex, chainAlias: 'C' },
        })
        const signedHex: string = typeof raw === 'string' ? raw : raw.signedTransactionHex
        const tx = new EvmTx()
        tx.fromBuffer(Buffer.from(signedHex.replace(/^0x/, ''), 'hex') as any)
        return tx
    }

    /**
     * Sign an EVM transaction using the injected provider via viem.
     * The Transaction from @ethereumjs/tx is converted to a viem-compatible request,
     * sent to the provider for signing, and the signed raw tx is returned.
     */
    async signEvm(tx: Transaction): Promise<Transaction> {
        const txData = tx.toJSON()
        const fromAddr = '0x' + this.ethAddress

        // Use the injected provider to sign and send in one step,
        // but since the system expects a signed Transaction object back,
        // we use eth_signTransaction via the provider.
        const rawTxParams: any = {
            from: fromAddr,
            to: txData.to || undefined,
            value: txData.value ? toHex(BigInt(txData.value as string)) : '0x0',
            gas: txData.gasLimit ? toHex(BigInt(txData.gasLimit as string)) : undefined,
            gasPrice: txData.gasPrice ? toHex(BigInt(txData.gasPrice as string)) : undefined,
            nonce: txData.nonce ? toHex(BigInt(txData.nonce as string)) : undefined,
            data: txData.data || '0x',
        }

        // Clean up undefined values
        Object.keys(rawTxParams).forEach((key) => {
            if (rawTxParams[key] === undefined) delete rawTxParams[key]
        })

        // Most injected providers don't support eth_signTransaction.
        // Instead, we'll use eth_sendTransaction and return a mock signed tx.
        // The caller (WalletHelper) will then skip the web3.eth.sendSignedTransaction step.
        // We handle this by overriding sendEth/sendERC20/sendErc721 below.
        throw new Error(
            'Direct signEvm is not supported for injected wallets. Use sendEth/sendERC20 instead.'
        )
    }

    async signMessage(msgStr: string): Promise<string> {
        const fromAddr = ('0x' + this.ethAddress) as `0x${string}`
        const signature = await this.walletClient.signMessage({
            account: fromAddr,
            message: msgStr,
        })
        return signature
    }

    // ---- NFTs (not supported for injected wallets, EVM-only) ----

    async createNftFamily(name: string, symbol: string, groupNum: number): Promise<string> {
        throw new Error('NFT creation on X-chain is not supported with injected wallets.')
    }

    async mintNft(mintUtxo: AVMUTXO, payload: PayloadBase, quantity: number): Promise<string> {
        throw new Error('NFT minting on X-chain is not supported with injected wallets.')
    }

    // ---- EVM Transfers (via injected provider using viem) ----

    /**
     * Send native AVAX on the C-chain using the injected provider.
     */
    async sendEth(
        to: string,
        amount: BN, // in wei
        gasPrice: BN,
        gasLimit: number
    ): Promise<string> {
        const fromAddr = ('0x' + this.ethAddress) as `0x${string}`
        const toAddr = to as `0x${string}`

        const hash = await this.walletClient.sendTransaction({
            account: fromAddr,
            to: toAddr,
            value: BigInt(amount.toString()),
            gasPrice: BigInt(gasPrice.toString()),
            gas: BigInt(gasLimit),
            chain: null, // let the provider determine the chain
        } as any)

        return hash
    }

    /**
     * Send ERC20 tokens on the C-chain using the injected provider.
     */
    async sendERC20(
        to: string,
        amount: BN,
        gasPrice: BN,
        gasLimit: number,
        token: Erc20Token
    ): Promise<string> {
        const fromAddr = ('0x' + this.ethAddress) as `0x${string}`
        const tokenAddr = token.data.address as `0x${string}`
        const toAddr = to as `0x${string}`

        // ERC20 transfer function signature: transfer(address,uint256)
        const transferFnSelector = '0xa9059cbb'
        // Encode "to" address (pad to 32 bytes)
        const encodedTo = toAddr.replace('0x', '').padStart(64, '0')
        // Encode amount (pad to 32 bytes)
        const encodedAmount = BigInt(amount.toString()).toString(16).padStart(64, '0')
        const data = (transferFnSelector + encodedTo + encodedAmount) as `0x${string}`

        const hash = await this.walletClient.sendTransaction({
            account: fromAddr,
            to: tokenAddr,
            data: data,
            gasPrice: BigInt(gasPrice.toString()),
            gas: BigInt(gasLimit),
            chain: null,
        } as any)

        return hash
    }

    /**
     * Estimate gas for an ERC20 transfer.
     */
    async estimateGas(to: string, amount: BN, token: Erc20Token): Promise<number> {
        const fromAddr = ('0x' + this.ethAddress) as `0x${string}`
        const tokenAddr = token.data.address as `0x${string}`
        const toAddr = to as `0x${string}`

        const transferFnSelector = '0xa9059cbb'
        const encodedTo = toAddr.replace('0x', '').padStart(64, '0')
        const encodedAmount = BigInt(amount.toString()).toString(16).padStart(64, '0')
        const data = (transferFnSelector + encodedTo + encodedAmount) as `0x${string}`

        const client = this.walletClient as any // has publicActions extended
        const estimate = await client.estimateGas({
            account: fromAddr,
            to: tokenAddr,
            data: data,
        })

        return Math.round(Number(estimate) * 1.1)
    }

    // ---- Cross-chain operations ----

    /**
     * Override exportFromXChain for InjectedWallet.
     *
     * Destinations:
     * - X→P: active P-chain primary address (Core's `addressPVM`).
     * - X→C: `getActiveCChainAtomicAddress()` (= the account's `addressCoreEth`).
     *   Core App's atomic-C signer-lookup uses ripemd160(sha256(compressed EVM
     *   pubkey)) — verified empirically via the `avalanche_getAccounts`
     *   response and a successful import round-trip.
     *
     * Inputs:
     *   `fromAddresses` is restricted to Core-signable X-chain primaries
     *   (each Core account's `addressAVM`).  Including HD-derived X addresses
     *   lets the SDK pick UTXOs at signing-keys Core App can't reach,
     *   producing "This account has nothing to sign".  Stranded HD-derived X
     *   UTXOs are recoverable only via mnemonic.
     *
     *   `changeAddress` is pinned to the active account's `addressAVM` so
     *   change doesn't land at an HD-derived index.
     */
    async exportFromXChain(amt: BN, destinationChain: ExportChainsX, importFee?: BN): Promise<string> {
        if (destinationChain === 'C' && !importFee)
            throw new Error('Exports to C chain must specify an import fee.')

        let amtFee = amt.clone()

        const destinationAddr =
            destinationChain === 'P'
                ? this.platformAddress
                : this.getActiveCChainAtomicAddress()

        if (importFee) {
            amtFee = amt.add(importFee)
        } else if (destinationChain === 'P') {
            amtFee = amt.add(pChain.getTxFee())
        }

        // Restrict input/change to Core-signable X-chain primaries.
        const coreSignableX = this.coreAccounts.map((a) => a.addressAVM).filter(Boolean)
        const fromAddresses = coreSignableX.length > 0
            ? coreSignableX
            : (this.avmAddress ? [this.avmAddress] : [])

        if (fromAddresses.length === 0) {
            throw new Error(
                'No Core-signable X-chain addresses available. Connect a Core extension ' +
                'account that exposes avalanche_getAccounts, or import your seed phrase ' +
                'via Wallet Wizard.'
            )
        }

        const active = this.coreAccounts.find((a) => a.active) ?? this.coreAccounts[0]
        const changeAddress = active?.addressAVM || fromAddresses[0]
        const utxos = this.getUTXOSet()
        const exportTx = await TxHelper.buildAvmExportTransaction(
            destinationChain,
            utxos,
            fromAddresses,
            destinationAddr,
            amtFee,
            changeAddress
        )

        const tx = await this.signX(exportTx)
        return this.issueX(tx)
    }

    /**
     * Override evmGetAtomicUTXOs to fetch C-chain atomic UTXOs at every address
     * Core App might have written to — both the canonical XP-style form (now used)
     * and the EVM-bytes form (legacy / pre-fix exports that are now stranded).
     * importToCChain inspects both so it can surface a clear recovery error for
     * whichever variant Core App can't sign for.
     */
    async evmGetAtomicUTXOs(sourceChain: ExportChainsC): Promise<EVMUTXOSet> {
        const xpStyleAddr = this.getActiveCChainAtomicAddress()
        console.log(`evm xpStyleAddr `, xpStyleAddr)
        const evmBytesAddr = this.getEvmAddressBech()
        console.log(`evm evmBytesAddr `, evmBytesAddr)
        const addrs = [...new Set([xpStyleAddr, evmBytesAddr].filter(Boolean))]
        return await UtxoHelper.evmGetAtomicUTXOs(addrs, sourceChain)
    }

    /**
     * Override importToCChain.
     *
     * Core App routes C-chain atomic imports through `avalanche_sendTransaction`
     * (NOT `avalanche_signTransaction` — that one only signs EVM transactions and
     * returns "This account has nothing to sign" for any atomic tx).
     *
     * Empirical (post captured-payload analysis): Core App's matchOwners for
     * chainAlias='C' uses the XP-style (ripemd160(sha256(pk))) derivation — the
     * same bytes as the account's addressAVM / addressPVM — NOT the EVM
     * keccak256 bytes.  The X→C export side now encodes the destination with
     * those bytes plus a "C-" alias (see exportFromXChain above), so Core App
     * can find a matching signer.
     *
     * Stranded UTXOs (owned by EVM-bytes from older exports) are detected and
     * surfaced as a recovery prompt — Core App can't import them and they need
     * mnemonic recovery.
     */
    async importToCChain(sourceChain: ExportChainsC, fee: BN, utxoSet?: EVMUTXOSet): Promise<string> {
        if (!utxoSet) {
            utxoSet = await this.evmGetAtomicUTXOs(sourceChain)
        }
        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        // Canonical C-prefix bech32 of each UTXO owner, for uniform comparison.
        const hrp = ava.getHRP()
        const ownerAddrs = (utxoSet.getAddresses() as any[]).map((addr) =>
            bintools.addressToString(hrp, 'C', addr)
        )

        // Core-signable set = each Core account's `addressCoreEth` — the bech32
        // "C-..." form derived from ripemd160(sha256(compressed_EVM_pubkey)).
        // Core App's atomic-sign path for chainAlias='C' matches input UTXO
        // owner bytes against EXACTLY these bytes when picking a signing key
        // (verified against the avalanche_getAccounts response).  Neither the
        // standard EVM (keccak256) form nor the XP-style (X-chain pubkey hash)
        // form works — only this one.
        const coreSignable = new Set(
            this.coreAccounts.map((a) => a.addressCoreEth).filter(Boolean)
        )

        const signableOwners = ownerAddrs.filter((a) => coreSignable.has(a))
        const strandedOwners = ownerAddrs.filter((a) => !coreSignable.has(a))

        if (signableOwners.length === 0) {
            const stuckAddr = strandedOwners[0]
            const isLegacyEvmBytes = stuckAddr === this.getEvmAddressBech()
            const xpStyleAddr = (() => {
                const avm = this.coreAccounts.find((a) => a.active)?.addressAVM
                return avm ? `C-${avm.split('-')[1]}` : ''
            })()
            const isLegacyXpStyle = stuckAddr === xpStyleAddr
            const variant = isLegacyEvmBytes
                ? 'the EVM-bytes (keccak256) form'
                : isLegacyXpStyle
                ? 'the XP-style (X-chain pubkey hash) form'
                : 'a non-Core-signable form'
            throw new Error(
                `Atomic UTXOs are owned by ${variant} of your C-chain address (${stuckAddr}). ` +
                `An older build of this app exported X→C / P→C to that destination ` +
                `instead of the addressCoreEth form Core App actually signs for. ` +
                `These UTXOs are stranded under Core extension. To recover them, ` +
                `access AVXTO Wallet using your seed phrase — a mnemonic-based wallet ` +
                `can derive the private key at any HD index and sign the import locally. ` +
                `If you exported these funds using Core Extension with the same seed phrase, ` +
                `they will be recoverable.`
            )
        }

        if (strandedOwners.length > 0) {
            console.warn(
                '[importToCChain] Skipping stranded UTXOs at non-Core addresses:',
                strandedOwners
            )
        }

        const network = activeNetwork
        const chain = defineChain({
            id: network.evmChainID,
            name: 'Avalanche',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: { default: { http: [network.rpcUrl.c] } },
        })

        const buildClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'http' as const, url: network.rpcUrl.c },
        })

        // fromAddresses = the signable subset, deduplicated.
        const fromAddrs = [...new Set(signableOwners)]

        const importTxResult = await buildClient.cChain.prepareImportTxn({
            sourceChain: sourceChain as 'X' | 'P',
            toAddress: '0x' + this.getEvmAddress(),
            fromAddresses: fromAddrs,
        })

        // Custom-transport client routes avalanche_sendTransaction to Core App.
        const signClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'custom' as const, provider: this.provider },
        })

        // Minimum-shape call: just tx + chainAlias.  No externalIndices, no
        // utxoIds — both produced regressions in our previous tests.  Core App
        // auto-selects the active account's atomic-C signing key.
        const result = await signClient.sendXPTransaction({
            tx: importTxResult.tx,
            chainAlias: 'C',
        })

        return result.txHash
    }

    /**
     * Override importToXChain for InjectedWallet.
     *
     * Core App's wallet API only signs for an account's primary X-chain address
     * (each account's addressAVM = m/0/0 of that account's xpub).  HD-derived
     * children of the active account's xpub (m/0/i for i>0) — though the same
     * key material — are NOT exposed by Core App as signable, and we have
     * empirically confirmed neither `externalIndices` (via avalanche_sendTransaction
     * → rejected for X with "Unable to create transaction") nor passing the param
     * to avalanche_signTransaction (silently ignored) makes Core App reach into
     * those derived indices.  An older version of this app used getCurrentAddressAvm()
     * (the last HD-scanned external address) as the C→X export destination, which
     * stranded UTXOs at addresses like _hdXExternal[99] — recoverable only by
     * signing with the seed in a wallet that supports arbitrary HD derivation.
     *
     * Implementation:
     *   1. Fetch atomic UTXOs and split owners into "Core-signable" (any account's
     *      addressAVM) vs. "stranded" (HD-derived, no Core account match).
     *   2. If everything is stranded, throw an actionable error naming the address
     *      and pointing to the recovery path.
     *   3. Otherwise build the Etna-codec ImportTx with `fromAddresses` = the
     *      signable subset only, so the SDK constructs a tx Core App can sign.
     *   4. Sign via avalanche_signTransaction with `utxos: utxoHexes` (hex blobs
     *      of the UTXO bytes — Core App's getProvidedUtxos decodes these to find
     *      owners without a Glacier round-trip).
     *   5. Issue directly via avm.issueTx (Core App rejects avalanche_sendTransaction
     *      for X-chain).
     */
    async importToXChain(sourceChain: AvmImportChainType): Promise<string> {
        const utxoSet = await this.avmGetAtomicUTXOs(sourceChain)
        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        const hrp = ava.getHRP()
        const ownerAddrs = (utxoSet.getAddresses() as any[]).map((addr) =>
            bintools.addressToString(hrp, 'X', addr)
        )

        // Split owners by whether Core App will sign for them.  Only addresses
        // matching a Core account's primary addressAVM are signable through the
        // injected provider; HD-derived children of the active xpub are not.
        const coreSignable = new Set(
            this.coreAccounts.map((a) => a.addressAVM).filter(Boolean)
        )
        const signableOwners = ownerAddrs.filter((a) => coreSignable.has(a))
        const strandedOwners = ownerAddrs.filter((a) => !coreSignable.has(a))

        if (signableOwners.length === 0) {
            const stuckAddr = strandedOwners[0]
            const hdIdx = this._hdXExternal.indexOf(stuckAddr)
            const idxStr = hdIdx >= 0 ? ` (HD external index ${hdIdx})` : ''
            throw new Error(
                `Atomic UTXOs are owned by ${stuckAddr}${idxStr}, which Core App's signing API ` +
                `does not expose. These funds were exported by an earlier build of this app that ` +
                `used a derived (non-primary) X-chain address as the destination. To recover them, ` +
                `access AVXTO WAllet using your seed phrase. ` +
                `A seed phrase wallet can derive the private key at any HD index and sign the import transaction locally. If you exported these funds using the same seed, they will be recoverable.`
            )
        }

        if (strandedOwners.length > 0) {
            console.warn(
                '[importToXChain] Skipping stranded UTXOs at non-Core addresses:',
                strandedOwners
            )
        }

        const network = activeNetwork
        const chain = defineChain({
            id: network.evmChainID,
            name: 'Avalanche',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: { default: { http: [network.rpcUrl.c] } },
        })

        // Pre-fetch XP public key so the HTTP build client can satisfy EI()'s
        // xpAccount/evmAccount check without calling getAccountPubKey on the node.
        const pubKeyData = (await this.provider.request({
            method: 'avalanche_getAccountPubKey',
            params: {},
        })) as { xp: string; evm: string }

        const buildClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'http' as const, url: network.rpcUrl.c },
            account: {
                xpAccount: { publicKey: pubKeyData.xp } as any,
                evmAccount: {
                    address: ('0x' + this.ethAddress) as `0x${string}`,
                    publicKey: pubKeyData.evm,
                } as any,
            } as any,
        })

        // Always land imported AVAX at the 0-index X address (m/0/0 of accountKey)
        // so it stays signable regardless of which Core account is currently active.
        const xToAddr = this.avmAddress

        const importTxResult = await buildClient.xChain.prepareImportTxn({
            sourceChain: sourceChain as 'P' | 'C',
            importedOutput: { addresses: [xToAddr] },
            // Restrict to signable owners so the SDK won't include stranded UTXOs
            // (Core App would reject the whole tx if even one input is unsignable).
            fromAddresses: signableOwners,
        })

        // tx.toJSON().utxos = hex-encoded UTXO bytes per input — the format
        // Core App's getProvidedUtxos() decodes to determine signing keys.
        const utxoHexes = (importTxResult.tx.toJSON() as any).utxos as string[]
        const transactionHex =
            '0x' + Buffer.from(importTxResult.tx.toBytes()).toString('hex')

        const raw = await this.provider.request({
            method: 'avalanche_signTransaction',
            params: {
                transactionHex,
                chainAlias: 'X',
                utxos: utxoHexes,
            },
        })

        const signedHex: string =
            typeof raw === 'string' ? raw : (raw as any).signedTransactionHex

        // avm.issueTx forwards raw bytes to the X-chain node; AvalancheGo accepts
        // both old and new codec hex regardless of which client serialized it.
        return await avm.issueTx(
            signedHex.startsWith('0x') ? signedHex : `0x${signedHex}`
        )
    }

    /**
     * Override importToPlatformChain for InjectedWallet.
     *
     * Strategy (mirrors importToCChain):
     *   1. Pre-fetch the wallet's XP public key from Core App so the HTTP build client can
     *      satisfy SDK's EI() call without hitting avalanche_getAccountPubKey on the node.
     *      (Unlike C-chain whose prepareImportTxn skips EI() when fromAddresses is given,
     *       P-chain's kI() always calls EI() — so the buildClient must have an account set.)
     *   2. Build the Etna-codec P-chain ImportTx via buildClient.pChain.prepareImportTxn(),
     *      passing all known P-chain addresses so the SDK finds UTXOs at any HD index.
     *   3. Sign + submit through signClient.sendXPTransaction() with explicit externalIndices
     *      so Core App can sign the atomic import without needing its own UTXO cache lookup.
     */
    async importToPlatformChain(sourceChain: ExportChainsP): Promise<string> {
        const utxoSet = await this.platformGetAtomicUTXOs(sourceChain)
        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        const network = activeNetwork
        const chain = defineChain({
            id: network.evmChainID,
            name: 'Avalanche',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: { default: { http: [network.rpcUrl.c] } },
        })

        // Pre-fetch XP public key from Core App.  The HTTP build client needs it to
        // satisfy EI()'s xpAccount/evmAccount check without calling getAccountPubKey
        // on the Avalanche node (which doesn't support that wallet method).
        const pubKeyData = (await this.provider.request({
            method: 'avalanche_getAccountPubKey',
            params: {},
        })) as { xp: string; evm: string }

        // HTTP client for building — fetches UTXOs, fee state, etc. from the P-chain node.
        const buildClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'http' as const, url: network.rpcUrl.c },
            account: {
                xpAccount: { publicKey: pubKeyData.xp } as any,
                evmAccount: {
                    address: ('0x' + this.ethAddress) as `0x${string}`,
                    publicKey: pubKeyData.evm,
                } as any,
            } as any,
        })

        // Use all discovered P-chain HD addresses so the SDK fetches atomic UTXOs at
        // every HD index the wallet may have used when exporting.
        const pAddrs = this._hdP.length > 0 ? this._hdP : [this.platformAddress]

        const importTxResult = await buildClient.pChain.prepareImportTxn({
            sourceChain: sourceChain as 'X' | 'C',
            // Always land imported AVAX at the 0-index P address (m/0/0 of accountKey)
            // so it stays signable regardless of which Core account is currently active.
            importedOutput: { addresses: [this.platformAddress] },
            // fromAddresses = the set of addresses the SDK uses to fetch + claim UTXOs.
            fromAddresses: pAddrs,
        })

        // Custom-transport client routes avalanche_sendTransaction to Core App.
        const signClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'custom' as const, provider: this.provider },
        })

        // Build externalIndices: pAddrs[i] was derived at HD external index i.
        // Passing these tells Core App which key(s) to use for signing without
        // requiring it to look up the atomic UTXOs in its own UTXO cache.
        const externalIndices = pAddrs.map((_, i) => i)

        const result = await signClient.sendXPTransaction({
            tx: importTxResult.tx,
            chainAlias: 'P',
            externalIndices,
        } as any)

        return result.txHash
    }

    // Delegated to AbstractWallet using signX / signP / signC above.
    // Core App (window.avalanche) is required; MetaMask does not support avalanche_signTx.

    // ---- Validation / Delegation ----

    /**
     * Override delegate() to restrict inputs/change to Core-signable P-chain addresses.
     * Including HD-derived addresses lets buildAddDelegatorTx pick UTXOs that Core App
     * cannot sign for, producing "This account has nothing to sign".
     */
    async delegate(
        nodeID: string,
        amt: BN,
        start: Date,
        end: Date,
        rewardAddress?: string,
        utxos?: PlatformUTXO[]
    ): Promise<string> {
        // Restrict to addresses Core App can sign for (primary addressPVM per account).
        const coreSignableP = this.coreAccounts.map((a) => a.addressPVM).filter(Boolean)
        const pAddressStrings = coreSignableP.length > 0
            ? coreSignableP
            : (this.platformAddress ? [this.platformAddress] : [])

        if (pAddressStrings.length === 0) {
            throw new Error(
                'No Core-signable P-chain addresses available. Connect a Core extension ' +
                'account that exposes avalanche_getAccounts.'
            )
        }

        let utxoSet = this.getPlatformUTXOSet()
        if (utxos) {
            utxoSet = new PlatformUTXOSet()
            utxoSet.addArray(utxos)
        }

        const sortedSet = sortUTxoSetP(utxoSet, false)

        if (!rewardAddress) {
            rewardAddress = pAddressStrings[0]
        }

        const stakeReturnAddr = pAddressStrings[0]
        const changeAddress = pAddressStrings[0]

        const startTime = new BN(Math.round(start.getTime() / 1000))
        const endTime = new BN(Math.round(end.getTime() / 1000))

        const unsignedTx = await pChain.buildAddDelegatorTx(
            sortedSet,
            [stakeReturnAddr],
            pAddressStrings,
            [changeAddress],
            nodeID,
            startTime,
            endTime,
            amt,
            [rewardAddress]
        )

        const tx = await this.signP(unsignedTx)
        return this.issueP(tx)
    }

    async validate(
        nodeID: string,
        amt: BN,
        start: Date,
        end: Date,
        delegationFee: number,
        rewardAddress?: string,
        utxos?: PlatformUTXO[]
    ): Promise<string> {
        throw new Error('Validation is not supported with injected wallets.')
    }

    // ---- Cross-chain export override ----
    // Use the new SDK sendXPTransaction with a custom provider transport so Core App
    // handles signing and submission internally, without any manual signC/issueC dance.

    async exportFromCChain(amt: BN, destinationChain: ExportChainsC, exportFee: BN): Promise<string> {
        const importFee = avm.getTxFee()
        const amtFee = amt.add(importFee)

        const hexAddr = this.getEvmAddress()
        // Always export to the 0-index X/P address (m/0/0 of accountKey) so the
        // resulting atomic UTXO lands at a primary, signable address regardless
        // of HD scan state.  Using getCurrentAddressPlatform / getActiveXChainAddress
        // here previously stranded UTXOs at derived indices Core App could not sign.
        const destinationAddr =
            destinationChain === 'X'
                ? this.avmAddress
                : this.platformAddress

        const exportTxResult = await TxHelper.buildEvmExportTransaction(
            [`0x${hexAddr}`],
            destinationAddr,
            amtFee,
            '',
            destinationChain,
            exportFee
        )
        
        const chain = defineChain({
            id: activeNetwork.evmChainID,
            name: 'Avalanche',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: { default: { http: [activeNetwork.rpcUrl.c] } },
        })

        // Use the injected provider as the transport so Core App handles
        // avalanche_signTransaction + avalanche_sendTransaction internally.
        const walletClient = createAvalancheWalletClient({
            chain: chain as any,
            transport: { type: 'custom' as const, provider: this.provider },
        })

        const result = await walletClient.sendXPTransaction({
            tx: exportTxResult.tx,
            chainAlias: exportTxResult.chainAlias,
        })

        return result.txHash
    }

    /**
     * Override exportFromPChain for InjectedWallet.
     *
     * Destinations:
     * - P→X: Core App's active addressAVM (HD index 0).  avalanche_signTransaction
     *   on the import side only signs for primary account addresses, not
     *   HD-derived children, so the UTXO owner on X must match this address.
     * - P→C: `getActiveCChainAtomicAddress()` (= the account's `addressCoreEth`).
     *   Core App's atomic-C signer-lookup uses ripemd160(sha256(compressed EVM
     *   pubkey)) — neither the standard EVM bytes nor the X-chain key bytes
     *   work (verified via captured `avalanche_sendTransaction` payload).
     *
     * Inputs:
     *   `fromAddrs` is restricted to Core-signable addresses (= each Core
     *   account's `addressPVM`).  If we include HD-derived P-chain addresses,
     *   the SDK may select UTXOs at those addresses as inputs, and Core App's
     *   `avalanche_signTransaction` returns "This account has nothing to sign"
     *   because it can't reach into HD-derived signing keys.  Funds stranded
     *   at HD-derived P addresses are recoverable only via mnemonic.
     *
     *   `pChangeAddr` is also pinned to a Core-signable address so change
     *   doesn't land at an HD-derived index.
     */
    async exportFromPChain(amt: BN, destinationChain: ExportChainsP, importFee?: BN): Promise<string> {
        if (destinationChain === 'C' && !importFee)
            throw new Error('Exports to C chain must specify an import fee.')

        let amtFee = amt.clone()
        if (importFee) {
            amtFee = amt.add(importFee)
        } else if (destinationChain === 'X') {
            amtFee = amt.add(avm.getTxFee())
        }

        const destinationAddr =
            destinationChain === 'C'
                ? this.getActiveCChainAtomicAddress()
                : this.avmAddress

        // Restrict input/change addresses to Core-signable primaries.  Including
        // HD-derived addresses in fromAddrs lets the SDK pick UTXOs Core App
        // can't sign for, producing "This account has nothing to sign".
        const coreSignableP = this.coreAccounts.map((a) => a.addressPVM).filter(Boolean)
        const fromAddrs = coreSignableP.length > 0
            ? coreSignableP
            : (this.platformAddress ? [this.platformAddress] : [])

        if (fromAddrs.length === 0) {
            throw new Error(
                'No Core-signable P-chain addresses available. Connect a Core extension ' +
                'account that exposes avalanche_getAccounts, or import your seed phrase ' +
                'via Wallet Wizard.'
            )
        }

        const utxoSet = this.getPlatformUTXOSet()
        const sortedSet = sortUTxoSetP(utxoSet, false)
        // Send change back to the primary signable address (the active Core
        // account's addressPVM) so it stays signable in future txs.
        const active = this.coreAccounts.find((a) => a.active) ?? this.coreAccounts[0]
        const pChangeAddr = active?.addressPVM || fromAddrs[0]

        const exportTx = await TxHelper.buildPlatformExportTransaction(
            sortedSet,
            fromAddrs,
            destinationAddr,
            amtFee,
            pChangeAddr,
            destinationChain
        )

        const tx = await this.signP(exportTx)
        return await this.issueP(tx)
    }
}

export { InjectedWallet }
