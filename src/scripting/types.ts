/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Shared shapes for wallet scripting. An `Intent` is one value-moving
 * operation a script asked for, fully resolved and validated at the moment it
 * was asked: the exact recipient, asset, amount and chain the user will see in
 * the plan review and that will be executed — never re-derived later.
 */

export type ScriptPlatform = 'avalanche' | 'evm' | 'solana' | 'bitcoin'
export const SCRIPT_PLATFORMS: ScriptPlatform[] = ['avalanche', 'evm', 'solana', 'bitcoin']

export type AvalancheChain = 'X' | 'P' | 'C'

export type RunMode = 'plan' | 'live'

export interface IntentAsset {
    /** 'native', or the token's contract address / SPL mint. */
    id: string
    symbol: string
    decimals: number
}

export interface Intent {
    /** 1-based, in the order the script asked. */
    index: number
    kind: 'send' | 'crossChain'
    platform: ScriptPlatform
    /**
     * Which chain on the platform: Avalanche 'X' | 'P' | 'C', `evm:<chainId>`,
     * or the Solana / Bitcoin network id.
     */
    chain: string
    /** Human name of the chain, e.g. "Avalanche C-Chain", "Ethereum", "Solana Devnet". */
    chainLabel: string
    isTestnet: boolean
    /** EVM chain id (Avalanche C-Chain and EVM platform). */
    evmChainId?: number
    /** Recipient address (for crossChain: the wallet's own address on the destination chain). */
    to: string
    /** crossChain only: destination Avalanche chain. */
    toChain?: AvalancheChain
    asset: IntentAsset
    /** Normalized decimal amount, e.g. "1.5". */
    amount: string
    /** The same amount in base units, as a decimal string. */
    amountBase: string
    /** One line, for the plan list and logs. */
    summary: string
}

/** Per-asset spending limit for a live run. */
export interface BudgetLine {
    key: string
    label: string
    symbol: string
    decimals: number
    /** Decimal amount; '' or '0' means not allowed. */
    max: string
}

export interface StepResult {
    index: number
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
    txId?: string
    /** Extra ids (crossChain: the import). */
    txIds?: string[]
    explorerUrl?: string
    error?: string
}

/** The budget key an intent spends from. */
export function assetKey(platform: ScriptPlatform, chain: string, assetId: string): string {
    return `${platform}|${chain}|${assetId.toLowerCase()}`
}

export function intentKey(i: Intent): string {
    return assetKey(i.platform, i.chain, i.asset.id)
}

/** Totals per asset across intents, in base units. */
export function intentTotals(intents: Intent[]): { key: string; symbol: string; decimals: number; chainLabel: string; total: bigint; count: number }[] {
    const map = new Map<string, { key: string; symbol: string; decimals: number; chainLabel: string; total: bigint; count: number }>()
    for (const i of intents) {
        const key = intentKey(i)
        const row = map.get(key) ?? { key, symbol: i.asset.symbol, decimals: i.asset.decimals, chainLabel: i.chainLabel, total: BigInt(0), count: 0 }
        row.total += BigInt(i.amountBase)
        row.count += 1
        map.set(key, row)
    }
    return Array.from(map.values())
}

/** Decimal string → base units. Throws on anything but a plain positive decimal with at most `decimals` places. */
export function toBaseUnits(amount: string, decimals: number, what = 'Amount'): bigint {
    if (typeof amount !== 'string') {
        throw new Error(`${what} must be a decimal string like "1.5", not a ${typeof amount} — numbers lose precision.`)
    }
    const t = amount.trim()
    if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`${what} "${amount}" is not a plain decimal number.`)
    const [whole, frac = ''] = t.split('.')
    if (frac.length > decimals) throw new Error(`${what} "${amount}" has more than ${decimals} decimal places.`)
    const v = BigInt(whole + frac.padEnd(decimals, '0'))
    if (v <= BigInt(0)) throw new Error(`${what} must be greater than zero.`)
    return v
}

/** Base units → normalized decimal string (no grouping, trailing zeros trimmed). */
export function fromBaseUnits(v: bigint, decimals: number): string {
    const neg = v < BigInt(0)
    const s = (neg ? -v : v).toString().padStart(decimals + 1, '0')
    const whole = s.slice(0, s.length - decimals)
    const frac = s.slice(s.length - decimals).replace(/0+$/, '')
    return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`
}
