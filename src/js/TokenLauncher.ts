/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/*
  TokenLauncher - deploys a parameterized OpenZeppelin ERC20 (the
  AVXTOLaunchToken template) to any EVM chain.

  The Solidity template lives in /contracts/AVXTOLaunchToken.sol and is
  pre-compiled into src/avxto/contracts/AVXTOLaunchToken.json by
  `npm run compile:contracts`. Here we ABI-encode the constructor arguments,
  append them to the creation bytecode, and hand the result to an `EvmSigner`.

  Nothing here is chain-specific any more. It used to take an `AvaWalletCore`
  and reach for the C-Chain-pinned `web3` singleton for gas, nonce, chain id and
  broadcast — which pinned the whole feature to Avalanche for reasons unrelated
  to deploying an ERC20. All of that now comes from the signer, so the same code
  deploys on Robinhood Chain, Ethereum or anything else in the registry
  depending only on which wallet is connected. See `@/evm/signer`.
*/
import { BN } from '@/avalanche'
import type Web3 from 'web3'

import { explorerAddressUrl } from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'
import type { EvmSigner } from '@/evm/signer'
import artifact from '@/avxto/contracts/AVXTOLaunchToken.json'
import { isOfflineTxId } from '@/stores/offlineSigning'

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
 *
 * Takes a `Web3` only for its ABI codec, which is pure — the instance's network
 * is irrelevant here, and passing the signer's avoids constructing a second one
 * just to encode.
 */
export function encodeDeployData(web3: Web3, params: TokenLaunchParams): string {
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
 * Deploy the ERC20 to the signer's chain. Returns the tx hash and the new
 * contract address.
 *
 * Works with every wallet an `EvmSigner` covers: locally-signing wallets
 * (mnemonic / private key / Ledger, including offline capture) and injected
 * browser wallets, on whatever network the signer is bound to.
 */
export async function deployToken(
    signer: EvmSigner,
    params: TokenLaunchParams
): Promise<TokenLaunchResult> {
    const data = encodeDeployData(signer.reader(), params)

    // No `to`: that is what makes this a contract creation.
    const request = { data, label: `Deploy token ${params.symbol}` }
    const gasLimit = Math.min(await signer.estimateGas(request, MAX_DEPLOY_GAS), MAX_DEPLOY_GAS)

    const txHash = await signer.send({ ...request, gasLimit })

    // Offline signing captured the transaction instead of sending it. The
    // contract address is only assigned when the deploy is mined, so there is
    // nothing to report yet — the caller shows the export panel instead.
    if (isOfflineTxId(txHash)) {
        return { txHash, contractAddress: '' }
    }

    const receipt = await signer.waitForReceipt(txHash)
    if (!receipt.contractAddress) {
        throw new Error('Deployment succeeded but no contract address was returned')
    }

    return {
        txHash: receipt.txHash,
        contractAddress: receipt.contractAddress,
    }
}

/**
 * Explorer URL for a deployed contract.
 *
 * Takes the network rather than a chain id: the previous signature
 * (`address, evmChainId`) could only ever resolve Avalanche's two chains and
 * silently sent every other chain's contracts to snowtrace.
 */
export function tokenExplorerUrl(network: EvmNetwork, address: string): string {
    return explorerAddressUrl(network, address)
}
