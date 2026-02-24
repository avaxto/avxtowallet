/**
 * Consolidated type definitions previously spread across src/store/modules/*/types.ts
 */

import Big from 'big.js'
import { BN, Buffer } from '@/avalanche'
import AvaAsset from '@/js/AvaAsset'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import { UTXO as AVMUTXO } from '@/avalanche/apis/avm/utxos'
import { WalletNameType } from '@/js/wallets/types'
import { AllKeyFileTypes, AllKeyFileDecryptedTypes } from '@/js/IKeystore'
import { ITransaction } from '@/components/wallet/transfer/types'
import { PChainTransaction } from '@avalabs/glacier-sdk'

// ---- Root / Wallet types ----

export interface priceDict {
    usd: number
}

export interface IWalletNftDict {
    [assetId: string]: AVMUTXO[]
}

export interface IWalletBalanceDict {
    [assetId: string]: {
        available: BN
        locked: BN
        multisig: BN
    }
}

export interface IWalletBalanceItem {
    id: string
    amount: BN
}

export interface IWalletAssetsDict {
    [assetId: string]: AvaAsset
}

export interface IWalletNftMintDict {
    [assetId: string]: AVMUTXO[]
}

export interface IssueBatchTxInput {
    toAddress: string
    memo?: Buffer
    orders: (ITransaction | AVMUTXO)[]
}

export interface ImportKeyfileInput {
    password: string
    data: AllKeyFileTypes
}

export interface ExportWalletsInput {
    password: string
    wallets: any[]
}

export interface AccessWalletMultipleInput {
    type: Extract<'mnemonic' | 'singleton', WalletNameType>
    key: string
}

export interface SaveAccountInput {
    password: string
    accountName: string
}

export interface iUserAccountEncrypted {
    name: string
    baseAddresses: string[]
    wallet: AllKeyFileTypes
}

export interface iUserAccountDecrypted {
    name: string
    baseAddresses: string[]
    wallet: AllKeyFileDecryptedTypes
}

// ---- Assets types ----

export interface NftFamilyDict {
    [id: string]: AvaNftFamily
}

export interface AssetsDict {
    [key: string]: AvaAsset
}

export interface TokenListToken {
    address: string
    chainId: number
    name: string
    symbol: string
    decimals: number | string
    logoURI: string
}

export interface TokenList {
    name: string
    logoURI: string
    keywords: string[]
    timestamp: string
    url: string
    readonly: boolean
    version: {
        major: number
        minor: number
        patch: number
    }
    tokens: TokenListToken[]
}

export interface AddTokenListInput {
    url: string
    readonly: boolean
}

// ---- ERC721 types (also exported from @/stores/erc721) ----

export interface ERC721WalletBalance {
    [contractAddress: string]: string[]
}

export interface ERC721TokenInput {
    address: string
    chainId: number
    name: string
    symbol: string
}

// ---- Platform / Validator types ----

export interface ValidatorListItem {
    nodeID: string
    validatorStake: BN
    delegatedStake: BN
    remainingStake: BN
    numDelegators: number
    startTime: Date
    endTime: Date
    uptime: number
    fee: number
}

// ---- History types ----

/** UTXO as returned by the indexer/explorer API (not the AVM UTXO SDK object) */
export interface UTXO {
    addresses: string[]
    amount: string
    assetID: string
    chainID: string
    groupID: number
    id: string
    locktime: number
    payload?: string
    outputIndex: number
    outputType: number
    redeemingTransactionID: string
    rewardUtxo: boolean
    stake?: boolean
    threshold: number
    timestamp: string
    transactionID: string
}

export type TransactionType =
    | 'base'
    | 'create_asset'
    | 'operation'
    | 'import'
    | 'export'
    | 'add_validator'
    | 'add_subnet_validator'
    | 'add_delegator'
    | 'create_chain'
    | 'create_subnet'
    | 'pvm_import'
    | 'pvm_export'
    | 'advance_time'
    | 'reward_validator'

export interface ITransactionData {
    chainID: string
    id: string
    inputTotals: { [key: string]: string }
    inputs: any[] | null
    memo: string
    outputTotals: { [key: string]: string }
    outputs: UTXO[]
    reusedAddressTotals: null
    rewarded: boolean
    rewardedTime: string
    timestamp: string
    txFee: number
    type: TransactionType
    validatorStart: number
    validatorEnd: number
    validatorNodeID: string
}

export interface CsvRowAvaxTransferData {
    txId: string
    date: Date
    from?: string[]
    to?: string[]
    amount: Big
    memo?: string
    isGain: boolean
}

// ---- Ledger types ----

export interface ILedgerBlockMessage {
    title: string
    value: string
}

export const LEDGER_EXCHANGE_TIMEOUT = 90_000

// ---- Accounts types ----

export interface ChangePasswordInput {
    passNew: string
    passOld: string
}

// ---- Earn types ----

export interface EarnState {
    stakingTxs: PChainTransaction[]
}

// ---- Notifications types ----

export interface Notification {
    id: number
    title: string
    message: string
    color: string
    duration?: number
}

export interface NotificationInput {
    title: string
    message: string
    color?: string
    type?: string
    duration?: number
}

// ---- Network types ----

export type NetworkStatus = 'disconnected' | 'connecting' | 'connected'
