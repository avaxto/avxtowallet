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
    ethAddressBech: string

    stakeAmount: BN

    private walletClient: WalletClient
    private provider: any

    constructor(provider: any, evmAddress: string) {
        super()

        this.provider = provider
        // Store the EVM address without '0x' prefix (matching other wallet types)
        this.ethAddress = evmAddress.toLowerCase().replace('0x', '')
        this.ethAddressBech = '' // Injected wallets don't have bech32 C-chain addresses

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
        return wallet
    }

    // ---- Address methods ----
    // Injected wallets are EVM-only; X/P chain addresses are not available.

    getCurrentAddressAvm(): string {
        // Injected wallets don't have AVM addresses
        return ''
    }

    getChangeAddressAvm(): string {
        return ''
    }

    getCurrentAddressPlatform(): string {
        return ''
    }

    getAllExternalAddressesX(): string[] {
        return []
    }

    getAllChangeAddressesX(): string[] {
        return []
    }

    getDerivedAddresses(): string[] {
        return []
    }

    getDerivedAddressesP(): string[] {
        return []
    }

    getAllDerivedExternalAddresses(): string[] {
        return []
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
        return this.ethAddressBech
    }

    getAllAddressesX(): string[] {
        return []
    }

    getAllAddressesP(): string[] {
        return []
    }

    // ---- UTXO management ----
    // Injected wallets are primarily EVM; X/P UTXO sets remain empty.

    async getUTXOs(): Promise<void> {
        this.isFetchUtxos = true
        await this.getEthBalance()
        this.isFetchUtxos = false
    }

    // ---- Transaction building ----

    async buildUnsignedTransaction(
        orders: (ITransaction | UTXO)[],
        addr: string,
        memo?: BufferAvalanche
    ) {
        throw new Error('X-chain transactions are not supported with injected wallets.')
    }

    async issueBatchTx(
        orders: (ITransaction | AVMUTXO)[],
        addr: string,
        memo: BufferAvalanche | undefined
    ): Promise<string> {
        throw new Error('X-chain batch transactions are not supported with injected wallets.')
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

    async signX(unsignedTx: AVMUnsignedTx): Promise<AVMTx> {
        throw new Error('X-chain signing is not supported with injected wallets.')
    }

    async signP(unsignedTx: PlatformUnsignedTx): Promise<PlatformTx> {
        throw new Error('P-chain signing is not supported with injected wallets.')
    }

    async signC(unsignedTx: EVMUnsignedTx): Promise<EvmTx> {
        throw new Error(
            'Avalanche C-chain atomic signing is not supported with injected wallets.'
        )
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

    // ---- Cross-chain operations (not supported) ----

    async exportFromXChain(amt: BN, destinationChain: ExportChainsX): Promise<string> {
        throw new Error('Cross-chain exports are not supported with injected wallets.')
    }

    async exportFromPChain(amt: BN, destinationChain: ExportChainsP): Promise<string> {
        throw new Error('Cross-chain exports are not supported with injected wallets.')
    }

    async exportFromCChain(
        amt: BN,
        destinationChain: ExportChainsC,
        baseFee: BN
    ): Promise<string> {
        throw new Error('Cross-chain exports are not supported with injected wallets.')
    }

    async importToPlatformChain(sourceChain: ExportChainsP): Promise<string> {
        throw new Error('Cross-chain imports are not supported with injected wallets.')
    }

    async importToXChain(sourceChain: ExportChainsX): Promise<string> {
        throw new Error('Cross-chain imports are not supported with injected wallets.')
    }

    async importToCChain(
        sourceChain: ExportChainsC,
        baseFee: BN,
        utxoSet?: EVMUTXOSet
    ): Promise<string> {
        throw new Error('Cross-chain imports are not supported with injected wallets.')
    }

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
}

export { InjectedWallet }
