/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Saved scripts, in localStorage. Scripts never run on load or on a timer —
 * only from an explicit click, every time. Scripts that came in through
 * Import are marked `imported` until the user has read the full source once
 * and said so; the page shows a "you did not write this" warning until then.
 * There is no fetching scripts from a URL: sharing is copy and paste.
 */
import { ref } from 'vue'

export interface SavedScript {
    id: string
    name: string
    source: string
    /** Pasted in through Import, not written here. */
    imported: boolean
    /** The user confirmed they read this exact source (cleared when an imported script changes source by import). */
    reviewed: boolean
    updatedAt: number
}

const KEY = 'wallet_scripts_v1'
const MAX_SCRIPTS = 100
const MAX_SOURCE_CHARS = 100_000

function read(): SavedScript[] {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]')
        return Array.isArray(raw) ? raw.filter((s) => s && typeof s.id === 'string' && typeof s.source === 'string') : []
    } catch {
        return []
    }
}

export const savedScripts = ref<SavedScript[]>(read())

function persist(): void {
    try {
        localStorage.setItem(KEY, JSON.stringify(savedScripts.value))
    } catch {
        /* storage full or blocked — kept for this session */
    }
}

export function newScriptId(): string {
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function saveScript(s: SavedScript): void {
    if (s.source.length > MAX_SOURCE_CHARS) throw new Error(`Scripts are limited to ${MAX_SOURCE_CHARS.toLocaleString()} characters.`)
    const rest = savedScripts.value.filter((x) => x.id !== s.id)
    if (rest.length >= MAX_SCRIPTS) throw new Error(`At most ${MAX_SCRIPTS} saved scripts.`)
    savedScripts.value = [Object.assign({}, s, { updatedAt: Date.now() })].concat(rest)
    persist()
}

export function deleteScript(id: string): void {
    savedScripts.value = savedScripts.value.filter((x) => x.id !== id)
    persist()
}

export const EXAMPLES: { name: string; source: string }[] = [
    {
        name: 'Balances everywhere (read-only)',
        source: `// Lists every connected platform and its balances. Moves nothing.
for (const p of await wallet.platforms()) {
  if (!p.connected) { log(p.name + ': not connected'); continue }
  log('== ' + p.name + (p.network ? ' on ' + p.network.name : ''))
  for (const b of await wallet.balances(p.id)) {
    log('  ' + b.chain + '  ' + b.amount + ' ' + b.symbol)
  }
}
`,
    },
    {
        name: 'Pay several people (plan)',
        source: `// Builds a plan of C-Chain payments. Nothing is sent until you approve the plan.
const payees: { to: string; amount: string }[] = [
  { to: '0x0000000000000000000000000000000000000001', amount: '0.1' },
  { to: '0x0000000000000000000000000000000000000002', amount: '0.25' },
]
for (const p of payees) {
  await tx.send({ platform: 'avalanche', chain: 'C', to: p.to, amount: p.amount })
}
log('Planned ' + payees.length + ' payments')
`,
    },
    {
        name: 'Move X-Chain AVAX to C-Chain',
        source: `// Moves everything on X-Chain but 0.1 AVAX to C-Chain (fees are paid on top, from X).
const x = await wallet.balance('avalanche', { chain: 'X' })
const keep = 0.1
const move = (Number(x) - keep - 0.01).toFixed(6)
if (Number(move) > 0) {
  await tx.crossChain({ from: 'X', to: 'C', amount: move })
} else {
  log('Not enough on X-Chain: ' + x + ' AVAX')
}
`,
    },
]

/** The script API, as TypeScript declarations — what scripts can call, and nothing else. */
export const API_REFERENCE = `// Everything a script can reach. There is no fetch, DOM, storage, timers or
// import: the script runs in a separate engine with only these functions.
// Amounts are decimal STRINGS ("1.5"), never numbers.

type Platform = 'avalanche' | 'evm' | 'solana' | 'bitcoin'
type AvalancheChain = 'X' | 'P' | 'C'

interface Balance { chain: string; asset: string /* 'native' or token address / mint */; symbol: string; decimals: number; amount: string }

declare const wallet: {
  /** Every platform, whether connected, and its network. */
  platforms(): Promise<{ id: Platform; name: string; connected: boolean; watchOnly: boolean;
                         network: { id: string; name: string; isTestnet: boolean; chainId: number | null } | null }[]>
  addresses(platform: Platform): Promise<{ chain: string; address: string; label: string }[]>
  /** Avalanche: chain defaults to 'C'. */
  address(platform: Platform, chain?: AvalancheChain): Promise<string>
  balances(platform: Platform): Promise<Balance[]>
  /** Native coin unless asset is a token address / mint. Avalanche chain defaults to 'C'. */
  balance(platform: Platform, opts?: { chain?: AvalancheChain; asset?: string }): Promise<string>
  /** An ERC-20 (Avalanche C-Chain or the EVM network) or an SPL mint you hold. */
  token(platform: Platform, address: string): Promise<{ address: string; symbol: string; decimals: number; balance: string }>
}

declare const network: {
  info(platform: Platform): Promise<{ id: string; name: string; isTestnet: boolean; chainId: number | null }>
}

/**
 * Value-moving calls. In PLAN mode (the default) they only RECORD the operation
 * and return { planned: true, step, summary }; you review the list and approve
 * it, and exactly that list executes. In LIVE mode they send immediately, within
 * the budget you set, and return { step, txId, txIds, explorerUrl }.
 */
declare const tx: {
  /**
   * Native coin, or a token when \`token\` is set.
   *  avalanche: chain 'X' (AVAX only) or 'C' (AVAX or ERC-20), default 'C'
   *  evm:       the EVM wallet's current network (optional chainId must match)
   *  solana:    SOL, or an SPL token by mint
   *  bitcoin:   BTC (fee rate: the ~1 hour estimate)
   */
  send(o: { platform: Platform; to: string; amount: string; token?: string; chain?: AvalancheChain; chainId?: number }): Promise<any>
  sendNative(o: { platform: Platform; to: string; amount: string; chain?: AvalancheChain; chainId?: number }): Promise<any>
  sendToken(o: { platform: Platform; to: string; amount: string; token: string; chain?: 'C'; chainId?: number }): Promise<any>
  /** Avalanche X/P/C. \`amount\` is what arrives; both fees are paid on top from \`from\`. Takes ~10 s per transfer. */
  crossChain(o: { from: AvalancheChain; to: AvalancheChain; amount: string }): Promise<any>
}

declare const run: { info(): Promise<{ mode: 'plan' | 'live'; maxTransactions: number; transactions: number; budget: { asset: string; chain: string; max: string }[] | null }> }

/** To the console below the editor. console.log works too. */
declare function log(...values: unknown[]): void
/** Up to 60 000 ms; counts against the run's time limit. */
declare function sleep(ms: number): Promise<void>

// The script body runs as an async function: use await freely, and \`return\` a value to show it.
`
