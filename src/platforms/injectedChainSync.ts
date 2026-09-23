/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Keeps the wallet on whatever chain the injected extension is on.
 *
 * Switching networks inside MetaMask or Core used to change nothing here: the
 * EVM tab kept reading balances for, and composing sends against, the chain it
 * connected on, while the extension had moved elsewhere. `assertOnChain`
 * stopped a send from actually broadcasting on the wrong chain, but the screen
 * was silently showing a network the wallet was no longer on.
 *
 * One `chainChanged` listener serves both extension-backed EVM-family
 * platforms:
 *
 *  - The injected EVM wallet follows EVERY chain the registry knows, C-Chain
 *    included — the EVM tab mirrors the extension, so its balance and gas
 *    coin read ETH on Ethereum and AVAX on Avalanche.
 *  - An injected Avalanche session additionally follows mainnet <-> Fuji.
 *  - A chain the registry does not know changes nothing: there is no network
 *    to display it as. Sends stay blocked by `assertOnChain`.
 *
 * The one tab move: the extension leaving Avalanche while the user is on an
 * extension-backed Avalanche tab brings the EVM tab forward, since the
 * Avalanche tab cannot show any other chain. Nothing else changes focus —
 * someone on a Solana tab, or on an EVM tab opened from a recovery phrase, is
 * not using the extension, and being yanked away from it would be wrong.
 */
import { useMainStore } from '@/stores/main'
import { useNetworkStore } from '@/stores/network'
import { getEvmNetworkByChainId, type EvmNetwork } from '@/evm/networkRegistry'
import { useActivePlatformStore } from './store'
import { useEvmStore } from './evm/store'
import { InjectedEvmWallet, type Eip1193Provider } from './evm/wallet'
import type { PlatformId } from './types'

/** Avalanche's C-Chain ids, and the Avalanche `networkId` each one means. */
const AVALANCHE_NETWORK_BY_CHAIN: Record<number, number> = {
    43114: 1, // Mainnet
    43113: 5, // Fuji
}

export interface ChainRouteContext {
    /** Avalanche is connected through the extension. */
    avalancheInjected: boolean
    /** The EVM platform is connected through the extension. */
    evmInjected: boolean
    activePlatformId: PlatformId
}

export interface ChainRoute {
    /** Avalanche `networkId` to move the Avalanche network to. */
    avalancheNetworkId?: number
    /** Network to rebind the injected EVM wallet to. */
    evmNetwork?: EvmNetwork
    /** Platform to bring to the front. */
    activate?: PlatformId
}

/**
 * Where a chain change should land. Pure, so the routing rules above can be
 * tested without an extension, a network or a Pinia store.
 */
export function routeChainChange(chainId: number, ctx: ChainRouteContext): ChainRoute {
    const route: ChainRoute = {}

    const avalancheNetworkId = AVALANCHE_NETWORK_BY_CHAIN[chainId]
    if (avalancheNetworkId !== undefined && ctx.avalancheInjected) {
        route.avalancheNetworkId = avalancheNetworkId
    }

    const evmNetwork = getEvmNetworkByChainId(chainId)
    if (evmNetwork && ctx.evmInjected) {
        route.evmNetwork = evmNetwork
        const onExtensionAvalancheTab =
            ctx.activePlatformId === 'avalanche' && ctx.avalancheInjected
        if (avalancheNetworkId === undefined && onExtensionAvalancheTab) route.activate = 'evm'
    }

    return route
}

function parseChainId(raw: unknown): number | null {
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
        const n = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
    }
    return null
}

async function followChain(raw: unknown): Promise<void> {
    const chainId = parseChainId(raw)
    if (chainId === null) return

    const mainStore = useMainStore()
    const evmStore = useEvmStore()
    const platformStore = useActivePlatformStore()

    const route = routeChainChange(chainId, {
        avalancheInjected: mainStore.avalancheWallet?.type === 'injected',
        evmInjected: evmStore.wallet instanceof InjectedEvmWallet,
        activePlatformId: platformStore.activePlatformId,
    })

    try {
        if (route.avalancheNetworkId !== undefined) {
            const networkStore = useNetworkStore()
            if (networkStore.selectedNetwork?.networkId !== route.avalancheNetworkId) {
                const target = networkStore.networks.find(
                    (n) => n.networkId === route.avalancheNetworkId
                )
                if (target) await networkStore.setNetwork(target)
            }
        }
        if (route.evmNetwork) evmStore.followExtensionChain(route.evmNetwork)
        // Never the logout-and-reload path: an extension event must not end
        // every session. All current platforms hand over in place anyway.
        if (
            route.activate &&
            route.activate !== platformStore.activePlatformId &&
            !platformStore.isDestructiveSwitch(route.activate)
        ) {
            await platformStore.setActivePlatform(route.activate)
        }
    } catch (e) {
        console.warn('[injectedChainSync] Could not follow the extension chain:', e)
    }
}

/**
 * Events are handled one at a time. Core fires `chainChanged` on both of its
 * handles, and two overlapping Avalanche network switches would race each
 * other; run in order, the second finds everything already in place.
 */
let pending: Promise<void> = Promise.resolve()
function onChainChanged(raw: unknown): void {
    pending = pending.then(() => followChain(raw))
}

/** Providers already listened to — `window.ethereum` lives as long as the page. */
const attached = new WeakSet<object>()

/**
 * Start following the extension's chain. Idempotent, and safe to call from
 * every injected connect path: the handler decides at event time which
 * sessions are actually extension-backed.
 */
export function attachInjectedChainSync(): void {
    const w = window as any
    // Core injects both handles; other extensions only `window.ethereum`.
    // They can be the same object, which the WeakSet dedupes.
    for (const provider of [w.ethereum, w.avalanche] as (Eip1193Provider | undefined)[]) {
        if (!provider?.on || attached.has(provider)) continue
        provider.on('chainChanged', onChainChanged)
        attached.add(provider)
    }
}
