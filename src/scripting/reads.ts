/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The read-only half of the script API: platforms, addresses, balances,
 * tokens, networks. Nothing here signs or reveals a secret — only what the
 * wallet already shows on screen. Amounts go out as decimal strings.
 */
import { getBridgeChain } from '@/bridge/chains'
import { readBalance as readChainBalance, readTokenAsset } from '@/bridge/assets'
import { NATIVE } from '@/bridge/types'
import { useAssetsStore } from '@/stores'
import { bnToBig } from '@/avalanche-wallet-sdk'
import {
    avalancheIsTestnet,
    networkOn,
    parseAvalancheChain,
    parsePlatform,
    platformName,
    requireWallet,
    walletOn,
} from './platforms'
import { fromBaseUnits, SCRIPT_PLATFORMS } from './types'

export interface BalanceRow {
    chain: string
    /** 'native', or the token contract / mint / asset id. */
    asset: string
    symbol: string
    decimals: number
    amount: string
}

export function readPlatforms() {
    return SCRIPT_PLATFORMS.map((id) => {
        const w = walletOn(id)
        const n = networkOn(id)
        return {
            id,
            name: platformName(id),
            connected: !!w,
            watchOnly: !!w && w.isReadonly,
            network: n ? { id: n.id, name: n.name, isTestnet: n.isTestnet, chainId: n.evmChainId ?? null } : null,
        }
    })
}

export function readNetwork(platformArg: unknown) {
    const p = parsePlatform(platformArg)
    if (p === 'avalanche') {
        const testnet = avalancheIsTestnet()
        return { id: testnet ? 'fuji' : 'mainnet', name: testnet ? 'Avalanche Fuji' : 'Avalanche Mainnet', isTestnet: testnet, chainId: testnet ? 43113 : 43114 }
    }
    const n = networkOn(p)
    if (!n) throw new Error(`${platformName(p)} has no network selected.`)
    return { id: n.id, name: n.name, isTestnet: n.isTestnet, chainId: n.evmChainId ?? null }
}

export function readAddresses(platformArg: unknown) {
    const p = parsePlatform(platformArg)
    return requireWallet(p)
        .getAddresses()
        .map((a) => ({ chain: a.chain, address: a.address, label: a.label ?? a.chain }))
}

export function readAddress(platformArg: unknown, chainArg?: unknown): string {
    const p = parsePlatform(platformArg)
    const list = readAddresses(p)
    if (p === 'avalanche') {
        const c = parseAvalancheChain(chainArg, ['X', 'P', 'C'], 'C')
        const hit = list.find((a) => a.chain === c)
        if (!hit) throw new Error(`This Avalanche wallet has no ${c}-Chain address.`)
        return hit.address
    }
    return requireWallet(p).getPrimaryAddress()
}

export async function readBalances(platformArg: unknown): Promise<BalanceRow[]> {
    const p = parsePlatform(platformArg)
    const w = requireWallet(p)
    const rows: BalanceRow[] = (await w.getBalances()).map((b) => ({
        chain: b.chain ?? '',
        asset: b.assetId === 'avax-c' ? NATIVE : b.assetId,
        symbol: b.symbol,
        decimals: b.decimals,
        amount: b.amount.toFixed(),
    }))
    if (p === 'avalanche') {
        // The X-chain AVAX row carries the AVAX asset id; scripts call it 'native' like everywhere else.
        const avaId = useAssetsStore().AssetAVA?.id
        for (const r of rows) if (r.chain === 'X' && r.asset === avaId) r.asset = NATIVE
        // P-Chain is not in the generic list; it is read from the Avalanche stores (Avalanche tab only).
        const pb = useAssetsStore().walletPlatformBalance
        rows.push({ chain: 'P', asset: NATIVE, symbol: 'AVAX', decimals: 9, amount: bnToBig(pb.available, 9).toFixed() })
    }
    return rows
}

export async function readBalance(platformArg: unknown, opts?: unknown): Promise<string> {
    const p = parsePlatform(platformArg)
    const o = (opts && typeof opts === 'object' ? opts : {}) as { chain?: unknown; asset?: unknown; token?: unknown }
    const asset = String(o.asset ?? o.token ?? NATIVE).toLowerCase()
    const chain = p === 'avalanche' ? parseAvalancheChain(o.chain, ['X', 'P', 'C'], 'C') : undefined
    const rows = await readBalances(p)
    const hit = rows.find((r) => r.asset.toLowerCase() === asset && (!chain || r.chain === chain))
    if (hit) return hit.amount
    if (asset !== NATIVE && (p === 'evm' || (p === 'avalanche' && chain === 'C'))) {
        return (await readToken(p, asset)).balance
    }
    return '0'
}

/** One token's details and balance: ERC-20 on C-Chain / the EVM network, or an SPL mint held on Solana. */
export async function readToken(platformArg: unknown, addressArg: unknown) {
    const p = parsePlatform(platformArg)
    const address = String(addressArg ?? '').trim()
    if (p === 'solana') {
        const row = (await readBalances(p)).find((r) => r.asset === address)
        if (!row) throw new Error(`This Solana wallet holds no token with mint ${address}.`)
        return { address, symbol: row.symbol, decimals: row.decimals, balance: row.amount }
    }
    if (p !== 'avalanche' && p !== 'evm') throw new Error(`${platformName(p)} has no tokens.`)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`"${address}" is not a token contract address.`)
    const chainId = p === 'avalanche' ? (avalancheIsTestnet() ? 43113 : 43114) : networkOn('evm')?.evmChainId
    const chain = chainId ? getBridgeChain(`evm:${chainId}`) : undefined
    if (!chain) throw new Error('No EVM network is selected.')
    const asset = await readTokenAsset(chain, address)
    const owner = p === 'avalanche' ? readAddress('avalanche', 'C') : requireWallet('evm').getPrimaryAddress()
    const raw = (await readChainBalance(chain, asset, owner)) ?? BigInt(0)
    return { address, symbol: asset.symbol, decimals: asset.decimals, balance: fromBaseUnits(raw, asset.decimals) }
}
