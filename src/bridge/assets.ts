/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * What the bridge page needs to know about assets: amounts in and out of base
 * units, token metadata read from the chain, balances on any bridge chain,
 * and the AVXTO token on each chain (the Avalanche original, or its NTT spoke
 * once deployed — see wormhole/nttConfig.ts).
 */
import Big from 'big.js'

import { AVXTO_CONTRACT_ADDRESS, TESTNET_AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'
import { walletSigners } from './signers'
import { NATIVE, type BridgeAsset, type BridgeChain } from './types'
import { WORMHOLE_EVM_CHAINS } from './wormhole/chains'
import { NTT_DEPLOYMENTS } from './wormhole/nttConfig'

const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
    { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
]

/** A chain's native coin as a bridge asset. */
export function nativeAsset(chain: BridgeChain): BridgeAsset {
    return { chainId: chain.id, address: NATIVE, symbol: chain.native.symbol, decimals: chain.native.decimals, name: chain.native.name }
}

/** `text` in base units, or null when it is not a positive amount with at most `decimals` places. */
export function parseAmount(text: string, decimals: number): bigint | null {
    const t = text.trim().replace(/,/g, '')
    if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return null
    const [whole, frac = ''] = t.split('.')
    if (frac.length > decimals) return null
    const v = BigInt((whole || '0') + frac.padEnd(decimals, '0'))
    return v > BigInt(0) ? v : null
}

/** Base units as a decimal string, trimmed to `maxFrac` places (rounded down). */
export function formatAmount(v: bigint, decimals: number, maxFrac = 6): string {
    const neg = v < BigInt(0)
    const s = (neg ? -v : v).toString().padStart(decimals + 1, '0')
    const whole = s.slice(0, s.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    const frac = s.slice(s.length - decimals, s.length - decimals + maxFrac).replace(/0+$/, '')
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}

/** Base units as a plain decimal string for an input box (no grouping, full precision). */
export function amountInput(v: bigint, decimals: number): string {
    const s = v.toString().padStart(decimals + 1, '0')
    const frac = s.slice(s.length - decimals).replace(/0+$/, '')
    return `${s.slice(0, s.length - decimals)}${frac ? `.${frac}` : ''}`
}

function evmNetworkOf(chain: BridgeChain) {
    const n = chain.kind === 'evm' ? getEvmNetworkByChainId(chain.evmChainId ?? -1) : undefined
    if (!n) throw new Error(`${chain.name} is not an EVM network the wallet knows.`)
    return n
}

/** Symbol, name and decimals of an ERC-20 on `chain`, read from the contract. */
export async function readTokenAsset(chain: BridgeChain, address: string): Promise<BridgeAsset> {
    const t = new (web3For(evmNetworkOf(chain)).eth.Contract)(ERC20_ABI as any, address).methods
    const [symbol, name, decimals] = await Promise.all([
        t.symbol().call(),
        t.name().call().catch(() => ''),
        t.decimals().call(),
    ])
    if (!symbol) throw new Error('That address is not a token on this chain.')
    return { chainId: chain.id, address, symbol: String(symbol), name: String(name), decimals: Number(decimals) }
}

/** Converts a human-scaled Big from a platform balance to base units. */
function bigToUnits(amount: Big, decimals: number): bigint {
    return BigInt(amount.times(Big(10).pow(decimals)).round(0, 0 /* round down */).toFixed(0))
}

/**
 * `owner`'s balance of `asset`, in base units. Solana and Bitcoin balances come
 * from the connected wallet, so they read null when no wallet is on that chain.
 */
export async function readBalance(chain: BridgeChain, asset: BridgeAsset, owner: string): Promise<bigint | null> {
    if (!owner) return null
    if (chain.kind === 'evm') {
        const web3 = web3For(evmNetworkOf(chain))
        if (asset.address === NATIVE) return BigInt(await web3.eth.getBalance(owner))
        const t = new web3.eth.Contract(ERC20_ABI as any, asset.address).methods
        return BigInt(await t.balanceOf(owner).call())
    }
    const wallet = chain.kind === 'solana' ? walletSigners.solana(chain) : walletSigners.bitcoin(chain)
    if (!wallet) return null
    const balances = await wallet.getBalances()
    const b = balances.find((x) => (asset.address === NATIVE ? x.assetId === 'native' : x.assetId === asset.address))
    return b ? bigToUnits(b.amount, asset.decimals) : BigInt(0)
}

/** SPL tokens the connected Solana wallet holds on `chain`. */
export async function solanaHeldTokens(chain: BridgeChain): Promise<BridgeAsset[]> {
    const wallet = walletSigners.solana(chain)
    if (!wallet) return []
    const balances = await wallet.getBalances()
    return balances
        .filter((b) => b.assetId !== 'native' && b.amount.gt(0))
        .map((b) => ({ chainId: chain.id, address: b.assetId, symbol: b.symbol || b.assetId.slice(0, 4), decimals: b.decimals, name: b.name }))
}

/**
 * AVXTO on `chain`: the original on Avalanche C-Chain (mainnet and Fuji, where
 * the testnet counterpart is SMTK), and on other chains the NTT spoke token
 * once its deployment is filled in. Null where AVXTO does not exist (yet).
 */
export function avxtoAssetFor(chain: BridgeChain): BridgeAsset | null {
    if (chain.kind !== 'evm') return null
    if (chain.evmChainId === 43114) return { chainId: chain.id, address: AVXTO_CONTRACT_ADDRESS, symbol: 'AVXTO', decimals: 18, name: 'AVAX Toolbox' }
    if (chain.evmChainId === 43113) return { chainId: chain.id, address: TESTNET_AVXTO_CONTRACT_ADDRESS, symbol: 'SMTK', decimals: 18, name: 'SomeToken' }
    const ref = WORMHOLE_EVM_CHAINS[chain.evmChainId ?? -1]
    if (!ref) return null
    const d = NTT_DEPLOYMENTS.find((x) => x.symbol === 'AVXTO' && x.network === ref.network)
    const token = d?.chains[ref.chain]?.token
    return d && token ? { chainId: chain.id, address: token, symbol: d.symbol, decimals: d.decimals, name: 'AVAX Toolbox' } : null
}
