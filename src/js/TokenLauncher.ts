/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
  TokenLauncher - deploys a parameterized OpenZeppelin ERC20 (the
  AVXTOLaunchToken template) to the Avalanche C-Chain via RPC.

  The Solidity template lives in /contracts/AVXTOLaunchToken.sol and is
  pre-compiled into src/avxto/contracts/AVXTOLaunchToken.json by
  `npm run compile:contracts`. Here we ABI-encode the constructor arguments,
  append them to the creation bytecode, sign the deployment transaction with
  the active wallet, broadcast it, and report the resulting contract address.
*/
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { Transaction } from '@ethereumjs/tx'
import Common from '@ethereumjs/common'
import { AvaWalletCore } from '@/js/wallets/types'
import artifact from '@/avxto/contracts/AVXTOLaunchToken.json'

export interface TokenLaunchParams {
    name: string
    symbol: string
    decimals: number
    // Human-readable amounts (whole tokens), scaled by 10**decimals internally.
    initialSupply: string
    maxSupply: string
}

export interface TokenLaunchResult {
    txHash: string
    contractAddress: string
}

const MAX_DEPLOY_GAS = 6_000_000

/**
 * Scale a human-readable decimal amount (e.g. "1000.5") into base units as a
 * BN, given the token's decimals. Throws on malformed input.
 */
export function toBaseUnits(amount: string, decimals: number): BN {
    const trimmed = (amount || '').trim()
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid amount: "${amount}"`)
    }
    const [whole, fraction = ''] = trimmed.split('.')
    if (fraction.length > decimals) {
        throw new Error(`Amount has more than ${decimals} decimal places`)
    }
    const padded = fraction.padEnd(decimals, '0')
    // Strip leading zeros to keep BN happy, but keep at least one digit.
    const combined = (whole + padded).replace(/^0+(?=\d)/, '')
    return new BN(combined || '0')
}

/**
 * Build the contract-creation calldata: creation bytecode followed by the
 * ABI-encoded constructor arguments.
 */
function encodeDeployData(params: TokenLaunchParams): string {
    const decimals = params.decimals
    const initial = toBaseUnits(params.initialSupply, decimals)
    const cap = toBaseUnits(params.maxSupply, decimals)

    if (cap.isZero()) {
        throw new Error('Max supply must be greater than zero')
    }
    if (initial.gt(cap)) {
        throw new Error('Initial supply cannot exceed max supply')
    }

    const ctorInputs = (artifact.abi as any[]).find((x) => x.type === 'constructor').inputs
    const encodedArgs = web3.eth.abi.encodeParameters(
        ctorInputs.map((i: any) => i.type),
        [params.name, params.symbol, decimals, initial.toString(), cap.toString()]
    )
    // encodeParameters returns a 0x-prefixed string; strip it before appending.
    return artifact.bytecode + encodedArgs.slice(2)
}

/**
 * Estimate gas for the deployment, padded by 20% and capped.
 */
async function estimateDeployGas(from: string, data: string): Promise<number> {
    try {
        const est = await web3.eth.estimateGas({ from, data })
        return Math.min(Math.round(Number(est) * 1.2), MAX_DEPLOY_GAS)
    } catch (e) {
        // Fall back to a safe ceiling if estimation reverts (e.g. node quirk).
        return MAX_DEPLOY_GAS
    }
}

/**
 * Deploy the ERC20 to the C-Chain. Returns the tx hash and the new contract
 * address. Supports locally-signing wallets (mnemonic/singleton/ledger) and
 * injected browser wallets.
 */
export async function deployToken(
    wallet: AvaWalletCore,
    params: TokenLaunchParams,
    gasPrice: BN
): Promise<TokenLaunchResult> {
    const fromAddr = '0x' + wallet.getEvmAddress()
    const data = encodeDeployData(params)
    const gasLimit = await estimateDeployGas(fromAddr, data)

    // Injected wallets sign and broadcast through their own provider.
    if (wallet.type === 'injected') {
        return deployViaInjected(wallet, data, gasPrice, gasLimit)
    }

    const nonce = await web3.eth.getTransactionCount(fromAddr, 'pending')
    const chainId = await web3.eth.getChainId()
    const networkId = await web3.eth.net.getId()
    const chainParams = {
        common: Common.forCustomChain('mainnet', { networkId, chainId }, 'istanbul') as any,
    }

    // Contract creation: omit `to`.
    const tx = new Transaction(
        {
            nonce: nonce,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
            value: '0x0',
            data: data,
        },
        chainParams
    )

    const signedTx = await wallet.signEvm(tx)
    const txHex = signedTx.serialize().toString('hex')
    const receipt = await web3.eth.sendSignedTransaction('0x' + txHex)

    if (!receipt.contractAddress) {
        throw new Error('Deployment succeeded but no contract address was returned')
    }

    return {
        txHash: receipt.transactionHash,
        contractAddress: receipt.contractAddress,
    }
}

async function deployViaInjected(
    wallet: AvaWalletCore,
    data: string,
    gasPrice: BN,
    gasLimit: number
): Promise<TokenLaunchResult> {
    const fromAddr = ('0x' + wallet.getEvmAddress()) as `0x${string}`
    const provider = (wallet as any).provider

    const { createWalletClient, custom, publicActions } = await import('viem')
    const walletClient = createWalletClient({
        transport: custom(provider),
    }).extend(publicActions)

    const txHash = await walletClient.sendTransaction({
        account: fromAddr,
        data: data as `0x${string}`,
        gasPrice: BigInt(gasPrice.toString()),
        gas: BigInt(gasLimit),
        chain: null,
    } as any)

    // Wait for the receipt so we can surface the deployed address.
    const receipt = await walletClient.waitForTransactionReceipt({ hash: txHash })
    if (!receipt.contractAddress) {
        throw new Error('Deployment succeeded but no contract address was returned')
    }

    return {
        txHash: txHash,
        contractAddress: receipt.contractAddress,
    }
}

/**
 * Build a C-Chain (Snowtrace) explorer URL for the given contract address,
 * selecting mainnet vs. Fuji testnet from the EVM chain id.
 */
export function cChainExplorerAddressUrl(address: string, evmChainId: number): string {
    // 43114 = Avalanche mainnet C-Chain, 43113 = Fuji testnet C-Chain.
    const base = evmChainId === 43113 ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
    return `${base}/address/${address}`
}
