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
import { InjectedEvmSigner, LocalEvmSigner } from './signer'
import { peekActiveNetwork, peekActiveWallet } from './store'
import { activeEvmTokenRegistry } from './tokenRegistry'
import {
    connectInjected,
    getEvmProvider,
    InjectedEvmWallet,
    LocalEvmWallet,
} from './wallet'

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
 * Injected-wallet only, as an entry of this platform's own.
 *
 * A recovery phrase opens this platform too — see `unlockWithMnemonic` below —
 * but it deliberately does NOT appear here, for two separate reasons:
 *
 *  - It is already reachable from this same screen. `views/access/Menu.vue`
 *    renders the one-phrase multi-platform unlock above the platform picker,
 *    for every platform, so a phrase entry here would be a second door to
 *    `/access/multi` a few pixels below the first.
 *  - These ids are read as capability flags elsewhere. That view treats
 *    `mnemonic`/`privatekey`/`keystore` as "this platform can be opened by a
 *    locally-held key" and shows the saved-accounts list accordingly — but a
 *    saved account is an Avalanche keystore, and opening one builds an
 *    Avalanche wallet. Claiming the id here would offer those accounts on this
 *    platform, where they mean nothing.
 *
 * The keystore and private-key routes stay absent for the original reason: the
 * existing views construct Avalanche wallets (they derive X/P addresses and
 * write to the Avalanche stores), so listing them here would hand back a wallet
 * that cannot talk to these chains.
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

    // The whole session is this platform's own Pinia store — see ./store.ts.
    // Nothing here touches the legacy global stores, so it can stay connected
    // alongside other platforms. See `supportsConcurrentSession` in ../types.ts.
    supportsConcurrentSession: true,

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
     *
     * Which signer depends on who holds the key, and getting it wrong is not a
     * cosmetic error: handing a phrase-opened wallet to the injected signer
     * would route its transactions to `eth_sendTransaction` on an extension
     * that has never heard of this account. A watch-only wallet gets no signer
     * at all, so EVM-only features disable themselves rather than offering a
     * button that cannot work.
     */
    getEvmSigner(): EvmSigner | null {
        const wallet = peekActiveWallet()
        if (wallet instanceof LocalEvmWallet) return new LocalEvmSigner(wallet)
        if (wallet instanceof InjectedEvmWallet) return new InjectedEvmSigner(wallet)
        return null
    },

    /**
     * Opens an EVM session from a recovery phrase, without navigating.
     *
     * The same BIP-39 phrase that opens Bitcoin, Solana and Avalanche is a
     * perfectly good credential on every EVM chain — this platform was simply
     * extension-only until now, so a one-phrase unlock silently left the EVM
     * tab out. It derives at the standard `m/44'/60'/0'/0/0`, which is also the
     * path Avalanche derives its C-Chain key at, so both tabs opened from one
     * phrase show the same 0x address (see evm/keys.ts).
     *
     * `navigate: false` leaves the single `/wallet` push to the caller, which
     * may still be unlocking other platforms.
     */
    async unlockWithMnemonic(mnemonic: string, sessionPassword: string): Promise<void> {
        const { useEvmStore } = await import('./store')
        await useEvmStore().accessWithMnemonic(mnemonic, sessionPassword, { navigate: false })
    },

    /**
     * Any EIP-1193 provider will do — this platform is chain-agnostic, and
     * every extension that injects one can sign for it on some chain.
     *
     * Synchronous and silent, as the contract requires: reading the handle off
     * `window` tells us an extension is there without asking it for anything.
     */
    isInjectedAvailable(): boolean {
        return getEvmProvider() != null
    },

    /**
     * Opens an EVM session from the installed extension, without navigating.
     *
     * `navigate: false` leaves the single `/wallet` push to the caller, which
     * may still be connecting other platforms from the same extension — see
     * `connectWithInjected` in ../store.ts.
     */
    async connectInjected(): Promise<void> {
        const { useEvmStore } = await import('./store')
        await useEvmStore().connectInjected({ navigate: false })
    },

    async logout(): Promise<void> {
        const { useEvmStore } = await import('./store')
        useEvmStore().disconnect()
    },
}

export { connectInjected }
export default evmPlatform
