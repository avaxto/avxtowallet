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
import { createAvalancheWalletClient } from '@avalanche-sdk/client'
import { activeNetwork } from '@/avalanche-wallet-sdk/Network/network'
import * as TxHelper from '@/avalanche-wallet-sdk/helpers/tx_helper'
import { buildUnsignedTransaction } from '@/js/TxHelper'
import { issueX } from '@/helpers/issueTx'
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
     * Scan one change-index (0=external, 1=internal) of the X-chain or P-chain
     * by querying Glacier in lots of LOT_SIZE addresses.
     * Stops after MAX_EMPTY_LOTS consecutive lots with zero UTXOs.
     * Returns the flat list of all addresses that belonged to non-empty lots.
     */
    private async _scanHdLot(changeIdx: 0 | 1, chainId: 'X' | 'P'): Promise<{ addresses: string[]; lastIdx: number }> {
        const LOT_SIZE = 50
        const MAX_EMPTY_LOTS = 5

        const netID = ava.getNetworkID()
        const hrp = getPreferredHRP(netID)
        const network = isMainnetNetworkId(netID) ? 'mainnet' : 'fuji'
        const blockchainId = chainId === 'X' ? 'x-chain' : 'p-chain'
        const sdk = new ChainKitAvalanche({ network })

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
        this.isFetchUtxos = true
        try {
            await this.getEthBalance()


            if (this._hdScanPromise) {
                // HD mode: wait for the Glacier lot-scan to finish discovering all
                // addresses that have (or had) UTXOs, then fetch the actual UTXO
                // objects from the node for each address.
                await this._hdScanPromise

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
            this.isFetchUtxos = false
        }
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
        const tx = await this.signX(unsignedTx)
        return issueX(tx)
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
        const raw = await this.provider.request({
            method: 'avalanche_signTransaction',
            params: { transactionHex: txHex, chainAlias: 'X' },
        })
        // Core App may return a plain hex string or { signedTransactionHex: '...' }
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
    // Delegated to AbstractWallet using signX / signP / signC above.
    // Core App (window.avalanche) is required; MetaMask does not support avalanche_signTx.

    // ---- Validation / Delegation (not supported) ----

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

    async delegate(
        nodeID: string,
        amt: BN,
        start: Date,
        end: Date,
        rewardAddress?: string,
        utxos?: PlatformUTXO[]
    ): Promise<string> {
        throw new Error('Delegation is not supported with injected wallets.')
    }

    // ---- Cross-chain export override ----
    // Use the new SDK sendXPTransaction with a custom provider transport so Core App
    // handles signing and submission internally, without any manual signC/issueC dance.

    async exportFromCChain(amt: BN, destinationChain: ExportChainsC, exportFee: BN): Promise<string> {
        const importFee = avm.getTxFee()
        const amtFee = amt.add(importFee)

        const hexAddr = this.getEvmAddress()
        const destinationAddr =
            destinationChain === 'X'
                ? this.getCurrentAddressAvm()
                : this.getCurrentAddressPlatform()

        const exportTxResult = await TxHelper.buildEvmExportTransaction(
            [`0x${hexAddr}`],
            destinationAddr,
            amtFee,
            '',
            destinationChain,
            exportFee
        )

        const network = activeNetwork
        const chain = defineChain({
            id: network.evmChainID,
            name: 'Avalanche',
            nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
            rpcUrls: { default: { http: [network.rpcUrl.c] } },
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
}

export { InjectedWallet }
