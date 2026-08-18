/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Reading a discovered token's real state from its own contract.
 *
 * Explorers report metadata, and that metadata is not trustworthy: balances go
 * stale, and `decimals` is routinely wrong or absent. Decimals in particular is
 * load-bearing — it is the exponent on every displayed balance and every send
 * amount, so a wrong value does not look like an error, it looks like a
 * different number. Anything used for arithmetic is therefore read from the
 * contract, on that token's own network.
 */
import Big from 'big.js'

import type { EvmNetwork } from './networkRegistry'
import { web3For } from './providers'

/** Minimal ERC-20 ABI — only what is needed to read balance and decimals. */
const ERC20_READ_ABI = [
    {
        constant: true,
        inputs: [{ name: '_owner', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: 'balance', type: 'uint256' }],
        type: 'function',
    },
    {
        constant: true,
        inputs: [],
        name: 'decimals',
        outputs: [{ name: '', type: 'uint8' }],
        type: 'function',
    },
] as const

export interface OnChainTokenState {
    /** Raw integer balance, unscaled. */
    raw: string
    /** Balance scaled by the verified decimals. */
    balance: Big
    /** Decimals as the contract reports them. */
    decimals: number
}

/**
 * Reads `balanceOf` and `decimals` for one token.
 *
 * `decimals` falls back to the explorer's hint and then to 18 only when the
 * contract does not implement it — some legacy tokens genuinely do not.
 */
export async function readTokenState(
    contractAddress: string,
    holder: string,
    network: EvmNetwork,
    decimalsHint?: number
): Promise<OnChainTokenState> {
    const web3 = web3For(network)
    //@ts-ignore - web3 typings for a const ABI array
    const contract = new web3.eth.Contract(ERC20_READ_ABI, contractAddress)

    const rawBalance: string = await contract.methods.balanceOf(holder).call()

    let decimals: number
    try {
        const reported = await contract.methods.decimals().call()
        decimals = parseInt(String(reported), 10)
        if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) {
            throw new Error(`Implausible decimals: ${reported}`)
        }
    } catch {
        decimals = decimalsHint ?? 18
    }

    const raw = String(rawBalance ?? '0')
    return {
        raw,
        balance: Big(raw).div(Big(10).pow(decimals)),
        decimals,
    }
}

/** Native (gas) balance for one network. */
export async function readNativeBalance(holder: string, network: EvmNetwork): Promise<Big> {
    const raw = await web3For(network).eth.getBalance(holder)
    return Big(raw.toString()).div(Big(10).pow(network.native.decimals))
}
