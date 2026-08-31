/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The multi-network EVM portfolio: every token this address holds, across
 * every network in the registry, each tagged with the network it lives on.
 *
 * A **new** store rather than a generalisation of `cChainSdkAssets`. That one
 * caches a single `(address, chainId)` pair in scalars, its explorer path
 * ignores its own chainId argument in favour of the globally active Avalanche
 * network, and it sits on the Avalanche critical path (`useCChainSdkBalances`
 * → `useHeldErc20Tokens` → the swap and transfer pickers). Rewriting its cache
 * semantics to hold N networks would risk the working Avalanche wallet for no
 * Avalanche benefit; running alongside it risks nothing.
 *
 * **Discovered tokens deliberately never enter `assetsStore.erc20Tokens`.**
 * An `Erc20Token` binds its contract to the Avalanche web3 singleton at
 * construction, so a foreign-network token placed there would read a balance
 * of zero — and `updateERC20Balances()` iterates that whole list, which would
 * fire a balance call per foreign token at the Avalanche RPC on every refresh.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import Big from 'big.js'

import {
    getEvmNetworks,
    loadCustomEvmNetworks,
    type EvmNetwork,
} from '@/evm/networkRegistry'
import { explorerAdapterFor } from '@/evm/explorers'
import {
    ExplorerThrottledError,
    MissingApiKeyError,
    type DiscoveredToken,
} from '@/evm/explorers/types'
import { readNativeBalance, readTokenState } from '@/evm/tokenReader'
import { tokenRegistryFor } from '@/evm/tokenRegistry'

/** Balance reads in flight per network. Keeps one chain from starving the rest. */
const BALANCE_CONCURRENCY = 5

export interface EvmPortfolioToken {
    /** `${chainId}:${lowercased address}` — the identity, since an address alone collides across chains. */
    key: string
    /** Lowercased contract address, or 'native' for the gas asset. */
    address: string
    symbol: string
    name: string
    decimals: number
    /** Scaled by verified on-chain decimals. */
    balance: Big
    /** Raw unscaled integer balance. */
    raw: string
    logoUri?: string
    isNative: boolean
    /**
     * The network this token lives on — carried on the token itself so any
     * consumer can reach the right RPC, explorer and native asset without
     * having to look it up or, worse, assume the active one.
     */
    network: EvmNetwork
}

export type EvmNetworkStatus = 'loading' | 'ok' | 'error' | 'skipped'

export interface EvmNetworkResult {
    network: EvmNetwork
    status: EvmNetworkStatus
    /** Why this network is not showing results, when it isn't. */
    message?: string
    tokens: EvmPortfolioToken[]
}

/**
 * The network-touching calls `scanNetwork` makes, injectable so the scan
 * logic — isolation, decimals precedence, zero filtering — can be exercised
 * without a network. Defaults are the real implementations.
 */
export interface ScanDeps {
    readNativeBalance: typeof readNativeBalance
    readTokenState: typeof readTokenState
    explorerAdapterFor: typeof explorerAdapterFor
}

const defaultDeps: ScanDeps = { readNativeBalance, readTokenState, explorerAdapterFor }

/** Runs `worker` over `items` with a bounded number in flight. */
async function pooled<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const out: R[] = []
    let cursor = 0
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor++
            out[index] = await worker(items[index])
        }
    })
    await Promise.all(runners)
    return out
}

/**
 * Scans one network. Never throws: a network that fails is reported as a
 * failed network, because one unreachable explorer must degrade its own row
 * rather than empty the whole portfolio.
 */
export async function scanNetwork(
    address: string,
    network: EvmNetwork,
    deps: ScanDeps = defaultDeps
): Promise<EvmNetworkResult> {
    const tokensOut: EvmPortfolioToken[] = []

    // Native balance first, and independently of token discovery: the gas
    // balance is the one figure that should still show when a network's
    // explorer is down, since it comes from the RPC rather than the explorer.
    try {
        const nativeBalance = await deps.readNativeBalance(address, network)
        if (nativeBalance.gt(0)) {
            tokensOut.push({
                key: `${network.evmChainId}:native`,
                address: 'native',
                symbol: network.native.symbol,
                name: network.native.name,
                decimals: network.native.decimals,
                balance: nativeBalance,
                raw: nativeBalance.toFixed(),
                isNative: true,
                network,
            })
        }
    } catch (e) {
        console.warn(`[evmPortfolio] native balance failed on ${network.name}:`, e)
    }

    const adapter = deps.explorerAdapterFor(network)
    if (!adapter) {
        return {
            network,
            status: 'skipped',
            message: `No explorer adapter for family "${network.explorerApi?.family}".`,
            tokens: tokensOut,
        }
    }

    let discovered: DiscoveredToken[]
    try {
        discovered = await adapter.discoverTokens(address, network)
    } catch (e: any) {
        const skipped = e instanceof MissingApiKeyError || e instanceof ExplorerThrottledError
        return {
            network,
            status: skipped ? 'skipped' : 'error',
            message: e?.message ?? 'Token discovery failed.',
            tokens: tokensOut,
        }
    }

    const registry = tokenRegistryFor(network)

    // Balances and decimals come from the contracts, never from the explorer
    // — see evm/tokenReader.ts.
    const states = await pooled(discovered, BALANCE_CONCURRENCY, async (token) => {
        try {
            // Drop impostors of a symbol the registry pins to another address
            // before spending a balance call on them.
            if (registry.isSpoofedToken(token.symbol, token.address, network.evmChainId)) {
                return null
            }
            const state = await deps.readTokenState(
                token.address,
                address,
                network,
                token.decimals
            )
            if (Big(state.raw).lte(0)) return null
            return { token, state }
        } catch (e) {
            // One bad contract (non-standard balanceOf, self-destructed,
            // honeypot) must not drop every other token on this network.
            console.warn(
                `[evmPortfolio] balance read failed for ${token.address} on ${network.name}:`,
                e
            )
            return null
        }
    })

    for (const entry of states) {
        if (!entry) continue
        const { token, state } = entry
        tokensOut.push({
            key: `${network.evmChainId}:${token.address}`,
            address: token.address,
            symbol: token.symbol,
            name: token.name,
            decimals: state.decimals,
            balance: state.balance,
            raw: state.raw,
            logoUri: token.logoUri,
            isNative: false,
            network,
        })
    }

    return { network, status: 'ok', tokens: tokensOut }
}

export const useEvmPortfolioStore = defineStore('evmPortfolio', () => {
    const results = ref<EvmNetworkResult[]>([])
    const loading = ref(false)

    // Remembered so refresh() can re-run without callers replaying the
    // address, and so `ensureLoaded` can tell "already have this" from
    // "never scanned".
    let lastAddress: string | null = null
    let lastIsTestnet: boolean | null = null
    let inFlight: Promise<void> | null = null

    /** Flat token list across every network, highest balance first. */
    const tokens = computed((): EvmPortfolioToken[] =>
        results.value
            .flatMap((r) => r.tokens)
            .sort((a, b) => {
                if (a.isNative !== b.isNative) return a.isNative ? -1 : 1
                return b.balance.cmp(a.balance)
            })
    )

    /** Networks that could not be scanned, for surfacing partial results honestly. */
    const failedNetworks = computed((): EvmNetworkResult[] =>
        results.value.filter((r) => r.status === 'error' || r.status === 'skipped')
    )

    /**
     * Which networks to scan.
     *
     * Mainnets and testnets are never mixed: a testnet balance listed beside a
     * real one, with no price and no meaning, reads as real money. The active
     * network decides which side of that line the portfolio is on.
     */
    const networksToScan = (isTestnet: boolean): EvmNetwork[] => {
        loadCustomEvmNetworks()
        return getEvmNetworks().filter((n) => n.isTestnet === isTestnet)
    }

    const fetch = async (address: string | null, isTestnet = false): Promise<void> => {
        lastAddress = address
        lastIsTestnet = isTestnet
        if (!address) {
            results.value = []
            return
        }

        loading.value = true
        const networks = networksToScan(isTestnet)

        // Seed the pending list, but CARRY FORWARD whatever each network
        // last returned. Blanking here made every refresh empty the list for
        // the seconds a full scan takes — and because this store is shared,
        // opening the token picker also wiped the portfolio page behind it.
        // A refresh should update in place, not flash empty.
        const previous = new Map(results.value.map((r) => [r.network.evmChainId, r]))
        results.value = networks.map((network) => ({
            network,
            status: 'loading' as EvmNetworkStatus,
            tokens: previous.get(network.evmChainId)?.tokens ?? [],
        }))

        try {
            // Etherscan-family networks share ONE API key and therefore one
            // rate-limit budget, so they run in series; every other network is
            // an independent host and runs in parallel.
            const parallel = networks.filter((n) => n.explorerApi?.family !== 'etherscan')
            const serial = networks.filter((n) => n.explorerApi?.family === 'etherscan')

            const settle = (result: EvmNetworkResult) => {
                const idx = results.value.findIndex(
                    (r) => r.network.evmChainId === result.network.evmChainId
                )
                if (idx !== -1) results.value[idx] = result
            }

            await Promise.all([
                ...parallel.map((n) => scanNetwork(address, n).then(settle)),
                (async () => {
                    for (const n of serial) settle(await scanNetwork(address, n))
                })(),
            ])
        } finally {
            loading.value = false
        }
    }

    /** Re-runs the last scan. No-op when nothing has been scanned yet. */
    const refresh = async (isTestnet = false): Promise<void> => {
        await fetch(lastAddress, isTestnet)
    }

    /**
     * Loads only if this exact scan has not already been done.
     *
     * This is what every *consumer* should call — the portfolio page on mount,
     * the token picker on open — so they all show one list produced by one
     * scan. Forcing a fresh `fetch()` per consumer meant the picker kicked off
     * a full re-scan of every network each time it opened, which is both slow
     * and pointless when the data is already sitting there.
     *
     * Concurrent callers share the in-flight promise rather than starting
     * competing scans. `fetch()` stays available for an explicit user-driven
     * refresh.
     */
    const ensureLoaded = async (address: string | null, isTestnet = false): Promise<void> => {
        if (address && address === lastAddress && isTestnet === lastIsTestnet) {
            if (inFlight) await inFlight
            return
        }
        if (inFlight) {
            await inFlight
            // The scan that just finished may have been for this exact
            // request; re-check rather than starting a second one.
            if (address === lastAddress && isTestnet === lastIsTestnet) return
        }
        inFlight = fetch(address, isTestnet).finally(() => {
            inFlight = null
        })
        await inFlight
    }

    /**
     * Forgets the scan and everything remembered about who it was for.
     *
     * `lastAddress`/`lastIsTestnet` matter as much as `results` here: leaving
     * them set would let `ensureLoaded` decide it already had the answer for
     * the next wallet that happened to reconnect at the same address, and
     * `inFlight` would let a scan started for the old session write its results
     * into the new one.
     */
    const resetSession = () => {
        results.value = []
        loading.value = false
        lastAddress = null
        lastIsTestnet = null
        inFlight = null
    }

    return {
        results,
        tokens,
        failedNetworks,
        loading,
        fetch,
        refresh,
        ensureLoaded,
        resetSession,
    }
})
