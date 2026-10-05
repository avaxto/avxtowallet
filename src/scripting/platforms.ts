/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Where scripting finds each platform's wallet and network. Reads use each
 * platform's connected wallet whichever tab is in front; signing follows the
 * wallet's own rules (see ./execute — Avalanche only signs from its own tab).
 */
import { getPlatform } from '@/platforms'
import type { PlatformNetwork, PlatformWallet } from '@/platforms/types'
import { useNetworkStore } from '@/stores/network'
import { SCRIPT_PLATFORMS, type AvalancheChain, type ScriptPlatform } from './types'

const ALIASES: Record<string, ScriptPlatform> = {
    avalanche: 'avalanche',
    avax: 'avalanche',
    evm: 'evm',
    ethereum: 'evm',
    solana: 'solana',
    sol: 'solana',
    bitcoin: 'bitcoin',
    btc: 'bitcoin',
}

/** A platform name from a script, validated. */
export function parsePlatform(v: unknown): ScriptPlatform {
    const p = typeof v === 'string' ? ALIASES[v.trim().toLowerCase()] : undefined
    if (!p) throw new Error(`Unknown platform ${JSON.stringify(v)}. Use one of: ${SCRIPT_PLATFORMS.join(', ')}.`)
    return p
}

export function parseAvalancheChain(v: unknown, allowed: AvalancheChain[], fallback?: AvalancheChain): AvalancheChain {
    if ((v === undefined || v === null) && fallback) return fallback
    const c = typeof v === 'string' ? v.trim().toUpperCase().replace(/-CHAIN$/, '') : ''
    if (!allowed.includes(c as AvalancheChain)) {
        throw new Error(`Avalanche chain must be ${allowed.map((x) => `"${x}"`).join(' or ')}, not ${JSON.stringify(v)}.`)
    }
    return c as AvalancheChain
}

/** The connected wallet on a platform (for reads), or null. */
export function walletOn(p: ScriptPlatform): PlatformWallet | null {
    return getPlatform(p)?.getActiveWallet() ?? null
}

export function requireWallet(p: ScriptPlatform): PlatformWallet {
    const w = walletOn(p)
    if (!w) throw new Error(`No ${platformName(p)} wallet is connected.`)
    return w
}

export function networkOn(p: ScriptPlatform): PlatformNetwork | null {
    return getPlatform(p)?.getActiveNetwork?.() ?? null
}

export function platformName(p: ScriptPlatform): string {
    return { avalanche: 'Avalanche', evm: 'EVM', solana: 'Solana', bitcoin: 'Bitcoin' }[p]
}

export function avalancheIsTestnet(): boolean {
    return useNetworkStore().selectedNetwork?.networkId !== 1
}

export function avalancheChainLabel(c: AvalancheChain): string {
    return `Avalanche ${c}-Chain${avalancheIsTestnet() ? ' (Fuji)' : ''}`
}
