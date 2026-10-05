/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Turns a script's `tx.send` / `tx.crossChain` arguments into an `Intent`:
 * validated and fully resolved at the moment the script asks. The recipient is
 * checked against the chain it will be paid on (and refused if it contains
 * anything but plain ASCII — homoglyph addresses), the amount must be a
 * decimal string within the asset's precision, and token symbol/decimals are
 * read from the chain, never taken from the script.
 *
 * What the user approves in the plan review is exactly what this returns, and
 * exactly that is executed.
 */
import Web3 from 'web3'

import { isValidAddress as isValidAvmAddress, ava } from '@/AVA'
import { getBridgeChain } from '@/bridge/chains'
import { readTokenAsset } from '@/bridge/assets'
import { isValidSolanaAddress } from '@/solana/keys'
import { isValidBitcoinAddress } from '@/bitcoin/keys'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import {
    avalancheChainLabel,
    avalancheIsTestnet,
    networkOn,
    parseAvalancheChain,
    parsePlatform,
    requireWallet,
} from './platforms'
import { readAddress, readBalances } from './reads'
import { fromBaseUnits, toBaseUnits, type Intent, type IntentAsset } from './types'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

function asObject(v: unknown, what: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} takes one object argument, e.g. { platform, to, amount }.`)
    return v as Record<string, unknown>
}

function requireAscii(v: string, what: string): void {
    // Lookalike letters (Cyrillic а, Greek ο…) make an attacker's address read like a familiar one.
    if (/[^\x21-\x7e]/.test(v)) throw new Error(`${what} contains characters that are not plain ASCII — refusing a possible lookalike address.`)
}

function evmRecipient(to: string, chainName: string): string {
    if (!EVM_ADDRESS.test(to)) throw new Error(`"${to}" is not a valid ${chainName} address (0x…).`)
    // Mixed case must be a valid checksum; all one case is accepted as typed.
    if (to !== to.toLowerCase() && to.slice(2) !== to.slice(2).toUpperCase() && !Web3.utils.checkAddressChecksum(to)) {
        throw new Error(`"${to}" has an invalid checksum — a mistyped character?`)
    }
    return Web3.utils.toChecksumAddress(to)
}

function summarize(i: Omit<Intent, 'summary' | 'index'>): string {
    if (i.kind === 'crossChain') return `Move ${i.amount} AVAX from ${i.chain}-Chain to ${i.toChain}-Chain`
    return `Send ${i.amount} ${i.asset.symbol} to ${i.to} on ${i.chainLabel}`
}

/** `tx.send({ platform, chain?, to, amount, token? })` → Intent. */
export async function normalizeSend(arg: unknown, index: number): Promise<Intent> {
    const o = asObject(arg, 'tx.send')
    const platform = parsePlatform(o.platform)
    const to = String(o.to ?? '').trim()
    if (!to) throw new Error('tx.send needs a recipient: { to: "…" }.')
    requireAscii(to, 'The recipient')
    const token = o.token === undefined || o.token === null || o.token === 'native' ? '' : String(o.token).trim()
    if (token) requireAscii(token, 'The token address')
    const amountText = o.amount as string

    let base: Omit<Intent, 'summary' | 'index' | 'amount' | 'amountBase' | 'asset'>
    let asset: IntentAsset

    if (platform === 'avalanche') {
        const chain = parseAvalancheChain(o.chain, ['X', 'C'], 'C')
        const testnet = avalancheIsTestnet()
        if (chain === 'X') {
            if (token) throw new Error('tx.send on X-Chain sends AVAX only; tokens are sent on C-Chain.')
            const addr = to.startsWith('X-') ? to : `X-${to}`
            if (!isValidAvmAddress(addr) || !addr.includes(ava.getHRP())) {
                throw new Error(`"${to}" is not a valid X-Chain address on ${testnet ? 'Fuji' : 'Avalanche mainnet'}.`)
            }
            base = { kind: 'send', platform, chain, chainLabel: avalancheChainLabel(chain), isTestnet: testnet, to: addr }
            asset = { id: 'native', symbol: 'AVAX', decimals: 9 }
        } else {
            const evmChainId = testnet ? 43113 : 43114
            base = { kind: 'send', platform, chain, chainLabel: avalancheChainLabel(chain), isTestnet: testnet, evmChainId, to: evmRecipient(to, 'C-Chain') }
            asset = token ? await erc20(evmChainId, token) : { id: 'native', symbol: 'AVAX', decimals: 18 }
        }
    } else if (platform === 'evm') {
        const n = networkOn('evm')
        if (!n?.evmChainId) throw new Error('No EVM network is selected.')
        if (o.chainId !== undefined && Number(o.chainId) !== n.evmChainId) {
            throw new Error(`The EVM wallet is on ${n.name} (chain ${n.evmChainId}), not chain ${o.chainId}. Switch networks first.`)
        }
        requireWallet('evm')
        const native = getBridgeChain(`evm:${n.evmChainId}`)?.native ?? { symbol: 'ETH', decimals: 18 }
        base = { kind: 'send', platform, chain: `evm:${n.evmChainId}`, chainLabel: n.name, isTestnet: n.isTestnet, evmChainId: n.evmChainId, to: evmRecipient(to, n.name) }
        asset = token ? await erc20(n.evmChainId, token) : { id: 'native', symbol: native.symbol, decimals: native.decimals }
    } else if (platform === 'solana') {
        const n = networkOn('solana')
        if (!n) throw new Error('No Solana network is selected.')
        if (!isValidSolanaAddress(to)) throw new Error(`"${to}" is not a valid Solana address.`)
        if (to === requireWallet('solana').getPrimaryAddress()) throw new Error('That is this wallet\'s own Solana address.')
        base = { kind: 'send', platform, chain: n.id, chainLabel: n.isTestnet ? `Solana ${n.name}` : 'Solana', isTestnet: n.isTestnet, to }
        if (token) {
            if (!isValidSolanaAddress(token)) throw new Error(`"${token}" is not a valid SPL mint address.`)
            const row = (await readBalances('solana')).find((r) => r.asset === token)
            if (!row) throw new Error(`This Solana wallet holds no token with mint ${token}.`)
            asset = { id: token, symbol: row.symbol || token.slice(0, 4), decimals: row.decimals }
        } else {
            asset = { id: 'native', symbol: 'SOL', decimals: 9 }
        }
    } else {
        const n = networkOn('bitcoin')
        if (!n) throw new Error('No Bitcoin network is selected.')
        if (token) throw new Error('Bitcoin has no tokens.')
        const network = getBitcoinNetworkById(n.id)
        if (!network || !isValidBitcoinAddress(to, network)) throw new Error(`"${to}" is not a valid ${n.name} address.`)
        requireWallet('bitcoin')
        base = { kind: 'send', platform, chain: n.id, chainLabel: n.isTestnet ? `Bitcoin ${n.name}` : 'Bitcoin', isTestnet: n.isTestnet, to }
        asset = { id: 'native', symbol: 'BTC', decimals: 8 }
    }

    const amountBase = toBaseUnits(amountText, asset.decimals)
    const full = { ...base, asset, amount: fromBaseUnits(amountBase, asset.decimals), amountBase: amountBase.toString() }
    return { ...full, index, summary: summarize(full) }
}

/** `tx.crossChain({ from, to, amount })` → Intent. Avalanche X / P / C only. */
export async function normalizeCrossChain(arg: unknown, index: number): Promise<Intent> {
    const o = asObject(arg, 'tx.crossChain')
    const from = parseAvalancheChain(o.from, ['X', 'P', 'C'])
    const toChain = parseAvalancheChain(o.to, ['X', 'P', 'C'])
    if (from === toChain) throw new Error('tx.crossChain needs two different chains.')
    requireWallet('avalanche')
    // Cross-chain amounts move in nAVAX (9 decimals) on every chain, C-Chain included.
    const amountBase = toBaseUnits(o.amount as string, 9)
    const full = {
        kind: 'crossChain' as const,
        platform: 'avalanche' as const,
        chain: from,
        chainLabel: avalancheChainLabel(from),
        isTestnet: avalancheIsTestnet(),
        to: readAddress('avalanche', toChain),
        toChain,
        asset: { id: 'native', symbol: 'AVAX', decimals: 9 },
        amount: fromBaseUnits(amountBase, 9),
        amountBase: amountBase.toString(),
    }
    return { ...full, index, summary: summarize(full) }
}

async function erc20(evmChainId: number, token: string): Promise<IntentAsset> {
    if (!EVM_ADDRESS.test(token)) throw new Error(`"${token}" is not a token contract address.`)
    const chain = getBridgeChain(`evm:${evmChainId}`)
    if (!chain) throw new Error(`Chain ${evmChainId} is not a network the wallet knows.`)
    try {
        const a = await readTokenAsset(chain, token)
        return { id: Web3.utils.toChecksumAddress(token), symbol: a.symbol, decimals: a.decimals }
    } catch {
        throw new Error(`Could not read token ${token} on ${chain.name} — is it a token on this chain?`)
    }
}
