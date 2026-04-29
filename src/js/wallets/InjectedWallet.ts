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

        // Try to get X/P addresses from the provider.
        // Core App exposes avalanche_getAccountPubKey which returns { xp, evm } compressed pubkeys.
        // We derive the bech32 X/P addresses from the xp public key.
        try {
            const pubKeys: { xp?: string; evm?: string } = await provider.request({
                method: 'avalanche_getAccountPubKey',
                params: {},
            })
            if (pubKeys?.xp) {
                const hrp = getPreferredHRP(ava.getNetworkID())
                // Strip optional '0x' prefix — the key must be a 33-byte compressed secp256k1 pubkey
                const xpHex = pubKeys.xp.replace(/^0x/, '')
                const addrBuf = AVMKeyPair.addressFromPublicKey(BufferAvalanche.from(xpHex, 'hex'))
                wallet.avmAddress      = bintools.addressToString(hrp, 'X', addrBuf)
                wallet.platformAddress = bintools.addressToString(hrp, 'P', addrBuf)
            }
        } catch (err) {
            console.warn('Provider does not support avalanche_getAccountPubKey. X/P chain addresses will be unavailable.', err)
            // Provider does not support the method (e.g. MetaMask) — leave empty
        }

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

        try {
            const pubKeys: { xp?: string; evm?: string } = await provider.request({
                method: 'avalanche_getAccountPubKey',
                params: {},
            })
            if (pubKeys?.xp) {
                const hrp = getPreferredHRP(ava.getNetworkID())
                const xpHex = pubKeys.xp.replace(/^0x/, '')
                const addrBuf = AVMKeyPair.addressFromPublicKey(BufferAvalanche.from(xpHex, 'hex'))
                wallet.avmAddress      = bintools.addressToString(hrp, 'X', addrBuf)
                wallet.platformAddress = bintools.addressToString(hrp, 'P', addrBuf)
            }
        } catch (err) {
            console.warn('Provider does not support avalanche_getAccountPubKey.', err)
        }

        return wallet
    }

    // ---- Address methods ----
    // Injected wallets are EVM-only; X/P chain addresses are not available.

    getCurrentAddressAvm(): string {
        return this.avmAddress
    }

    getChangeAddressAvm(): string {
        return this.avmAddress
    }

    getCurrentAddressPlatform(): string {
        return this.platformAddress
    }

    getAllExternalAddressesX(): string[] {
        return this.avmAddress ? [this.avmAddress] : []
    }

    getAllChangeAddressesX(): string[] {
        return this.avmAddress ? [this.avmAddress] : []
    }

    getDerivedAddresses(): string[] {
        return this.avmAddress ? [this.avmAddress] : []
    }

    getDerivedAddressesP(): string[] {
        return this.platformAddress ? [this.platformAddress] : []
    }

    getAllDerivedExternalAddresses(): string[] {
        return this.avmAddress ? [this.avmAddress] : []
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
        return this.avmAddress ? [this.avmAddress] : []
    }

    getAllAddressesP(): string[] {
        return this.platformAddress ? [this.platformAddress] : []
    }

    // ---- UTXO management ----
    // Injected wallets are primarily EVM; X/P UTXO sets remain empty (check this)

    async getUTXOs(): Promise<void> {
        this.isFetchUtxos = true
        try {
            await this.getEthBalance()

            // Fetch X chain UTXOs if we have an AVM address
            if (this.avmAddress) {
                const avmAddrs = [this.avmAddress]
                this.utxoset = await avmGetAllUTXOs(avmAddrs)
            }

            // Fetch P chain UTXOs if we have a platform address
            if (this.platformAddress) {
                const platformAddrs = [this.platformAddress]
                this.platformUtxoset = await platformGetAllUTXOs(platformAddrs)
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
