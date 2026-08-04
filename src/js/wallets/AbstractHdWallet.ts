import { ChainAlias } from '@/js/wallets/types'
import { UTXO } from '@/avalanche/apis/avm'

import { BN, Buffer } from '@/avalanche'
import { ITransaction } from '@/components/wallet/transfer/types'
import { ava, avm, bintools, pChain } from '@/AVA'
import { UTXOSet as AVMUTXOSet } from '@/avalanche/apis/avm/utxos'
import HDKey from 'hdkey'
import { HdHelper } from '@/js/HdHelper'
import { UTXOSet as PlatformUTXOSet } from '@/avalanche/apis/platformvm/utxos'
import { buildUnsignedTransaction } from '../TxHelper'
import { AbstractWallet } from '@/js/wallets/AbstractWallet'
import { updateFilterAddresses } from '../../providers'
import { digestMessage } from '@/helpers/helper'
import { ExportChainsP, ExportChainsX, UtxoHelper } from '@/avalanche-wallet-sdk'
import {
    AVMConstants,
    OperationTx,
    TransferableOperation,
    ImportTx as AVMImportTx,
    UnsignedTx as AVMUnsignedTx,
} from '@/avalanche/apis/avm'
import {
    PlatformVMConstants,
    ImportTx as PlatformImportTx,
    UnsignedTx as PlatformUnsignedTx,
} from '@/avalanche/apis/platformvm'
import { SigIdx } from '@/avalanche/common'
import { getPreferredHRP } from '@/avalanche/utils'
import { ChainIdType } from '@/constants'
import { pinia, useAssetsStore } from '@/stores'

/**
 * The HD indices whose private keys a transaction actually needs in order to
 * be signed.  `external` are indices under m/0 (X-chain receive addresses and
 * P-chain addresses, which share a derivation path), `internal` are under m/1
 * (X-chain change).
 */
export interface RequiredKeyIndices {
    external: number[]
    internal: number[]
    /** A C-chain (EVM) source address is among the inputs. */
    needsEvmKey: boolean
}

/**
 * A base class other HD wallets are based on.
 * Mnemonic Wallet and LedgerWallet uses this
 */
abstract class AbstractHdWallet extends AbstractWallet {
    chainId: string

    internalHelper: HdHelper
    externalHelper: HdHelper
    platformHelper: HdHelper

    ethHdNode: HDKey
    protected accountNodeXP: HDKey

    constructor(accountHdKey: HDKey, ethHdNode: HDKey, isPublic = true) {
        super()
        this.ethHdNode = ethHdNode
        this.chainId = avm.getBlockchainAlias() || avm.getBlockchainID()
        this.externalHelper = new HdHelper('m/0', accountHdKey, undefined, isPublic)
        this.internalHelper = new HdHelper('m/1', accountHdKey, undefined, isPublic)
        this.platformHelper = new HdHelper('m/0', accountHdKey, 'P', isPublic)
        this.accountNodeXP = accountHdKey

        this.externalHelper.oninit().then((res) => {
            this.updateInitState()
        })
        this.internalHelper.oninit().then((res) => {
            this.updateInitState()
        })
        this.platformHelper.oninit().then((res) => {
            this.updateInitState()
        })
    }

    getXpubXP() {
        return this.accountNodeXP.toJSON().xpub
    }

    /**
     * The account-level node (m/44'/9000'/0'). Public-only for wallets that
     * keep their keys vaulted, so it derives addresses but cannot sign.
     */
    getAccountNodeXP(): HDKey {
        return this.accountNodeXP
    }

    getEvmAddressBech(): string {
        return bintools.addressToString(
            ava.getHRP(),
            'C',
            // @ts-ignore
            this.ethHdNode.pubKeyHash
        )
    }

    updateAvmUTXOSet(): void {
        // if (this.isFetchingUtxos) return
        const setExternal = this.externalHelper.utxoSet as AVMUTXOSet
        const setInternal = this.internalHelper.utxoSet as AVMUTXOSet

        const joined = setInternal.merge(setExternal)
        this.utxoset = joined
    }

    updateFetchState() {
        this.isFetchingUtxos =
            this.externalHelper.isFetchingUTXOs ||
            this.internalHelper.isFetchingUTXOs ||
            this.platformHelper.isFetchingUTXOs
    }

    updateInitState() {
        this.isInit =
            this.externalHelper.isInit && this.internalHelper.isInit && this.platformHelper.isInit

        if (this.isInit) {
            updateFilterAddresses()
        }
    }
    // Fetches the utxos
    async getUTXOs(): Promise<void> {
        // Sequential on purpose: each helper lot-scans the address space with
        // heavy getUTXOs calls, and a wallet with many HD addresses firing
        // X-external, X-internal and P scans in parallel bursts past the
        // public API's rate limit (HTTP 429). Callers can still rely on X and
        // P balances being loaded when this resolves.
        await this.updateUTXOsX()
        await this.updateUTXOsP()
    }

    async updateUTXOsX() {
        await this.updateUTXOsExternal()
        await this.updateUTXOsInternal()
    }

    async updateUTXOsExternal() {
        const res = await this.externalHelper.updateUtxos()
        this.updateFetchState()
        this.updateAvmUTXOSet()
    }

    async updateUTXOsInternal() {
        const utxoSet = await this.internalHelper.updateUtxos()
        this.updateFetchState()
        this.updateAvmUTXOSet()
    }

    async updateUTXOsP() {
        const utxoSet = await this.platformHelper.updateUtxos()
        this.updateFetchState()
    }

    getAllDerivedExternalAddresses(): string[] {
        return this.externalHelper.getAllDerivedAddresses()
    }

    getAllChangeAddressesX(): string[] {
        return this.internalHelper.getAllDerivedAddresses()
    }

    getAllExternalAddressesX(): string[] {
        return this.externalHelper.getAllDerivedAddresses()
    }

    getDerivedAddresses(): string[] {
        const internal = this.internalHelper.getAllDerivedAddresses()
        const external = this.externalHelper.getAllDerivedAddresses()
        return internal.concat(external)
    }

    getDerivedAddressesP(): string[] {
        return this.platformHelper.getAllDerivedAddresses()
    }

    getAllAddressesX() {
        return this.getDerivedAddresses()
    }

    getAllAddressesP() {
        return this.getDerivedAddressesP()
    }

    /**
     * Override avmGetAtomicUTXOs to lot-scan the address space past the cached
     * helpers' hdIndex.  The default implementation in AbstractWallet uses
     * getAllAddressesX() which only emits addresses up to hdIndex — so atomic
     * UTXOs sitting in shared memory at owners past hdIndex (e.g. funds exported
     * to a freshly-derived X address by a different wallet/session) get missed.
     *
     * Mirrors the HdHelper.updateUtxos lot-scan: LOT_SIZE=200, stops after
     * MAX_EMPTY_LOTS=2 consecutive empty lots per helper.  External addresses
     * are scanned first since exports normally target those; internal/change
     * addresses are scanned afterwards for completeness.
     */
    async avmGetAtomicUTXOs(sourceChain: ExportChainsX): Promise<AVMUTXOSet> {
        const LOT_SIZE = 200
        const MAX_EMPTY_LOTS = 2

        let result = new AVMUTXOSet()

        for (const helper of [this.externalHelper, this.internalHelper]) {
            let emptyLots = 0
            let addrIdx = 0

            while (emptyLots < MAX_EMPTY_LOTS) {
                const lotAddrs: string[] = []
                for (let i = 0; i < LOT_SIZE; i++) {
                    lotAddrs.push(helper.getAddressForIndex(addrIdx + i))
                }

                const lotSet = await UtxoHelper.avmGetAtomicUTXOs(lotAddrs, sourceChain)
                if (lotSet.getAllUTXOs().length > 0) {
                    result = result.merge(lotSet) as AVMUTXOSet
                    emptyLots = 0
                } else {
                    emptyLots++
                }

                addrIdx += LOT_SIZE
            }
        }

        return result
    }

    /**
     * Override platformGetAtomicUTXOs with the same lot-scan strategy — atomic
     * P-chain UTXOs awaiting import may sit at P addresses past the platform
     * helper's hdIndex.
     */
    async platformGetAtomicUTXOs(sourceChain: ExportChainsP): Promise<PlatformUTXOSet> {
        const LOT_SIZE = 200
        const MAX_EMPTY_LOTS = 2

        let result = new PlatformUTXOSet()

        let emptyLots = 0
        let addrIdx = 0

        while (emptyLots < MAX_EMPTY_LOTS) {
            const lotAddrs: string[] = []
            for (let i = 0; i < LOT_SIZE; i++) {
                lotAddrs.push(this.platformHelper.getAddressForIndex(addrIdx + i))
            }

            const lotSet = await UtxoHelper.platformGetAtomicUTXOs(lotAddrs, sourceChain)
            if (lotSet.getAllUTXOs().length > 0) {
                result = result.merge(lotSet) as PlatformUTXOSet
                emptyLots = 0
            } else {
                emptyLots++
            }

            addrIdx += LOT_SIZE
        }

        return result
    }
    // Returns addresses to check for history
    getHistoryAddresses(): string[] {
        const internalIndex = this.internalHelper.hdIndex

        const evmBech32 = this.getEvmAddressBech()
        // They share the same address space, so whatever has the highest index
        const externalIndex = Math.max(this.externalHelper.hdIndex, this.platformHelper.hdIndex)

        const internal = this.internalHelper.getAllDerivedAddresses(internalIndex)
        const external = this.externalHelper.getAllDerivedAddresses(externalIndex)
        return [...internal, ...external, evmBech32]
    }

    getCurrentAddressAvm(): string {
        return this.externalHelper.getCurrentAddress()
    }

    getChangeAddressAvm() {
        return this.internalHelper.getCurrentAddress()
    }

    getChangePath(chainId?: ChainAlias): string {
        switch (chainId) {
            case 'P':
                return this.platformHelper.changePath
            case 'X':
            default:
                return this.internalHelper.changePath
        }
    }

    getChangeIndex(chainId?: ChainAlias): number {
        switch (chainId) {
            case 'P':
                return this.platformHelper.hdIndex
            case 'X':
            default:
                return this.internalHelper.hdIndex
        }
    }

    getChangeFromIndex(idx?: number, chainId?: ChainAlias): string | null {
        if (idx === undefined || idx === null) return null

        switch (chainId) {
            case 'P':
                return this.platformHelper.getAddressForIndex(idx)
            case 'X':
            default:
                return this.internalHelper.getAddressForIndex(idx)
        }
    }

    getCurrentAddressPlatform(): string {
        return this.platformHelper.getCurrentAddress()
    }

    getPlatformUTXOSet() {
        return this.platformHelper.utxoSet as PlatformUTXOSet
    }

    getPlatformActiveIndex() {
        return this.platformHelper.hdIndex
    }

    getExternalActiveIndex() {
        return this.externalHelper.hdIndex
    }

    getBaseAddress() {
        return this.externalHelper.getAddressForIndex(0)
    }

    onnetworkchange(): void {
        this.isInit = false
        this.stakeAmount = new BN(0)

        this.externalHelper.onNetworkChange().then(() => {
            this.updateInitState()
        })
        this.internalHelper.onNetworkChange().then(() => {
            this.updateInitState()
        })
        this.platformHelper.onNetworkChange().then(() => {
            this.updateInitState()
        })

        // TODO: Handle EVM changes
    }

    async buildUnsignedTransaction(orders: (ITransaction | UTXO)[], addr: string, memo?: Buffer) {
        const changeAddress = this.getChangeAddressAvm()
        const derivedAddresses: string[] = this.getDerivedAddresses()
        const utxoset = this.getUTXOSet()

        return buildUnsignedTransaction(
            orders,
            addr,
            derivedAddresses,
            utxoset,
            changeAddress,
            memo
        )
    }

    findExternalAddressIndex(address: string): number | null {
        // TODO: Look for P addresses too
        const indexX = this.externalHelper.findAddressIndex(address)
        const indexP = this.platformHelper.findAddressIndex(address)

        const index = indexX !== null ? indexX : indexP

        if (indexX === null && indexP === null) throw new Error('Address not found.')
        return index
    }

    async signMessageByExternalAddress(msgStr: string, address: string) {
        const index = this.findExternalAddressIndex(address)
        if (index === null) throw new Error('Address not found.')
        return await this.signMessageByExternalIndex(msgStr, index)
    }

    async signMessageByExternalIndex(msgStr: string, index: number): Promise<string> {
        const digest = digestMessage(msgStr)

        // Convert to the other Buffer and sign
        const digestHex = digest.toString('hex')
        const digestBuff = Buffer.from(digestHex, 'hex')

        return await this.signHashByExternalIndex(index, digestBuff)
    }

    async signMessage(msg: string, address: string) {
        return await this.signMessageByExternalAddress(msg, address)
    }

    /**
     * Walks a transaction's inputs (and NFT operations, if any) and returns the
     * source address behind every signature index, in order and including
     * duplicates — callers that sign positionally depend on both.
     *
     * Import transactions carry their spendable inputs separately from
     * getIns(), hence the getImportInputs() swap.
     */
    protected getTxSourceAddresses<UnsignedTx extends AVMUnsignedTx | PlatformUnsignedTx>(
        unsignedTx: UnsignedTx,
        chainId: ChainIdType
    ): { addresses: string[]; isAvaxOnly: boolean } {
        // TODO: This is a nasty fix. Remove when AJS is updated.
        unsignedTx.toBuffer()
        const tx = unsignedTx.getTransaction()
        const txType = tx.getTxType()

        const ins = tx.getIns()
        let operations: TransferableOperation[] = []

        // Try to get operations, it will fail if there are none, ignore and continue
        try {
            operations = (tx as OperationTx).getOperations()
        } catch (e) {
            // no operations on this tx type
        }

        let items = ins
        if (txType === AVMConstants.IMPORTTX && chainId === 'X') {
            items = (tx as AVMImportTx).getImportInputs()
        } else if (txType === PlatformVMConstants.IMPORTTX && chainId === 'P') {
            items = (tx as PlatformImportTx).getImportInputs()
        }

        const hrp = getPreferredHRP(ava.getNetworkID())
        const assetsStore = useAssetsStore(pinia)
        const addresses: string[] = []
        let isAvaxOnly = true

        for (let i = 0; i < items.length; i++) {
            const item = items[i]

            const assetId = bintools.cb58Encode(item.getAssetID())
            if (assetId !== assetsStore.AVA_ASSET_ID) {
                isAvaxOnly = false
            }

            const sigidxs: SigIdx[] = item.getInput().getSigIdxs()
            for (const sigidx of sigidxs) {
                addresses.push(bintools.addressToString(hrp, chainId, sigidx.getSource()))
            }
        }

        // Same for operational inputs, if there are any
        for (let i = 0; i < operations.length; i++) {
            const sigidxs: SigIdx[] = operations[i].getOperation().getSigIdxs()
            for (const sigidx of sigidxs) {
                addresses.push(bintools.addressToString(hrp, chainId, sigidx.getSource()))
            }
        }

        return { addresses, isAvaxOnly }
    }

    /**
     * Resolves an address this wallet owns to its `change/index` path.
     * Throws if the address isn't ours.
     */
    getPathFromAddress(address: string): string {
        const externalAddrs = this.externalHelper.getExtendedAddresses()
        const internalAddrs = this.internalHelper.getExtendedAddresses()
        const platformAddrs = this.platformHelper.getExtendedAddresses()

        const extIndex = externalAddrs.indexOf(address)
        const intIndex = internalAddrs.indexOf(address)
        const platformIndex = platformAddrs.indexOf(address)

        if (extIndex >= 0) {
            return `0/${extIndex}`
        } else if (intIndex >= 0) {
            return `1/${intIndex}`
        } else if (platformIndex >= 0) {
            return `0/${platformIndex}`
        } else if (address[0] === 'C') {
            return '0/0'
        } else {
            throw new Error('Unable to find source address.')
        }
    }

    /**
     * The minimal set of HD indices needed to sign this transaction.
     *
     * Deriving a full keychain up to hdIndex costs ~4 EC multiplies per index,
     * which on a well-used wallet is seconds of blocked main thread per
     * signature. A transaction normally spends from a handful of addresses, so
     * resolving just those keeps it in the tens of milliseconds. Address
     * lookup is served from the helpers' address cache and needs no private key.
     *
     * Returns null if any source address can't be resolved, so the caller can
     * fall back to deriving everything rather than under-signing.
     */
    getRequiredKeyIndices<UnsignedTx extends AVMUnsignedTx | PlatformUnsignedTx>(
        unsignedTx: UnsignedTx,
        chainId: ChainIdType
    ): RequiredKeyIndices | null {
        let addresses: string[]
        try {
            addresses = this.getTxSourceAddresses(unsignedTx, chainId).addresses
        } catch (e) {
            return null
        }

        const external = new Set<number>()
        const internal = new Set<number>()
        let needsEvmKey = false

        for (const address of addresses) {
            // A C-prefixed source is the EVM key (m/44'/60'/0'/0/0), not an
            // index in either X/P address space.
            if (address[0] === 'C') {
                needsEvmKey = true
                continue
            }

            let path: string
            try {
                path = this.getPathFromAddress(address)
            } catch (e) {
                // Owner sits past the scanned range — caller must derive fully.
                return null
            }

            const [change, idxStr] = path.split('/')
            const index = parseInt(idxStr, 10)
            if (isNaN(index)) return null

            if (change === '1') {
                internal.add(index)
            } else {
                external.add(index)
            }
        }

        return {
            external: [...external].sort((a, b) => a - b),
            internal: [...internal].sort((a, b) => a - b),
            needsEvmKey,
        }
    }

    abstract signHashByExternalIndex(index: number, hash: Buffer): Promise<string>
}
export { AbstractHdWallet }
