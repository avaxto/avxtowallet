/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM network registry — every EVM chain the wallet knows how to talk to.
 *
 * This is the unit the `evm` platform differentiates by. Where the wallet used
 * to model each chain as its own *platform* (a `robinhood` folder, an
 * `ethereum` folder, …), an EVM chain is really just a bag of parameters:
 * chain id, RPC, explorer, native asset. One platform reads this registry and
 * every additional chain becomes a JSON entry rather than a new module.
 *
 * Two sources, merged:
 *  - `./networks.json` — the curated built-ins, shipped with the app.
 *  - localStorage — networks the user added themselves.
 *
 * The storage key is deliberately NOT `'networks'`: that one already belongs
 * to Avalanche's own custom-network list (`stores/network.ts`), which stores
 * serialized `AvaNetwork` objects with a completely different shape.
 */
import builtinNetworks from './networks.json'

/** Which API dialect a network's token-discovery endpoint speaks. */
export type EvmExplorerFamily = 'blockscout' | 'etherscan' | 'glacier'

export interface EvmExplorerApi {
    family: EvmExplorerFamily
    /** API base URL. For `etherscan` this is the shared V2 multichain endpoint. */
    url: string
    /**
     * True when the family needs an API key the app cannot ship (Etherscan
     * V2). Networks whose key is missing are skipped during discovery rather
     * than failing the whole aggregation.
     */
    requiresKey: boolean
}

export interface EvmNativeAsset {
    symbol: string
    name: string
    decimals: number
}

export interface EvmNetwork {
    /** Stable slug, unique across the registry. */
    id: string
    name: string
    /** Compact label for the per-token network chip in the portfolio. */
    shortName: string
    evmChainId: number
    isTestnet: boolean
    rpcUrl: string
    wsUrl?: string
    native: EvmNativeAsset
    /** Explorer *site* root, no trailing slash — for user-facing links. */
    explorerUrl: string
    explorerApi: EvmExplorerApi
    /**
     * Transaction envelope the wallet signs for this chain.
     *
     * Only `'legacy'` (type-0) is implemented today, and every seed network
     * accepts it. The field exists from the start because registry entries are
     * merged with user-added networks persisted in localStorage — introducing
     * a required field later would mean a data migration.
     */
    txType: 'legacy' | 'eip1559'
    /** CoinGecko asset-platform id, when one exists, for USD pricing. */
    coingeckoPlatformId?: string
    /** Only set where the app actually ships an asset; otherwise use `color`. */
    iconUrl?: string
    /** Brand colour, used for the network chip when there is no icon. */
    color: string
    /** True for user-added networks (built-ins are not editable/removable). */
    isCustom?: boolean
}

const STORAGE_KEY = 'evm_networks_custom'

const BUILTIN: EvmNetwork[] = (builtinNetworks as EvmNetwork[]).map((n) => ({
    ...n,
    isCustom: false,
}))

let customNetworks: EvmNetwork[] = []

/**
 * Minimal shape check for a persisted entry.
 *
 * localStorage is user-writable and survives across app versions, so a stored
 * record is untrusted input: anything missing the fields the EVM layer indexes
 * on (chain id, RPC, native asset) is dropped rather than allowed to surface
 * as a half-built network that fails later at a confusing call site.
 */
function isUsableNetwork(n: unknown): n is EvmNetwork {
    if (!n || typeof n !== 'object') return false
    const c = n as Partial<EvmNetwork>
    return (
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        typeof c.evmChainId === 'number' &&
        Number.isFinite(c.evmChainId) &&
        typeof c.rpcUrl === 'string' &&
        !!c.native &&
        typeof c.native.symbol === 'string' &&
        typeof c.native.decimals === 'number'
    )
}

/** Fills in the optional fields an older or hand-written record may lack. */
function normalize(n: EvmNetwork): EvmNetwork {
    return {
        ...n,
        shortName: n.shortName || n.name,
        isTestnet: n.isTestnet ?? false,
        explorerUrl: (n.explorerUrl || '').replace(/\/+$/, ''),
        explorerApi: n.explorerApi ?? { family: 'blockscout', url: '', requiresKey: false },
        txType: n.txType ?? 'legacy',
        color: n.color || '#888888',
        isCustom: true,
    }
}

function persist(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customNetworks))
    } catch (e) {
        console.warn('[evm/networkRegistry] Could not persist custom networks:', e)
    }
}

/**
 * Loads user-added networks from storage. Safe to call more than once.
 *
 * A built-in's chain id always wins: if the user previously added a network
 * that a later release then shipped as a built-in, keeping both would make
 * `getNetworkByChainId` ambiguous.
 */
export function loadCustomEvmNetworks(): void {
    customNetworks = []
    let raw: string | null = null
    try {
        raw = localStorage.getItem(STORAGE_KEY)
    } catch {
        return
    }
    if (!raw) return

    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return

        const builtinChainIds = new Set(BUILTIN.map((n) => n.evmChainId))
        const seen = new Set<number>()
        let dropped = false

        for (const entry of parsed) {
            if (!isUsableNetwork(entry)) {
                dropped = true
                continue
            }
            if (builtinChainIds.has(entry.evmChainId) || seen.has(entry.evmChainId)) {
                dropped = true
                continue
            }
            seen.add(entry.evmChainId)
            customNetworks.push(normalize(entry))
        }

        // Rewrite storage so a bad record is purged for good rather than
        // re-filtered on every load.
        if (dropped) persist()
    } catch (e) {
        console.warn('[evm/networkRegistry] Could not parse stored custom networks:', e)
    }
}

/** Every known network, built-ins first. */
export function getEvmNetworks(): EvmNetwork[] {
    return [...BUILTIN, ...customNetworks]
}

export function getEvmNetworkById(id: string): EvmNetwork | undefined {
    return getEvmNetworks().find((n) => n.id === id)
}

export function getEvmNetworkByChainId(chainId: number): EvmNetwork | undefined {
    return getEvmNetworks().find((n) => n.evmChainId === chainId)
}

/** The Avalanche C-Chain entry — the bridge between this registry and the Avalanche platform. */
export function getAvalancheCChainNetwork(isTestnet = false): EvmNetwork {
    const id = isTestnet ? 'avalanche-fuji' : 'avalanche-c'
    const net = getEvmNetworkById(id)
    // Present unconditionally in networks.json, so this is a real invariant
    // rather than a lookup that can legitimately come back empty.
    if (!net) throw new Error(`EVM registry is missing its ${id} entry.`)
    return net
}

/**
 * Adds a user-defined network. Rejects a chain id that already exists —
 * duplicates would make chain-id lookups ambiguous, and chain id (not the
 * slug) is what tokens and signed transactions are keyed by.
 */
export function addCustomEvmNetwork(network: EvmNetwork): EvmNetwork {
    if (!isUsableNetwork(network)) {
        throw new Error('Network is missing required fields (id, name, chain id, RPC, native asset).')
    }
    if (getEvmNetworkByChainId(network.evmChainId)) {
        throw new Error(`A network with chain id ${network.evmChainId} is already registered.`)
    }
    const normalized = normalize(network)
    customNetworks.push(normalized)
    persist()
    return normalized
}

/** Removes a user-added network. Built-ins are not removable. */
export function removeCustomEvmNetwork(chainId: number): boolean {
    const idx = customNetworks.findIndex((n) => n.evmChainId === chainId)
    if (idx === -1) return false
    customNetworks.splice(idx, 1)
    persist()
    return true
}

/**
 * Explorer URL for a transaction on `network`.
 *
 * Replaces the per-feature `cChainExplorerTxUrl(hash, chainId)` helpers, which
 * each hardcoded the same snowtrace/testnet-snowtrace pair and so pointed every
 * chain's transactions at Avalanche's explorer. Returns an empty string when a
 * network has no explorer configured, so callers can hide the link rather than
 * render one that 404s.
 */
export function explorerTxUrl(network: EvmNetwork, txHash: string): string {
    if (!network.explorerUrl) return ''
    return `${network.explorerUrl.replace(/\/+$/, '')}/tx/${txHash}`
}

/** Explorer URL for an address (or contract) on `network`. See `explorerTxUrl`. */
export function explorerAddressUrl(network: EvmNetwork, address: string): string {
    if (!network.explorerUrl) return ''
    return `${network.explorerUrl.replace(/\/+$/, '')}/address/${address}`
}

/**
 * A human name for a network's explorer, derived from its host.
 *
 * Derived rather than configured because the registry already carries the URL,
 * and a second field for the name is a second thing to keep in sync.
 */
export function explorerName(network: EvmNetwork): string {
    const host = (network.explorerUrl ?? '').replace(/^https?:\/\//, '').split('/')[0]
    return host || 'the explorer'
}
