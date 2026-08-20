/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The unified EVM platform.
 *
 * This replaces what used to be one platform per EVM chain (`robinhood`,
 * `ethereum`, …). That factoring was wrong: those chains differ only in their
 * *parameters* — chain id, RPC, explorer, native asset — not in how the wallet
 * talks to them, so each new chain meant a new folder duplicating the same
 * connect/balance/send code. Here there is one platform and chains are rows in
 * `src/evm/networks.json`, extensible by the user at runtime.
 *
 * Avalanche keeps its own platform: it exposes X and P chains, staking and
 * atomic cross-chain transfers, none of which are EVM concepts. Avalanche
 * C-Chain still appears in this registry so its tokens show up alongside every
 * other chain's in the aggregated portfolio — the two views coexist rather
 * than one replacing the other.
 *
 * Colour scheme is carried over from the Robinhood integration this
 * generalises.
 */
import type {
    AccessMethodDescriptor,
    Platform,
    PlatformCapabilities,
    PlatformChain,
    PlatformDescriptor,
    PlatformNetwork,
    PlatformTokenRegistry,
    PlatformWallet,
} from '../types'
import { getEvmNetworks, type EvmNetwork } from '@/evm/networkRegistry'
import type { EvmSigner } from '@/evm/signer'
import { InjectedEvmSigner } from './signer'
import { peekActiveNetwork, peekActiveWallet } from './store'
import { activeEvmTokenRegistry } from './tokenRegistry'
import { connectInjected, type EvmWallet } from './wallet'

/** High-luminance chartreuse — carried over from the Robinhood integration. */
export const EVM_ACCENT = 'rgb(204, 255, 0)'

const descriptor: PlatformDescriptor = {
    id: 'evm',
    name: 'EVM Networks',
    symbol: 'ETH',
    status: 'available',
    description: 'Ethereum, Base, Arbitrum, Polygon, Avalanche C-Chain and more — one wallet.',
    theme: {
        accent: EVM_ACCENT,
        // The accent is a high-luminance chartreuse, so anything drawn on top
        // of it must be dark to stay legible — white-on-accent is unreadable.
        onAccent: '#101410',
        logo: EVM_ACCENT,
    },
}

/**
 * A single account-model chain: no cross-chain transfers, no native staking,
 * and no in-app swap (no DEX aggregator is wired up generically yet).
 *
 * `offlineSigning` is false because the existing offline-signing flow is built
 * on Avalanche's transaction types; enabling it here would silently produce
 * unusable payloads.
 */
const capabilities: PlatformCapabilities = {
    send: true,
    receive: true,
    stake: false,
    swap: false,
    crossChain: false,
    signMessage: true,
    collectibles: false,
    offlineSigning: false,
}

/**
 * Injected-wallet only for now.
 *
 * The mnemonic/keystore/private-key routes are deliberately absent rather than
 * pointed at the existing views: those flows construct Avalanche wallets (they
 * derive X/P addresses and write to the Avalanche stores), so listing them
 * here would hand back a wallet that cannot talk to these chains.
 */
const accessMethods: AccessMethodDescriptor[] = [
    {
        id: 'injected',
        label: 'Connect Wallet',
        labelKey: 'access.but_connect_wallet',
        kind: 'action',
        run: async () => {
            const { useEvmStore } = await import('./store')
            await useEvmStore().connectInjected()
        },
    },
]

/** Translates a registry entry into the platform-neutral network shape. */
function toPlatformNetwork(n: EvmNetwork): PlatformNetwork {
    return {
        id: n.id,
        name: n.name,
        isTestnet: n.isTestnet,
        rpcUrl: n.rpcUrl,
        wsUrl: n.wsUrl,
        explorerUrl: n.explorerUrl,
        evmChainId: n.evmChainId,
        nativeSymbol: n.native.symbol,
        nativeDecimals: n.native.decimals,
    }
}

export const evmPlatform: Platform = {
    descriptor,
    capabilities,
    accessMethods,

    /**
     * Exactly one chain, reflecting the *active* network.
     *
     * Derived rather than fixed: the UI reads `chains` to decide which
     * surfaces to show, and `evmChainId` has to follow the selected network or
     * anything keyed off it would silently target the wrong chain. Because
     * there is no `utxo` or `staking` chain here, every X/P-chain and staking
     * surface hides itself with no per-platform branching in the views.
     */
    get chains(): PlatformChain[] {
        const network = peekActiveNetwork()
        return [
            {
                id: 'EVM',
                label: network?.name ?? 'EVM',
                kind: 'evm',
                evmChainId: network?.evmChainId,
            },
        ]
    },

    get networks(): PlatformNetwork[] {
        return getEvmNetworks().map(toPlatformNetwork)
    },

    get tokenRegistry(): PlatformTokenRegistry {
        return activeEvmTokenRegistry()
    },

    getActiveNetwork(): PlatformNetwork | null {
        const network = peekActiveNetwork()
        return network ? toPlatformNetwork(network) : null
    },

    async setActiveNetwork(id: string): Promise<void> {
        const { useEvmStore } = await import('./store')
        await useEvmStore().setNetwork(id)
    },

    getActiveWallet(): PlatformWallet | null {
        // Reads the store's module-scope mirror rather than constructing the
        // Pinia store: this is called from synchronous contexts that may run
        // before Pinia is installed. See the note in ./store.ts.
        return peekActiveWallet()
    },

    /**
     * Bound to the connected wallet's own network — `EvmWallet.network`, not
     * the picker's current selection. Connecting adopts whatever chain the
     * extension was already on (see `connectInjected`), so those two can
     * legitimately differ, and the wallet's is the one its transactions go to.
     */
    getEvmSigner(): EvmSigner | null {
        const wallet = peekActiveWallet()
        return wallet ? new InjectedEvmSigner(wallet as EvmWallet) : null
    },

    async logout(): Promise<void> {
        const { useEvmStore } = await import('./store')
        useEvmStore().disconnect()
    },
}

export { connectInjected }
export default evmPlatform
