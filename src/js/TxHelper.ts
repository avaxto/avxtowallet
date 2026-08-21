import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { ITransaction } from '@/components/wallet/transfer/types'
import { BN, Buffer } from '@/avalanche'
import {
    AssetAmountDestination,
    BaseTx,
    MinterSet,
    NFTMintOutput,
    SECPTransferOutput,
    TransferableInput,
    TransferableOutput,
    UnsignedTx as AVMUnsignedTx,
    UTXO as AVMUTXO,
    UTXOSet,
    UTXOSet as AVMUTXOSet,
    AVMConstants,
} from '@/avalanche/apis/avm'

import { PayloadBase } from '@/avalanche/utils'
import { OutputOwners } from '@/avalanche/common'
import { PlatformVMConstants } from '@/avalanche/apis/platformvm'

import { UnsignedTx as EVMUnsignedTx, EVMConstants } from '@/avalanche/apis/evm'

import { web3 } from '@/evm'
import ERC721Token from '@/js/ERC721Token'
import { Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'
import Erc20Token from '@/js/Erc20Token'

export async function buildUnsignedTransaction(
    orders: (ITransaction | AVMUTXO)[],
    addr: string,
    derivedAddresses: string[],
    utxoset: AVMUTXOSet,
    changeAddress?: string,
    memo?: Buffer
) {
    // TODO: Get new change index.
    if (!changeAddress) {
        throw 'Unable to issue transaction. Ran out of change index.'
    }

    const fromAddrsStr: string[] = derivedAddresses
    const fromAddrs: Buffer[] = fromAddrsStr.map((val) => bintools.parseAddress(val, 'X'))
    const changeAddr: Buffer = bintools.stringToAddress(changeAddress)

    // TODO: use internal asset ID
    // This does not update on network change, causing issues
    const AVAX_ID_BUF = await avm.getAVAXAssetID()
    const AVAX_ID_STR = AVAX_ID_BUF.toString('hex')
    const TO_BUF = bintools.stringToAddress(addr)

    const aad: AssetAmountDestination = new AssetAmountDestination([TO_BUF], fromAddrs, [
        changeAddr,
    ])
    const ZERO = new BN(0)
    let isFeeAdded = false

    // Aggregate Fungible ins & outs
    for (let i: number = 0; i < orders.length; i++) {
        const order: ITransaction | AVMUTXO = orders[i]

        if ((order as ITransaction).asset) {
            // if fungible
            const tx: ITransaction = order as ITransaction

            const assetId = bintools.cb58Decode(tx.asset.id)
            const amt: BN = tx.amount

            if (assetId.toString('hex') === AVAX_ID_STR) {
                aad.addAssetAmount(assetId, amt, avm.getTxFee())
                isFeeAdded = true
            } else {
                aad.addAssetAmount(assetId, amt, ZERO)
            }
        }
    }

    // If fee isn't added, add it
    if (!isFeeAdded) {
        if (avm.getTxFee().gt(ZERO)) {
            aad.addAssetAmount(AVAX_ID_BUF, ZERO, avm.getTxFee())
        }
    }

    const success: Error = utxoset.getMinimumSpendable(aad)

    let ins: TransferableInput[] = []
    let outs: TransferableOutput[] = []
    if (typeof success === 'undefined') {
        ins = aad.getInputs()
        outs = aad.getAllOutputs()
    } else {
        throw success
    }

    //@ts-ignore
    const nftUtxos: UTXO[] = orders.filter((val) => {
        if ((val as ITransaction).asset) return false
        return true
    })

    // If transferring an NFT, build the transaction on top of an NFT tx
    let unsignedTx: AVMUnsignedTx
    const networkId: number = ava.getNetworkID()
    const chainId: Buffer = bintools.cb58Decode(avm.getBlockchainID())

    if (nftUtxos.length > 0) {
        const nftSet = new AVMUTXOSet()
        nftSet.addArray(nftUtxos)

        const utxoIds: string[] = nftSet.getUTXOIDs()

        // Sort nft utxos
        utxoIds.sort((a, b) => {
            if (a < b) {
                return -1
            } else if (a > b) {
                return 1
            }
            return 0
        })

        unsignedTx = nftSet.buildNFTTransferTx(
            networkId,
            chainId,
            [TO_BUF],
            fromAddrs,
            fromAddrs, // change address should be something else?
            utxoIds,
            undefined,
            undefined,
            memo
        )

        const rawTx = unsignedTx.getTransaction()
        const outsNft = rawTx.getOuts()
        const insNft = rawTx.getIns()

        // TODO: This is a hackish way of doing this, need methods in avalanche.js
        //@ts-ignore
        rawTx.outs = outsNft.concat(outs)
        //@ts-ignore
        rawTx.ins = insNft.concat(ins)
    } else {
        const baseTx: BaseTx = new BaseTx(networkId, chainId, outs, ins, memo)
        unsignedTx = new AVMUnsignedTx(baseTx)
    }
    return unsignedTx
}

/**
 * A single destination in a batch (multi-recipient) X-chain transfer:
 * one address receiving one amount of one fungible asset.
 */
export interface IBatchRecipient {
    address: string
    asset: { id: string }
    amount: BN
}

/**
 * Builds a single X-chain transaction paying multiple recipients, each with
 * their own amount/asset. Unlike buildUnsignedTransaction (which sends all
 * orders to one address), this creates one output per recipient.
 *
 * Coin selection is delegated to getMinimumSpendable: we ask the AAD to cover
 * the summed per-asset totals (plus the AVAX fee) and keep only the selected
 * inputs and change outputs, then substitute our own per-recipient outputs.
 * The input/output value balance holds because the recipient outputs sum to
 * exactly the totals the AAD was asked to spend.
 */
export async function buildMultiRecipientTransaction(
    recipients: IBatchRecipient[],
    derivedAddresses: string[],
    utxoset: AVMUTXOSet,
    changeAddress?: string,
    memo?: Buffer
): Promise<AVMUnsignedTx> {
    if (!changeAddress) {
        throw 'Unable to issue transaction. Ran out of change index.'
    }
    if (recipients.length === 0) {
        throw new Error('No recipients provided.')
    }

    const fromAddrs: Buffer[] = derivedAddresses.map((val) => bintools.parseAddress(val, 'X'))
    const changeAddr: Buffer = bintools.stringToAddress(changeAddress)

    const AVAX_ID_BUF = await avm.getAVAXAssetID()
    const AVAX_ID_STR = AVAX_ID_BUF.toString('hex')
    const ZERO = new BN(0)
    const fee = avm.getTxFee()

    // Sum the required amount per asset across all recipients.
    const totals: { [assetHex: string]: BN } = {}
    for (const r of recipients) {
        const key = bintools.cb58Decode(r.asset.id).toString('hex')
        totals[key] = (totals[key] ?? new BN(0)).add(r.amount)
    }

    // The AAD destination is irrelevant here — its destination outputs are
    // discarded — so point it at the change address. It is used purely for
    // input selection and change calculation.
    const aad: AssetAmountDestination = new AssetAmountDestination([changeAddr], fromAddrs, [
        changeAddr,
    ])
    let isFeeAdded = false
    for (const key of Object.keys(totals)) {
        const assetId = Buffer.from(key, 'hex')
        if (key === AVAX_ID_STR) {
            aad.addAssetAmount(assetId, totals[key], fee)
            isFeeAdded = true
        } else {
            aad.addAssetAmount(assetId, totals[key], ZERO)
        }
    }
    if (!isFeeAdded && fee.gt(ZERO)) {
        aad.addAssetAmount(AVAX_ID_BUF, ZERO, fee)
    }

    const success: Error = utxoset.getMinimumSpendable(aad)
    if (typeof success !== 'undefined') {
        throw success
    }

    const ins: TransferableInput[] = aad.getInputs()
    const changeOuts: TransferableOutput[] = aad.getChangeOutputs()

    // One output per recipient.
    const recipientOuts: TransferableOutput[] = recipients.map((r) => {
        const assetId = bintools.cb58Decode(r.asset.id)
        const toBuf = bintools.stringToAddress(r.address)
        const out = new SECPTransferOutput(r.amount, [toBuf], ZERO, 1)
        return new TransferableOutput(assetId, out)
    })

    const outs: TransferableOutput[] = [...recipientOuts, ...changeOuts]

    const networkId: number = ava.getNetworkID()
    const chainId: Buffer = bintools.cb58Decode(avm.getBlockchainID())
    // BaseTx sorts ins/outs into canonical order internally.
    const baseTx: BaseTx = new BaseTx(networkId, chainId, outs, ins, memo)
    return new AVMUnsignedTx(baseTx)
}

export async function buildCreateNftFamilyTx(
    name: string,
    symbol: string,
    groupNum: number,
    fromAddrs: string[],
    minterAddr: string,
    changeAddr: string,
    utxoSet: UTXOSet
) {
    const fromAddresses = fromAddrs
    const changeAddress = changeAddr
    const minterAddress = minterAddr

    const minterSets: MinterSet[] = []

    // Create the groups
    for (let i = 0; i < groupNum; i++) {
        const minterSet: MinterSet = new MinterSet(1, [minterAddress])
        minterSets.push(minterSet)
    }

    const unsignedTx: AVMUnsignedTx = await avm.buildCreateNFTAssetTx(
        utxoSet,
        fromAddresses,
        [changeAddress],
        minterSets,
        name,
        symbol
    )
    return unsignedTx
}

export async function buildMintNftTx(
    mintUtxo: AVMUTXO,
    payload: PayloadBase,
    quantity: number,
    ownerAddress: string,
    changeAddress: string,
    fromAddresses: string[],
    utxoSet: UTXOSet
): Promise<AVMUnsignedTx> {
    const addrBuf = bintools.parseAddress(ownerAddress, 'X')
    const owners = []

    const sourceAddresses = fromAddresses

    for (let i = 0; i < quantity; i++) {
        const owner = new OutputOwners([addrBuf])
        owners.push(owner)
    }

    const groupID = (mintUtxo.getOutput() as NFTMintOutput).getGroupID()

    const mintTx = await avm.buildCreateNFTMintTx(
        utxoSet,
        owners,
        sourceAddresses,
        [changeAddress],
        mintUtxo.getUTXOID(),
        groupID,
        payload
    )
    return mintTx
}

export async function buildEvmTransferNativeTx(
    from: string,
    to: string,
    amount: BN, // in wei
    gasPrice: BN,
    gasLimit: number,
    nonce?: number,
    // Hex-encoded memo bytes — see evm/memo.ts. A native transfer's `data`
    // otherwise carries nothing, unlike an ERC20/NFT send where it IS the
    // call itself, which is why this exists only here.
    data: string = '0x'
) {
    // 'pending' (not the default 'latest') includes this account's own
    // not-yet-mined transactions, and an explicit nonce lets callers
    // sequence several sends in a row (e.g. Wallet Wizard's batch
    // migration) without re-querying the RPC between each one.
    if (nonce === undefined) {
        nonce = await web3.eth.getTransactionCount(from, 'pending')
    }
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    const tx = new Transaction(
        {
            nonce: nonce,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            to: to,
            value: amount,
            data: data,
        },
        chainParams
    )
    return tx
}

export async function buildEvmTransferErc20Tx(
    from: string,
    to: string,
    amount: BN, // in wei
    gasPrice: BN,
    gasLimit: number,
    token: Erc20Token,
    nonce?: number
) {
    // See buildEvmTransferNativeTx — 'pending' + explicit nonce avoid nonce
    // races when sending several transactions in a row.
    if (nonce === undefined) {
        nonce = await web3.eth.getTransactionCount(from, 'pending')
    }
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    const tokenTx = token.createTransferTx(to, amount)

    const tx = new Transaction(
        {
            nonce: nonce,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            value: '0x0',
            to: token.data.address,
            data: tokenTx.encodeABI(),
        },
        chainParams
    )
    return tx
}

export async function buildEvmTransferErc721Tx(
    from: string,
    to: string,
    gasPrice: BN,
    gasLimit: number,
    token: ERC721Token,
    tokenId: string,
    nonce?: number
) {
    // See buildEvmTransferNativeTx — 'pending' + explicit nonce avoid nonce
    // races when sending several transactions in a row.
    if (nonce === undefined) {
        nonce = await web3.eth.getTransactionCount(from, 'pending')
    }
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    const tokenTx = token.createTransferTx(from, to, tokenId)

    const tx = new Transaction(
        {
            nonce: nonce,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            value: '0x0',
            to: token.data.address,
            data: tokenTx.encodeABI(),
        },
        chainParams
    )
    return tx
}

export enum AvmTxNameEnum {
    'Transaction' = AVMConstants.BASETX,
    'Mint' = AVMConstants.CREATEASSETTX,
    'Operation' = AVMConstants.OPERATIONTX,
    'Import' = AVMConstants.IMPORTTX,
    'Export' = AVMConstants.EXPORTTX,
}

export enum PlatfromTxNameEnum {
    'Transaction' = PlatformVMConstants.BASETX,
    'Add Validator (Legacy)' = PlatformVMConstants.ADDVALIDATORTX, // Deprecated in ACP-62
    'Add Delegator (Legacy)' = PlatformVMConstants.ADDDELEGATORTX, // Deprecated in ACP-62
    // Note: Add these constants when AvalancheJS is updated for ACP-62
    // 'Add Permissionless Validator' = PlatformVMConstants.ADDPERMISSIONLESSVALIDATORTX,
    // 'Add Permissionless Delegator' = PlatformVMConstants.ADDPERMISSIONLESSDELEGATORTX,
    'Import' = PlatformVMConstants.IMPORTTX,
    'Export' = PlatformVMConstants.EXPORTTX,
    'Add Subnet Validator' = PlatformVMConstants.ADDSUBNETVALIDATORTX,
    'Create Chain' = PlatformVMConstants.CREATECHAINTX,
    'Create Subnet' = PlatformVMConstants.CREATESUBNETTX,
    'Advance Time' = PlatformVMConstants.ADVANCETIMETX,
    'Reward Validator' = PlatformVMConstants.REWARDVALIDATORTX,
}

// TODO: create asset transactions
export enum ParseableAvmTxEnum {
    'Transaction' = AVMConstants.BASETX,
    'Import' = AVMConstants.IMPORTTX,
    'Export' = AVMConstants.EXPORTTX,
}

export enum ParseablePlatformEnum {
    'Transaction' = PlatformVMConstants.BASETX,
    'Add Validator' = PlatformVMConstants.ADDVALIDATORTX,
    'Add Delegator' = PlatformVMConstants.ADDDELEGATORTX,
    'Import' = PlatformVMConstants.IMPORTTX,
    'Export' = PlatformVMConstants.EXPORTTX,
}

export enum ParseableEvmTxEnum {
    'Import' = EVMConstants.IMPORTTX,
    'Export' = EVMConstants.EXPORTTX,
}

/**
 * A destination output owned jointly by several addresses.
 *
 * `threshold` of `owners` must sign to spend it. Both are validated at the
 * call site rather than trusted: `OutputOwners` accepts any threshold without
 * checking it against the address count (the SDK's own guard lives only in
 * `buildBaseTx`, which this path does not use), so an unchecked value here
 * would build a permanently unspendable UTXO that the node still accepts.
 */
export interface IMultisigDestination {
    owners: string[]
    threshold: number
    asset: { id: string }
    amount: BN
}

/** What a multisig send needs to travel to its co-signers. */
export interface MultisigBuildResult {
    unsignedTx: AVMUnsignedTx
    /** The UTXOs this transaction spends, for the PSAT envelope. */
    sourceUtxos: AVMUTXO[]
}

/**
 * Builds an X-chain transaction paying into one multi-owner output.
 *
 * Deliberately parallel to `buildMultiRecipientTransaction` above, and for
 * the same reason: the AssetAmountDestination is used purely for input
 * selection and change, its own destination outputs are discarded, and the
 * real output is substituted. Value balances because the substituted output
 * carries exactly the amount the AAD was asked to spend.
 *
 * Note what this transaction is and is not. It SPENDS the sender's ordinary
 * single-signature UTXOs — so the sender alone can sign it and it is complete
 * the moment they do. The multisig applies to the output it creates: it is
 * the *next* transaction, the one spending that output, that will need M
 * signatures and travel between owners as a genuine PSAT.
 */
export async function buildMultisigTransaction(
    destination: IMultisigDestination,
    derivedAddresses: string[],
    utxoset: AVMUTXOSet,
    changeAddress?: string,
    memo?: Buffer
): Promise<MultisigBuildResult> {
    if (!changeAddress) {
        throw new Error('Unable to issue transaction. Ran out of change index.')
    }
    const ownerBufs = destination.owners.map((addr) => bintools.parseAddress(addr, 'X'))
    if (ownerBufs.some((b) => !b)) {
        throw new Error('One of the owner addresses is not a valid X-chain address.')
    }
    // Duplicates would let one key satisfy several slots, quietly making an
    // "M-of-N" spendable by fewer than M distinct people.
    const unique = new Set(destination.owners.map((a) => a.trim()))
    if (unique.size !== destination.owners.length) {
        throw new Error('Owner addresses must all be different.')
    }
    if (
        !Number.isInteger(destination.threshold) ||
        destination.threshold < 1 ||
        destination.threshold > ownerBufs.length
    ) {
        throw new Error(`Threshold must be a whole number between 1 and ${ownerBufs.length}.`)
    }
    if (destination.amount.lte(new BN(0))) {
        throw new Error('Amount must be greater than zero.')
    }

    const fromAddrs: Buffer[] = derivedAddresses.map((val) => bintools.parseAddress(val, 'X'))
    const changeAddr: Buffer = bintools.stringToAddress(changeAddress)

    const AVAX_ID_BUF = await avm.getAVAXAssetID()
    const AVAX_ID_STR = AVAX_ID_BUF.toString('hex')
    const ZERO = new BN(0)
    const fee = avm.getTxFee()

    const assetKey = bintools.cb58Decode(destination.asset.id).toString('hex')

    const aad: AssetAmountDestination = new AssetAmountDestination([changeAddr], fromAddrs, [
        changeAddr,
    ])
    if (assetKey === AVAX_ID_STR) {
        aad.addAssetAmount(AVAX_ID_BUF, destination.amount, fee)
    } else {
        aad.addAssetAmount(bintools.cb58Decode(destination.asset.id), destination.amount, ZERO)
        if (fee.gt(ZERO)) aad.addAssetAmount(AVAX_ID_BUF, ZERO, fee)
    }

    const success: Error = utxoset.getMinimumSpendable(aad)
    if (typeof success !== 'undefined') {
        throw success
    }

    const ins: TransferableInput[] = aad.getInputs()
    const changeOuts: TransferableOutput[] = aad.getChangeOutputs()

    // The multi-owner destination. `OutputOwners` sorts addresses into
    // canonical byte order internally, so the on-wire owner order is not the
    // order they were typed in — anything mapping an owner to a signature
    // slot must go through `getAddressIdx`, never the form's ordering.
    const multisigOut = new SECPTransferOutput(
        destination.amount,
        ownerBufs as Buffer[],
        ZERO,
        destination.threshold
    )
    const outs: TransferableOutput[] = [
        new TransferableOutput(bintools.cb58Decode(destination.asset.id), multisigOut),
        ...changeOuts,
    ]

    // Every input's source UTXO, so the shared transaction can show its
    // co-signers what is being spent and by whom — a TransferableInput does
    // not carry its output's owner list.
    const sourceUtxos: AVMUTXO[] = []
    for (const input of ins) {
        const utxo = utxoset.getUTXO(input.getUTXOID())
        if (utxo) sourceUtxos.push(utxo as AVMUTXO)
    }

    const networkId: number = ava.getNetworkID()
    const chainId: Buffer = bintools.cb58Decode(avm.getBlockchainID())
    const baseTx: BaseTx = new BaseTx(networkId, chainId, outs, ins, memo)
    return { unsignedTx: new AVMUnsignedTx(baseTx), sourceUtxos }
}
