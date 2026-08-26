/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana cluster definitions.
 *
 * Deliberately a small fixed list rather than a user-extensible registry like
 * `evm/networks.json`. EVM needed that because "which chain" is an open set
 * that grows constantly; Solana has exactly three public clusters and adding a
 * fourth is not a thing users do. What they DO need is to point a cluster at a
 * different RPC — the public endpoints below are aggressively rate-limited and
 * unusable for anything beyond light browsing — so the RPC URL is overridable
 * per cluster while the cluster list itself stays fixed.
 */

export interface SolanaNetwork {
    /** Stable id, also the `?cluster=` value the explorer expects. */
    id: string
    name: string
    isTestnet: boolean
    /** JSON-RPC endpoint. May be a user override — see `getSolanaNetworks`. */
    rpcUrl: string
    /** The default endpoint, kept so the UI can show what an override replaced. */
    defaultRpcUrl: string
    wsUrl?: string
    explorerUrl: string
    native: {
        symbol: string
        name: string
        decimals: number
    }
}

/** SOL is always 9 decimals — 1 SOL = 1,000,000,000 lamports. */
export const LAMPORTS_PER_SOL = 1_000_000_000
export const SOL_DECIMALS = 9

const NATIVE = { symbol: 'SOL', name: 'Solana', decimals: SOL_DECIMALS } as const

/**
 * Where a per-cluster RPC override is kept. One key per cluster id so
 * overriding mainnet doesn't silently move devnet too.
 */
const RPC_OVERRIDE_PREFIX = 'solana_rpc_'

const BASE_NETWORKS: readonly SolanaNetwork[] = [
    {
        id: 'mainnet-beta',
        name: 'Mainnet Beta',
        isTestnet: false,
        rpcUrl: 'https://api.mainnet-beta.solana.com',
        defaultRpcUrl: 'https://api.mainnet-beta.solana.com',
        explorerUrl: 'https://explorer.solana.com',
        native: { ...NATIVE },
    },
    {
        id: 'devnet',
        name: 'Devnet',
        isTestnet: true,
        rpcUrl: 'https://api.devnet.solana.com',
        defaultRpcUrl: 'https://api.devnet.solana.com',
        explorerUrl: 'https://explorer.solana.com',
        native: { ...NATIVE },
    },
    {
        id: 'testnet',
        name: 'Testnet',
        isTestnet: true,
        rpcUrl: 'https://api.testnet.solana.com',
        defaultRpcUrl: 'https://api.testnet.solana.com',
        explorerUrl: 'https://explorer.solana.com',
        native: { ...NATIVE },
    },
]

function readOverride(id: string): string | null {
    try {
        const raw = localStorage.getItem(RPC_OVERRIDE_PREFIX + id)
        if (!raw) return null
        // Only http(s) — a ws:// or file:// endpoint here would fail deep
        // inside the RPC client with a far less obvious message.
        const url = new URL(raw)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
        return raw
    } catch {
        return null
    }
}

/** Every cluster, with any user RPC override applied. */
export function getSolanaNetworks(): SolanaNetwork[] {
    return BASE_NETWORKS.map((n) => {
        const override = readOverride(n.id)
        return override ? { ...n, rpcUrl: override } : { ...n }
    })
}

export function getSolanaNetworkById(id: string): SolanaNetwork | undefined {
    return getSolanaNetworks().find((n) => n.id === id)
}

/**
 * Points a cluster at a different RPC. Passing null restores the default.
 * Throws on a malformed URL so the caller can surface it, rather than storing
 * something that only fails later at request time.
 */
export function setSolanaRpcOverride(id: string, rpcUrl: string | null): void {
    if (!BASE_NETWORKS.some((n) => n.id === id)) {
        throw new Error(`Unknown Solana cluster: ${id}`)
    }
    try {
        if (rpcUrl === null) {
            localStorage.removeItem(RPC_OVERRIDE_PREFIX + id)
            return
        }
        const url = new URL(rpcUrl)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            throw new Error('RPC endpoint must be an http(s) URL.')
        }
        localStorage.setItem(RPC_OVERRIDE_PREFIX + id, rpcUrl)
    } catch (e) {
        if (e instanceof TypeError) throw new Error('That is not a valid URL.')
        throw e
    }
}

/**
 * Explorer link for a transaction signature.
 *
 * Non-mainnet clusters need an explicit `?cluster=`; without it the explorer
 * silently shows mainnet and reports the signature as not found.
 */
export function getSolanaTxUrl(signature: string, network: SolanaNetwork): string {
    const suffix = network.id === 'mainnet-beta' ? '' : `?cluster=${network.id}`
    return `${network.explorerUrl}/tx/${signature}${suffix}`
}

/** Explorer link for an account (address). */
export function getSolanaAddressUrl(address: string, network: SolanaNetwork): string {
    const suffix = network.id === 'mainnet-beta' ? '' : `?cluster=${network.id}`
    return `${network.explorerUrl}/address/${address}${suffix}`
}
