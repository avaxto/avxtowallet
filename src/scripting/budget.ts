/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The rows of a live run's budget table: one per asset the wallet can spend,
 * keyed exactly as intents are (see `assetKey`), so a budget line and the
 * sends it allows can never disagree about which asset they mean.
 */
import { avalancheChainLabel, networkOn, platformName, walletOn } from './platforms'
import { readBalances, readToken } from './reads'
import { assetKey, SCRIPT_PLATFORMS, type BudgetLine, type ScriptPlatform } from './types'

export interface BudgetCandidate extends BudgetLine {
    balance: string
}

/** The chain key intents use for a platform's balance row. */
function chainKeyFor(p: ScriptPlatform, rowChain: string): { key: string; label: string } | null {
    if (p === 'avalanche') return { key: rowChain, label: avalancheChainLabel(rowChain as any) }
    const n = networkOn(p)
    if (!n) return null
    if (p === 'evm') return n.evmChainId ? { key: `evm:${n.evmChainId}`, label: n.name } : null
    if (p === 'solana') return { key: n.id, label: n.isTestnet ? `Solana ${n.name}` : 'Solana' }
    return { key: n.id, label: n.isTestnet ? `Bitcoin ${n.name}` : 'Bitcoin' }
}

/** Every spendable asset across connected platforms, with its balance and an empty limit. */
export async function budgetCandidates(): Promise<BudgetCandidate[]> {
    const out: BudgetCandidate[] = []
    for (const p of SCRIPT_PLATFORMS) {
        if (!walletOn(p)) continue
        let rows
        try {
            rows = await readBalances(p)
        } catch {
            continue
        }
        for (const r of rows) {
            // X-Chain tokens other than AVAX cannot be sent by scripts.
            if (p === 'avalanche' && r.chain === 'X' && r.asset !== 'native') continue
            const c = chainKeyFor(p, r.chain)
            if (!c) continue
            out.push({
                key: assetKey(p, c.key, r.asset),
                label: `${platformName(p)} · ${c.label}`,
                symbol: r.symbol,
                decimals: r.decimals,
                max: '',
                balance: r.amount,
            })
        }
    }
    return out
}

/** A token budget row the balance list did not include (EVM tokens are not listed there). */
export async function tokenBudgetLine(p: ScriptPlatform, address: string): Promise<BudgetCandidate> {
    const t = await readToken(p, address)
    const chain = p === 'avalanche' ? { key: 'C', label: avalancheChainLabel('C') } : chainKeyFor(p, '')
    if (!chain) throw new Error(`${platformName(p)} has no network selected.`)
    return { key: assetKey(p, chain.key, t.address), label: `${platformName(p)} · ${chain.label}`, symbol: t.symbol, decimals: t.decimals, max: '', balance: t.balance }
}
