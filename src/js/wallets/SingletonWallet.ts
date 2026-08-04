import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { ITransaction } from '@/components/wallet/transfer/types'
import { digestMessage } from '@/helpers/helper'
import { WalletNameType } from '@/js/wallets/types'

import { Buffer as BufferAvalanche, BN } from '@/avalanche'
import {
    KeyPair as AVMKeyPair,
    KeyChain as AVMKeyChain,
    UTXOSet as AVMUTXOSet,
    UTXO,
    UnsignedTx,
} from '@/avalanche/apis/avm'
import {
    KeyPair as PlatformKeyPair,
    KeyChain as PlatformKeyChain,
    UTXOSet as PlatformUTXOSet,
    UTXOSet,
} from '@/avalanche/apis/platformvm'
import { KeyChain, KeyChain as EVMKeyChain, UTXOSet as EVMUTXOSet } from '@/avalanche/apis/evm'
import { PayloadBase } from '@/avalanche/utils'
import { buildUnsignedTransaction } from '../TxHelper'
import { AvaWalletCore } from './types'
import { privateToAddress, importPublic, publicToAddress } from 'ethereumjs-util'
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
import { privateKeyToXPAccount } from '@avalanche-sdk/client/accounts'
import { UTXO as AVMUTXO } from '@/avalanche/apis/avm/utxos'
import { Transaction } from '@ethereumjs/tx'
import { markRaw } from 'vue'
import { SessionVault } from '@/js/security/SessionVault'
import { AuthHandle, AuthScope, requireAuth } from '@/js/security/session'
import { destroyKeyPair } from '@/js/security/memory'

class SingletonWallet extends AbstractWallet implements AvaWalletCore {
    chainId: string
    chainIdP: string

    stakeAmount: BN

    type: WalletNameType

    ethAddress: string
    ethAddressBech: string

    /** Compressed public key. Public data — enough for every address. */
    private readonly publicKey: BufferAvalanche

    /** Address strings, recomputed on network change (the HRP moves with it). */
    private xAddress: string
    private pAddress: string

    /**
     * Holds this wallet's private key as ciphertext. Readable only inside an
     * authorized scope. markRaw so Vue's deep reactivity never proxies it.
     */
    readonly vault: SessionVault

    /**
     * Builds a wallet from a `PrivateKey-...` string, encrypting it under the
     * session password. Async because encryption is; use this rather than `new`.
     */
    static async create(pk: string, password: string): Promise<SingletonWallet> {
        const vault = markRaw(new SessionVault())
        const key = await vault.deriveKey(password)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)

        // Raw 32 bytes; the `PrivateKey-` wrapper is rebuilt on demand.
        const pkBuf = bintools.cb58Decode(pk.split('-')[1])

        try {
            const wallet = new SingletonWallet(pkBuf)
            await vault.put(auth, 'pk', new Uint8Array(pkBuf))
            return wallet
        } finally {
            auth.dispose()
        }
    }

    /** Private: use SingletonWallet.create(). */
    private constructor(pkBuf: BufferAvalanche, vault?: SessionVault) {
        super()

        this.chainId = avm.getBlockchainAlias() || avm.getBlockchainID()
        this.chainIdP = pChain.getBlockchainAlias() || pChain.getBlockchainID()

        // Derive the public key once, then drop the private key. Everything
        // this wallet needs at rest comes from the public key.
        const tmpChain = new AVMKeyChain(ava.getHRP(), this.chainId)
        const tmpPair = tmpChain.importKey(
            `PrivateKey-` + bintools.cb58Encode(BufferAvalanche.from(pkBuf))
        )
        this.publicKey = tmpPair.getPublicKey()
        destroyKeyPair(tmpPair)

        this.ethAddress = publicToAddress(
            importPublic(Buffer.from(this.publicKey))
        ).toString('hex')

        this.xAddress = ''
        this.pAddress = ''
        this.ethAddressBech = ''
        this.refreshAddresses()

        this.stakeAmount = new BN(0)
        this.type = 'singleton'
        this.isInit = true
        // Assigned by create(); only undefined transiently inside it.
        this.vault = vault as SessionVault
    }

    /** Recomputes bech32 addresses from the public key for the active HRP. */
    private refreshAddresses(): void {
        const hrp = ava.getHRP()
        const addrBuf = AVMKeyPair.addressFromPublicKey(this.publicKey)
        this.xAddress = bintools.addressToString(hrp, this.chainId, addrBuf)
        this.pAddress = bintools.addressToString(hrp, this.chainIdP, addrBuf)
        this.ethAddressBech = bintools.addressToString(hrp, 'C', addrBuf)
    }

    /**
     * Rebuilds the `PrivateKey-...` string from the vault for the duration of
     * `fn`. The string itself cannot be wiped, so it never leaves this scope.
     */
    private async withPrivateKey<T>(fn: (pkStr: string, pkBytes: Uint8Array) => Promise<T> | T) {
        const auth = requireAuth(this.vault)
        return this.vault.withSecret(auth, 'pk', async (pkBytes) => {
            const pkStr = `PrivateKey-` + bintools.cb58Encode(BufferAvalanche.from(pkBytes))
            return await fn(pkStr, pkBytes)
        })
    }

    getChangeAddressAvm(): string {
        return this.getCurrentAddressAvm()
    }

    getAllExternalAddressesX(): string[] {
        return [this.getCurrentAddressAvm()]
    }

    getAllChangeAddressesX(): string[] {
        return [this.getChangeAddressAvm()]
    }

    getCurrentAddressAvm(): string {
        return this.xAddress
    }

    getDerivedAddresses(): string[] {
        const addr = this.getCurrentAddressAvm()
        return [addr]
    }

    getDerivedAddressesP() {
        return [this.getCurrentAddressPlatform()]
    }

    getAllDerivedExternalAddresses(): string[] {
        return this.getDerivedAddresses()
    }

    getExtendedPlatformAddresses(): string[] {
        return [this.pAddress]
    }

    getHistoryAddresses(): string[] {
        const addr = this.getCurrentAddressAvm()
        return [addr]
    }

    getCurrentAddressPlatform(): string {
        return this.pAddress
    }

    getBaseAddress(): string {
        return this.getCurrentAddressAvm()
    }

    getPlatformUTXOSet(): PlatformUTXOSet {
        return this.platformUtxoset
    }

    getEvmAddress(): string {
        return this.ethAddress
    }

    getEvmAddressBech(): string {
        return this.ethAddressBech
    }

    async updateUTXOsX(): Promise<AVMUTXOSet> {
        const result = await avmGetAllUTXOs([this.getCurrentAddressAvm()])
        this.utxoset = result
        return result
    }

    async updateUTXOsP(): Promise<PlatformUTXOSet> {
        const result = await platformGetAllUTXOs([this.getCurrentAddressPlatform()])
        this.platformUtxoset = result
        return result
    }

    async getUTXOs(): Promise<void> {
        this.isFetchingUtxos = true

        await this.updateUTXOsX()
        await this.updateUTXOsP()

        await this.getStake()
        await this.getEthBalance()

        this.isFetchingUtxos = false

        return
    }

    async buildUnsignedTransaction(
        orders: (ITransaction | UTXO)[],
        addr: string,
        memo?: BufferAvalanche
    ) {
        const changeAddress = this.getChangeAddressAvm()
        const derivedAddresses = this.getDerivedAddresses()
        const utxoset = this.getUTXOSet() as AVMUTXOSet

        return buildUnsignedTransaction(
            orders,
            addr,
            derivedAddresses,
            utxoset,
            changeAddress,
            memo
        )
    }

    async issueBatchTx(
        orders: (ITransaction | AVMUTXO)[],
        addr: string,
        memo: BufferAvalanche | undefined
    ): Promise<string> {
        return await WalletHelper.issueBatchTx(this, orders, addr, memo)
    }

    onnetworkchange(): void {
        this.utxoset = new AVMUTXOSet()
        this.platformUtxoset = new PlatformUTXOSet()

        // Only the HRP changes; addresses come from the public key, and there
        // are no keychains held at rest to rebuild.
        this.refreshAddresses()
        this.ethBalance = new BN(0)

        this.getUTXOs()
    }

    async signX(unsignedTx: AVMUnsignedTx): Promise<AVMTx> {
        return this.withPrivateKey((pkStr) => {
            const keychain = new AVMKeyChain(ava.getHRP(), this.chainId)
            const pair = keychain.importKey(pkStr)
            try {
                return unsignedTx.sign(keychain)
            } finally {
                destroyKeyPair(pair)
            }
        })
    }

    async signP(unsignedTx: PlatformUnsignedTx): Promise<PlatformTx> {
        return this.withPrivateKey((pkStr) => {
            const keychain = new PlatformKeyChain(ava.getHRP(), this.chainIdP)
            const pair = keychain.importKey(pkStr)
            try {
                return unsignedTx.sign(keychain)
            } finally {
                destroyKeyPair(pair)
            }
        })
    }

    async signC(unsignedTx: EVMUnsignedTx): Promise<EvmTx> {
        return this.withPrivateKey((pkStr) => {
            const keychain = new EVMKeyChain(ava.getHRP(), 'C')
            const pair = keychain.importKey(pkStr)
            try {
                return unsignedTx.sign(keychain)
            } finally {
                destroyKeyPair(pair)
            }
        })
    }

    async signEvm(tx: Transaction) {
        return this.withPrivateKey((_pkStr, pkBytes) => {
            const keyBuff = Buffer.from(pkBytes)
            try {
                return tx.sign(keyBuff)
            } finally {
                keyBuff.fill(0)
            }
        })
    }

    async signMessage(msgStr: string): Promise<string> {
        const digest = digestMessage(msgStr)
        const digestHex = digest.toString('hex')
        const digestBuff = BufferAvalanche.from(digestHex, 'hex')

        return this.withPrivateKey((pkStr) => {
            const keychain = new AVMKeyChain(ava.getHRP(), this.chainId)
            const pair = keychain.importKey(pkStr)
            try {
                return bintools.cb58Encode(pair.sign(digestBuff))
            } finally {
                destroyKeyPair(pair)
            }
        })
    }

    /**
     * The raw private key as hex, for the "reveal private key" screen.
     * Requires an open authorization.
     */
    async getPrivateKeyHex(): Promise<string> {
        return this.withPrivateKey((_pkStr, pkBytes) =>
            BufferAvalanche.from(pkBytes).toString('hex')
        )
    }

    /** The `PrivateKey-...` form, for keystore export. Requires authorization. */
    async getPrivateKeyString(): Promise<string> {
        return this.withPrivateKey((pkStr) => pkStr)
    }

    async createNftFamily(name: string, symbol: string, groupNum: number) {
        return await WalletHelper.createNftFamily(this, name, symbol, groupNum)
    }

    async mintNft(mintUtxo: AVMUTXO, payload: PayloadBase, quantity: number) {
        return await WalletHelper.mintNft(this, mintUtxo, payload, quantity)
    }

    async sendEth(to: string, amount: BN, gasPrice: BN, gasLimit: number) {
        return await WalletHelper.sendEth(this, to, amount, gasPrice, gasLimit)
    }

    async estimateGas(to: string, amount: BN, token: Erc20Token): Promise<number> {
        return await WalletHelper.estimateGas(this, to, amount, token)
    }

    async sendERC20(
        to: string,
        amount: BN,
        gasPrice: BN,
        gasLimit: number,
        token: Erc20Token
    ): Promise<string> {
        return await WalletHelper.sendErc20(this, to, amount, gasPrice, gasLimit, token)
    }

    getAllAddressesX() {
        return [this.getCurrentAddressAvm()]
    }

    getAllAddressesP() {
        return [this.getCurrentAddressPlatform()]
    }
}

export { SingletonWallet }
