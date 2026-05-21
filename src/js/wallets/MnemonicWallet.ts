// A simple wrapper thar combines avalanche.js, bip39 and HDWallet

import {
    KeyPair as AVMKeyPair,
    KeyChain as AVMKeyChain,
    UTXOSet as AVMUTXOSet,
    TransferableInput,
    TransferableOutput,
    BaseTx,
    UnsignedTx as AVMUnsignedTx,
    Tx as AVMTx,
    UTXO as AVMUTXO,
    AssetAmountDestination,
    UTXOSet,
} from '@/avalanche/apis/avm'

import { privateToAddress } from 'ethereumjs-util'

import {
    KeyChain as PlatformVMKeyChain,
    UnsignedTx as PlatformUnsignedTx,
    UTXO as PlatformUTXO,
    Tx as PlatformTx,
} from '@/avalanche/apis/platformvm'

import {
    KeyChain as EVMKeyChain,
    UnsignedTx as EVMUnsignedTx,
    UTXOSet as EVMUTXOSet,
    Tx as EvmTx,
} from '@/avalanche/apis/evm'
import { getPreferredHRP, PayloadBase } from '@/avalanche/utils'

import * as bip39 from 'bip39'
import { BN, Buffer as BufferAvalanche } from '@/avalanche'
import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { AvmExportChainType, AvmImportChainType, IAvaHdWallet } from '@/js/wallets/types'
import HDKey from 'hdkey'
import { ITransaction } from '@/components/wallet/transfer/types'
import { KeyPair as PlatformVMKeyPair } from '@/avalanche/apis/platformvm'
import { AbstractHdWallet } from '@/js/wallets/AbstractHdWallet'
import { WalletNameType } from '@/js/wallets/types'
import { digestMessage } from '@/helpers/helper'
import { KeyChain } from '@/avalanche/apis/evm'
import Erc20Token from '@/js/Erc20Token'
import { WalletHelper } from '@/helpers/wallet_helper'
import { Transaction } from '@ethereumjs/tx'
import MnemonicPhrase from '@/js/wallets/MnemonicPhrase'
import { ExportChainsC, UtxoHelper, chainIdFromAlias } from '@/avalanche-wallet-sdk'

// HD WALLET
// Accounts are not used and the account index is fixed to 0
// m / purpose' / coin_type' / account' / change / address_index

const AVA_TOKEN_INDEX: string = '9000'
export const AVA_ACCOUNT_PATH: string = `m/44'/${AVA_TOKEN_INDEX}'/0'` // Change and index left out
export const ETH_ACCOUNT_PATH: string = `m/44'/60'/0'`
export const LEDGER_ETH_ACCOUNT_PATH = ETH_ACCOUNT_PATH + '/0/0'

const INDEX_RANGE: number = 20 // a gap of at least 20 indexes is needed to claim an index unused
const SCAN_SIZE: number = 70 // the total number of utxos to look at initially to calculate last index
const SCAN_RANGE: number = SCAN_SIZE - INDEX_RANGE // How many items are actually scanned

export default class MnemonicWallet extends AbstractHdWallet implements IAvaHdWallet {
    seed: string
    hdKey: HDKey
    private mnemonic: MnemonicPhrase
    isLoading: boolean
    type: WalletNameType
    ethKey: string
    ethKeyBech: string
    ethKeyChain: EVMKeyChain
    ethAddress: string

    // TODO : Move to hd core class
    onnetworkchange() {
        super.onnetworkchange()

        // Update EVM values
        this.ethKeyChain = new EVMKeyChain(ava.getHRP(), 'C')
        const cKeypair = this.ethKeyChain.importKey(this.ethKeyBech)
        this.ethBalance = new BN(0)
    }

    // The master key from avalanche.js
    constructor(mnemonic: string) {
        const seed: globalThis.Buffer = bip39.mnemonicToSeedSync(mnemonic)
        const masterHdKey: HDKey = HDKey.fromMasterSeed(seed)
        const accountHdKey = masterHdKey.derive(AVA_ACCOUNT_PATH)
        const ethAccountKey = masterHdKey.derive(ETH_ACCOUNT_PATH + '/0/0')

        super(accountHdKey, ethAccountKey, false)

        // Derive EVM key and address
        const ethPrivateKey = ethAccountKey.privateKey
        this.ethKey = ethPrivateKey.toString('hex')
        this.ethAddress = privateToAddress(ethPrivateKey).toString('hex')

        const cPrivKey = `PrivateKey-` + bintools.cb58Encode(BufferAvalanche.from(ethPrivateKey))
        this.ethKeyBech = cPrivKey

        const cKeyChain = new KeyChain(ava.getHRP(), 'C')
        this.ethKeyChain = cKeyChain

        const cKeypair = cKeyChain.importKey(cPrivKey)

        this.type = 'mnemonic'
        this.seed = seed.toString('hex')
        this.hdKey = masterHdKey
        this.mnemonic = new MnemonicPhrase(mnemonic)
        this.isLoading = false

        // AvalancheAccount: initialize xpAccount for XP-chain signing
        const avmKeyPair = this.externalHelper.getCurrentKey()
        if (avmKeyPair) {
            const pubKeyBuf = avmKeyPair.getPublicKey()
            const pubKeyHex = '0x' + pubKeyBuf.toString('hex')
            this.xpAccount = {
                publicKey: pubKeyHex,
                signMessage: async (message: string) => {
                    return this.signMessage(message)
                },
                signTransaction: async (txHash: string | Uint8Array) => {
                    const hashBuf = typeof txHash === 'string'
                        ? BufferAvalanche.from(txHash.replace('0x', ''), 'hex')
                        : BufferAvalanche.from(txHash)
                    const signed = avmKeyPair.sign(hashBuf)
                    return bintools.cb58Encode(signed)
                },
                verify: (message: string, signature: string) => {
                    try {
                        const msgBuf = BufferAvalanche.from(message, 'utf8')
                        const sigBuf = bintools.cb58Decode(signature)
                        return avmKeyPair.verify(msgBuf, sigBuf)
                    } catch {
                        return false
                    }
                },
                type: 'local' as const,
                source: 'mnemonic' as const,
            }
        }
    }

    getEvmAddress(): string {
        return this.ethAddress
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

    async getUTXOs(): Promise<void> {
        // TODO: Move to shared file
        this.isFetchUtxos = true
        // If we are waiting for helpers to initialize delay the call
        const isInit =
            this.externalHelper.isInit && this.internalHelper.isInit && this.platformHelper.isInit
        if (!isInit) {
            setTimeout(() => {
                this.getUTXOs()
            }, 1000)
            return
        }

        super.getUTXOs()
        this.getStake()
        this.getEthBalance()
        return
    }

    getCurrentKey(): AVMKeyPair {
        return this.externalHelper.getCurrentKey() as AVMKeyPair
    }

    /**
     * Returns the mnemonic phrase of this wallet
     */
    getMnemonic(): string {
        return this.mnemonic.getValue()
    }

    getMnemonicEncrypted(): MnemonicPhrase {
        return this.mnemonic
    }

    async issueBatchTx(
        orders: (ITransaction | AVMUTXO)[],
        addr: string,
        memo: BufferAvalanche | undefined
    ): Promise<string> {
        return await WalletHelper.issueBatchTx(this, orders, addr, memo)
    }

    // returns a keychain that has all the derived private/public keys for X chain
    getKeyChain(): AVMKeyChain {
        const internal = this.internalHelper.getAllDerivedKeys() as AVMKeyPair[]
        const external = this.externalHelper.getAllDerivedKeys() as AVMKeyPair[]

        const allKeys = internal.concat(external)
        const keychain: AVMKeyChain = new AVMKeyChain(
            getPreferredHRP(ava.getNetworkID()),
            this.chainId
        )

        for (let i = 0; i < allKeys.length; i++) {
            keychain.addKey(allKeys[i])
        }
        return keychain
    }

    async signX(unsignedTx: AVMUnsignedTx): Promise<AVMTx> {
        const keychain = this.getKeyChain()

        const tx = unsignedTx.sign(keychain)
        return tx
    }

    async signP(unsignedTx: PlatformUnsignedTx): Promise<PlatformTx> {
        const keychain = this.platformHelper.getKeychain() as PlatformVMKeyChain
        const tx = unsignedTx.sign(keychain)
        return tx
    }

    async signC(unsignedTx: EVMUnsignedTx): Promise<EvmTx> {
        const keyChain = this.ethKeyChain
        return unsignedTx.sign(keyChain)
    }

    /** The bech32-C address derived from the keccak256-based EVM bytes
     *  (i.e. the EVM address re-encoded with the "C-" prefix).  Distinct from
     *  `getEvmAddressBech()` which returns the XP-style ripemd160(sha256(pk))
     *  form.  Older buggy exports landed atomic UTXOs at this variant. */
    private getEvmBytesAddressBech(): string {
        return bintools.addressToString(
            ava.getHRP(),
            'C',
            BufferAvalanche.from(this.ethAddress, 'hex')
        )
    }

    /**
     * Override of AbstractWallet.evmGetAtomicUTXOs.
     *
     * Keeps the current behavior — fetching atomic UTXOs at the canonical
     * XP-style bech32-C address (`getEvmAddressBech()` = ripemd160(sha256(pk)))
     * — and additionally queries the EVM-bytes (keccak256) form of the same
     * underlying EVM address.  An older build of this app (and older Core
     * Extension exports) sent X→C / P→C atomic UTXOs to that second form
     * instead of the canonical one; those UTXOs are stranded under Core
     * Extension's signing API but the mnemonic wallet holds the EVM key and
     * can sign for either form locally.
     */
    async evmGetAtomicUTXOs(sourceChain: ExportChainsC): Promise<EVMUTXOSet> {
        const xpStyleBech = this.getEvmAddressBech()
        const evmBytesBech = this.getEvmBytesAddressBech()
        const addrs = [...new Set([xpStyleBech, evmBytesBech])]
        return await UtxoHelper.evmGetAtomicUTXOs(addrs, sourceChain)
    }

    /**
     * Override of AbstractWallet.createImportTxC.
     *
     * Only advertises the XP-style bech32-C address (`getEvmAddressBech()` =
     * ripemd160(sha256(pk))).  This restricts the SDK's internal re-fetch in
     * `cChain.buildImportTx` to UTXOs at that owner — i.e. the only ones whose
     * signature AvalancheGo's atomic-tx verifier will accept from our key.
     * UTXOs at the EVM-bytes (keccak256) form are deliberately excluded here
     * because including them would cause the entire tx to fail verification
     * with "wrong signature: expected X but got Y" — see importToCChain below
     * for the user-facing detection / warning.
     */
    async createImportTxC(sourceChain: ExportChainsC, utxoSet: EVMUTXOSet, fee: BN) {
        const xpStyleBech = this.getEvmAddressBech()
        const hexAddr = this.getEvmAddress()

        const toAddress = '0x' + hexAddr
        const ownerAddresses = [xpStyleBech]
        const fromAddresses = ownerAddresses
        const sourceChainId = chainIdFromAlias(sourceChain)

        return await cChain.buildImportTx(
            utxoSet,
            toAddress,
            ownerAddresses,
            sourceChainId,
            fromAddresses,
            fee
        )
    }

    /**
     * Override of AbstractWallet.importToCChain.
     *
     * Splits the atomic UTXOs returned by `evmGetAtomicUTXOs` into two buckets:
     *
     *   - Signable: UTXOs owned by the XP-style C-chain bech32
     *     (`getEvmAddressBech()` = ripemd160(sha256(compressed_pk))).
     *     AvalancheGo's atomic-tx verifier recomputes this same hash from the
     *     signature's recovered pubkey and matches — so our EVM private key
     *     can sign these and they import normally.
     *
     *   - Stranded: UTXOs owned by the EVM-bytes (keccak256) form, produced by
     *     a legacy buggy export path.  ripemd160(sha256(pk)) and
     *     keccak256(pk_uncompressed)[12:32] can never match for the same key
     *     (different hash functions on the same input — collision probability
     *     is 2^-160), so AvalancheGo will reject any sig we produce with
     *     "wrong signature: expected X but got Y".  These funds are
     *     PERMANENTLY UNRECOVERABLE.  We surface a console.warn so the user
     *     knows the balance is gone, and proceed with the signable subset
     *     instead of letting the whole import fail.
     */
    async importToCChain(sourceChain: ExportChainsC, fee: BN, utxoSet?: EVMUTXOSet): Promise<string> {
        if (!utxoSet) {
            utxoSet = await this.evmGetAtomicUTXOs(sourceChain)
        }

        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        const hrp = ava.getHRP()
        const xpStyleBech = this.getEvmAddressBech()
        const evmBytesBech = this.getEvmBytesAddressBech()

        let signableCount = 0
        let strandedCount = 0
        let strandedTotal = new BN(0)
        for (const u of utxoSet.getAllUTXOs()) {
            const ownerStrs = (u.getOutput().getAddresses() as any[]).map((a: any) =>
                bintools.addressToString(hrp, 'C', a)
            )
            if (ownerStrs.includes(xpStyleBech)) {
                signableCount++
            } else if (ownerStrs.includes(evmBytesBech)) {
                strandedCount++
                const out = u.getOutput() as any
                if (typeof out.getAmount === 'function') {
                    strandedTotal = strandedTotal.add(out.getAmount() as BN)
                }
            }
        }

        if (strandedCount > 0) {
            const msg =
                `Detected ${strandedCount} stranded atomic UTXO(s) totaling ` +
                `${strandedTotal.toString(10)} nAVAX at the EVM-bytes (keccak256) form of ` +
                `your C-chain address (${evmBytesBech}). These are PERMANENTLY ` +
                `UNRECOVERABLE: AvalancheGo's atomic-tx verifier recomputes ` +
                `ripemd160(sha256(pk)) from the signature, but the UTXO owner is ` +
                `keccak256-derived — no key can hash to both forms. An older build of ` +
                `this app produced this destination on X→C / P→C exports.`
            if (signableCount === 0) {
                throw new Error(msg + ' No signable UTXOs found to import.')
            }
            console.warn('[importToCChain]', msg, '— continuing with signable UTXOs only.')
        }

        if (signableCount === 0) {
            throw new Error('Nothing to import.')
        }

        const unsignedTxFee = await this.createImportTxC(sourceChain, utxoSet, fee)
        const tx = await this.signC(unsignedTxFee)
        return this.issueC(tx)
    }

    async signEvm(tx: Transaction) {
        const keyBuff = Buffer.from(this.ethKey, 'hex')
        return tx.sign(keyBuff)
    }

    async signHashByExternalIndex(index: number, hash: BufferAvalanche) {
        const key = this.externalHelper.getKeyForIndex(index) as AVMKeyPair
        const signed = key.sign(hash)
        return bintools.cb58Encode(signed)
    }

    async createNftFamily(name: string, symbol: string, groupNum: number) {
        return await WalletHelper.createNftFamily(this, name, symbol, groupNum)
    }

    async mintNft(mintUtxo: AVMUTXO, payload: PayloadBase, quantity: number) {
        return await WalletHelper.mintNft(this, mintUtxo, payload, quantity)
    }
}
