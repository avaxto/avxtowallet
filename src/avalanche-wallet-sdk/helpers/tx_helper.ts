import { cChain, ethersProvider, pChain, web3, xChain, activeNetwork } from '@/avalanche-wallet-sdk/Network/network';
import { createAvalancheWalletClient } from '@avalanche-sdk/client';
import type { PrepareExportTxnReturnType } from '@avalanche-sdk/client/dist/methods/wallet/cChain/index.js';
import { defineChain } from 'viem';

import { BN, Buffer } from '@/avalanche';
import {
    AVMConstants,
    MinterSet,
    NFTMintOutput,
    UnsignedTx as AVMUnsignedTx,
    UTXO as AVMUTXO,
    UTXOSet as AVMUTXOSet,
    UTXOSet,
} from '@/avalanche/apis/avm';

import { PayloadBase } from '@/avalanche/utils';
import { OutputOwners } from '@/avalanche/common';
import { PlatformVMConstants, UTXOSet as PlatformUTXOSet } from '@/avalanche/apis/platformvm';

import { EVMConstants } from '@/avalanche/apis/evm';

import { FeeMarketEIP1559Transaction, Transaction } from '@ethereumjs/tx';
import EthereumjsCommon from '@ethereumjs/common';

import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json';
import ERC721Abi from '@openzeppelin/contracts/build/contracts/ERC721.json';
import { bintools } from '@/avalanche-wallet-sdk/common';
import { ExportChainsC, ExportChainsP, ExportChainsX } from '@/avalanche-wallet-sdk/Wallet/types';
import { chainIdFromAlias } from '@/avalanche-wallet-sdk/Network/helpers/idFromAlias';
import { getErc721TokenEthers } from '@/avalanche-wallet-sdk/Asset';

export async function buildCreateNftFamilyTx(
    name: string,
    symbol: string,
    groupNum: number,
    fromAddrs: string[],
    minterAddr: string,
    changeAddr: string,
    utxoSet: UTXOSet
) {
    let fromAddresses = fromAddrs;
    let changeAddress = changeAddr;
    let minterAddress = minterAddr;

    const minterSets: MinterSet[] = [];

    // Create the groups
    for (let i = 0; i < groupNum; i++) {
        const minterSet: MinterSet = new MinterSet(1, [minterAddress]);
        minterSets.push(minterSet);
    }

    let unsignedTx: AVMUnsignedTx = await xChain.buildCreateNFTAssetTx(
        utxoSet,
        fromAddresses,
        [changeAddress],
        minterSets,
        name,
        symbol
    );
    return unsignedTx;
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
    let addrBuf = bintools.parseAddress(ownerAddress, 'X');
    let owners = [];

    let sourceAddresses = fromAddresses;

    for (let i = 0; i < quantity; i++) {
        let owner = new OutputOwners([addrBuf]);
        owners.push(owner);
    }

    let groupID = (mintUtxo.getOutput() as NFTMintOutput).getGroupID();

    let mintTx = await xChain.buildCreateNFTMintTx(
        utxoSet,
        owners,
        sourceAddresses,
        [changeAddress],
        mintUtxo.getUTXOID(),
        groupID,
        payload
    );
    return mintTx;
}

export async function buildAvmExportTransaction(
    destinationChain: ExportChainsX,
    utxoSet: AVMUTXOSet,
    fromAddresses: string[],
    toAddress: string,
    amount: BN, // export amount + fee
    sourceChangeAddress: string
) {
    let destinationChainId = chainIdFromAlias(destinationChain);

    return await xChain.buildExportTx(utxoSet as AVMUTXOSet, amount, destinationChainId, [toAddress], fromAddresses, [
        sourceChangeAddress,
    ]);
}

export async function buildPlatformExportTransaction(
    utxoSet: PlatformUTXOSet,
    fromAddresses: string[],
    toAddress: string,
    amount: BN, // export amount + fee
    sourceChangeAddress: string,
    destinationChain: ExportChainsP
) {
    let destinationChainId = chainIdFromAlias(destinationChain);

    return await pChain.buildExportTx(utxoSet, amount, destinationChainId, [toAddress], fromAddresses, [
        sourceChangeAddress,
    ]);
}

/**
 *
 * @param fromAddresses Hex EVM addresses (with or without 0x prefix).
 * @param toAddress Destination bech32 XP address.
 * @param amount Amount to export (including import fee for destination chain), in nAVAX.
 * @param _fromAddressBech Legacy parameter, no longer used.
 * @param destinationChain Either `X` or `P`.
 * @param _fee Legacy parameter. Export fee is now auto-calculated from the network base fee.
 * @returns PrepareExportTxnReturnType from the new Avalanche SDK.
 */
export async function buildEvmExportTransaction(
    fromAddresses: string[],
    toAddress: string,
    amount: BN,
    _fromAddressBech: string,
    destinationChain: ExportChainsC,
    _fee: BN
): Promise<PrepareExportTxnReturnType> {
    const network = activeNetwork;

    const chain = defineChain({
        id: network.evmChainID,
        name: 'Avalanche',
        nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
        rpcUrls: { default: { http: [network.rpcUrl.c] } },
    });

    const walletClient = createAvalancheWalletClient({
        chain: chain as any,
        transport: { type: 'http' as const, url: network.rpcUrl.c },
    });

    const fromAddress = (fromAddresses[0].startsWith('0x')
        ? fromAddresses[0]
        : `0x${fromAddresses[0]}`) as `0x${string}`;

    return walletClient.cChain.prepareExportTxn({
        destinationChain,
        fromAddress,
        exportedOutput: {
            addresses: [toAddress],
            amount: BigInt(amount.toString()),
        },
    });
}

export async function buildEvmTransferEIP1559Tx(
    from: string,
    to: string,
    amount: BN, // in wei
    priorityFee: BN,
    maxFee: BN,
    gasLimit: number
) {
    const nonce = await web3.eth.getTransactionCount(from);
    const chainId = await web3.eth.getChainId();
    const networkId = await web3.eth.net.getId();

    const common = EthereumjsCommon.custom({ networkId, chainId });

    const tx = FeeMarketEIP1559Transaction.fromTxData(
        {
            nonce: nonce,
            maxFeePerGas: '0x' + maxFee.toString('hex'),
            maxPriorityFeePerGas: '0x' + priorityFee.toString('hex'),
            gasLimit: gasLimit,
            to: to,
            value: '0x' + amount.toString('hex'),
            data: '0x',
        },
        { common }
    );
    return tx;
}

export async function buildEvmTransferNativeTx(
    from: string,
    to: string,
    amount: BN, // in wei
    gasPrice: BN,
    gasLimit: number
) {
    const nonce = await web3.eth.getTransactionCount(from);
    const chainId = await web3.eth.getChainId();
    const networkId = await web3.eth.net.getId();

    const common = EthereumjsCommon.custom({ networkId, chainId });

    const tx = Transaction.fromTxData(
        {
            nonce: nonce,
            gasPrice: '0x' + gasPrice.toString('hex'),
            gasLimit: gasLimit,
            to: to,
            value: '0x' + amount.toString('hex'),
            data: '0x',
        },
        { common }
    );
    return tx;
}

export async function buildCustomEvmTx(
    from: string,
    gasPrice: BN,
    gasLimit: number,
    data?: string,
    to?: string,
    value?: string,
    nonce?: number
): Promise<Transaction> {
    if (typeof nonce === 'undefined') {
        nonce = await web3.eth.getTransactionCount(from);
    }

    const chainId = await web3.eth.getChainId();
    const networkId = await web3.eth.net.getId();

    const chainParams = {
        common: EthereumjsCommon.forCustomChain('mainnet', { networkId, chainId }, 'istanbul'),
    };

    let gasPriceHex = `0x${gasPrice.toString('hex')}`;

    let tx = Transaction.fromTxData(
        {
            nonce,
            gasPrice: gasPriceHex,
            gasLimit,
            value,
            to,
            data,
        },
        chainParams
    );
    return tx;
}

export async function buildEvmTransferErc20Tx(
    from: string,
    to: string,
    amount: BN, // in wei
    gasPrice: BN,
    gasLimit: number,
    contractAddress: string
) {
    //@ts-ignore
    const cont = new web3.eth.Contract(ERC20Abi.abi, contractAddress);
    const tokenTx = cont.methods.transfer(to, amount.toString());

    let data = tokenTx.encodeABI();

    let tx = await buildCustomEvmTx(from, gasPrice, gasLimit, data, contractAddress);

    return tx;
}

export async function buildEvmTransferErc721Tx(
    from: string,
    to: string,
    gasPrice: BN,
    gasLimit: number,
    tokenContract: string,
    tokenId: number
) {
    const nonce = await web3.eth.getTransactionCount(from);
    const chainId = await web3.eth.getChainId();
    const networkId = await web3.eth.net.getId();
    const chainParams = {
        common: EthereumjsCommon.forCustomChain('mainnet', { networkId, chainId }, 'istanbul'),
    };
    // @ts-ignore
    const contract = new web3.eth.Contract(ERC721Abi.abi, tokenContract);
    const tokenTx = contract.methods['safeTransferFrom(address,address,uint256)'](from, to, tokenId);

    let tx = Transaction.fromTxData(
        {
            nonce: nonce,
            gasPrice: '0x' + gasPrice.toString('hex'),
            gasLimit: gasLimit,
            value: '0x0',
            to: tokenContract,
            data: tokenTx.encodeABI(),
        },
        chainParams
    );
    return tx;
}

export async function estimateErc20Gas(tokenContract: string, from: string, to: string, value: BN) {
    //@ts-ignore
    const contract = new web3.eth.Contract(ERC20Abi.abi, tokenContract);
    const tokenTx = contract.methods.transfer(to, value.toString());
    return await tokenTx.estimateGas({
        from: from,
    });
}

/**
 * Estimate the gas limit for the ERC721 `safeTransferFrom(address,address,uint256)` method.
 * @param contract
 * @param from
 * @param to
 * @param tokenID
 */
export async function estimateErc721TransferGas(contract: string, from: string, to: string, tokenID: number) {
    let c = getErc721TokenEthers(contract);
    c = c.connect(ethersProvider);
    const gas = await c.estimateGas['safeTransferFrom(address,address,uint256)'](from, to, tokenID);
    return gas.toNumber();
}

/**
 * Estimates the gas needed to send AVAX
 * @param to Destination address
 * @param amount Amount of AVAX to send, given in WEI
 * @param gasPrice Given in WEI
 */
export async function estimateAvaxGas(from: string, to: string, amount: BN, gasPrice: BN): Promise<number> {
    try {
        return await web3.eth.estimateGas({
            from,
            to,
            gasPrice: `0x${gasPrice.toString('hex')}`,
            value: `0x${amount.toString('hex')}`,
        });
    } catch (e) {
        // TODO: Throws an error if we do not have enough avax balance
        //TODO: Is it ok to return 21000
        return 21000;
    }
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
    'Add Validator' = PlatformVMConstants.ADDVALIDATORTX,
    'Add Delegator' = PlatformVMConstants.ADDDELEGATORTX,
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
