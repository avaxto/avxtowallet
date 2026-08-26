/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Solana platform.
 *
 * Solana's account model is neither Avalanche's UTXO chains nor the EVM, so
 * this is a self-contained implementation rather than a reuse of either:
 * ed25519 keys (SLIP-0010, not BIP-32), base58 addresses, a single chain with
 * no atomic cross-chain transfers, and SPL token accounts instead of ERC-20
 * contract balances. Nothing here reaches into `@/AVA`, `@/js/wallets` or the
 * vendored Avalanche SDKs.
 *
 * Custody covers both models the wallet supports:
 *   - an injected extension (Phantom/Solflare) holds the key and approves each
 *     action;
 *   - a recovery phrase or private key imported into this app, encrypted in a
 *     `SessionVault` and signed for behind the session-password gate.
 *
 * It declares a single chain of kind `solana` (see `chains` below), which
 * matches none of the kinds the UI gates on — so every X/P-chain, staking,
 * cross-chain and EVM-only surface hides itself with no per-platform branching
 * in the views.
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
import { getSolanaNetworks, type SolanaNetwork } from '@/solana/networks'
import { solanaTokenRegistry } from '@/solana/tokenRegistry'
import { peekActiveNetwork, peekActiveWallet } from './store'

/** Solana's brand purple, used as the interface accent while active. */
export const SOLANA_ACCENT = 'rgb(153, 69, 255)'

const descriptor: PlatformDescriptor = {
    id: 'solana',
    name: 'Solana',
    symbol: 'SOL',
    status: 'available',
    description: 'SOL and SPL tokens.',
    theme: {
        accent: SOLANA_ACCENT,
        // A saturated mid-purple: white sits comfortably on it, unlike the
        // EVM platform's high-luminance chartreuse.
        onAccent: '#ffffff',
        logo: SOLANA_ACCENT,
    },
}

/**
 * What this platform can do today.
 *
 * `stake` is false despite Solana having first-class native staking: delegating
 * means creating and funding a stake account and delegating it to a vote
 * account, which is a genuinely separate feature surface rather than a variant
 * of the existing (Avalanche-shaped) staking views. Declaring it true would
 * light up an Earn tab built entirely around P-Chain delegation.
 *
 * `collectibles` is false because Solana NFTs are just SPL mints with decimals
 * 0 and off-chain Metaplex metadata; recognising them properly needs a
 * metadata reader that does not exist here yet, and listing them as fungible
 * dust would be worse than not listing them.
 *
 * `crossChain` is false because Solana has one chain — there is nothing to
 * transfer between. `offlineSigning` is false because the existing
 * offline-signing flow serialises Avalanche transaction types.
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
 * Both custody models, plus watch-only.
 *
 * The ids matter beyond labelling: `views/access/Menu.vue` treats
 * `mnemonic`/`privatekey`/`keystore` as "this platform can be accessed by a
 * locally-held key" and shows the saved-accounts list accordingly, and
 * `js/security/authorize.ts` treats `injected` as externally authorized.
 *
 * The routes are Solana's own rather than the existing `/access/mnemonic`:
 * those views construct Avalanche wallets (they derive X/P addresses and write
 * to the Avalanche stores), so pointing at them would hand back a wallet that
 * cannot talk to Solana at all.
 */
const accessMethods: AccessMethodDescriptor[] = [
    {
        id: 'injected',
        label: 'Connect Wallet',
        labelKey: 'access.but_connect_wallet',
        kind: 'action',
        run: async () => {
            const { useSolanaStore } = await import('./store')
            await useSolanaStore().connectInjected()
        },
    },
    {
        id: 'mnemonic',
        label: 'Recovery Phrase',
        kind: 'route',
        route: '/access/solana/mnemonic',
    },
    {
        id: 'privatekey',
        label: 'Private Key',
        kind: 'route',
        route: '/access/solana/privatekey',
    },
    {
        id: 'watch',
        label: 'Watch an Address',
        kind: 'route',
        route: '/access/solana/watch',
        readonly: true,
    },
]

function toPlatformNetwork(n: SolanaNetwork): PlatformNetwork {
    return {
        id: n.id,
        name: n.name,
        isTestnet: n.isTestnet,
        rpcUrl: n.rpcUrl,
        wsUrl: n.wsUrl,
        explorerUrl: n.explorerUrl,
        nativeSymbol: n.native.symbol,
        nativeDecimals: n.native.decimals,
    }
}

export const solanaPlatform: Platform = {
    descriptor,
    capabilities,
    accessMethods,

    /**
     * Exactly one chain, of its own kind.
     *
     * Deliberately not `evm`: that kind is what EVM-only surfaces gate on (the
     * ERC-20 dropdown, `getEvmSigner`), none of which Solana can serve. Not
     * `utxo` or `staking` either — those gate Avalanche's X/P surfaces.
     * Claiming any of them would light up UI that cannot work here, so Solana
     * declares its own kind and every `hasChainKind` check correctly reports
     * false, leaving a plain single-chain account wallet.
     */
    get chains(): PlatformChain[] {
        const network = peekActiveNetwork()
        return [
            {
                id: 'SOL',
                label: network?.name ?? 'Solana',
                kind: 'solana',
            },
        ]
    },

    get networks(): PlatformNetwork[] {
        return getSolanaNetworks().map(toPlatformNetwork)
    },

    get tokenRegistry(): PlatformTokenRegistry {
        return solanaTokenRegistry
    },

    getActiveNetwork(): PlatformNetwork | null {
        const network = peekActiveNetwork()
        return network ? toPlatformNetwork(network) : null
    },

    async setActiveNetwork(id: string): Promise<void> {
        const { useSolanaStore } = await import('./store')
        await useSolanaStore().setNetwork(id)
    },

    getActiveWallet(): PlatformWallet | null {
        // Reads the store's module-scope mirror rather than constructing the
        // Pinia store: this is called from synchronous contexts that may run
        // before Pinia is installed. See the note in ./store.ts.
        return peekActiveWallet()
    },

    // No getEvmSigner: Solana has no EVM chain. EVM-only features ask the
    // active platform for a signer and disable themselves when there isn't
    // one, so omitting this is what correctly hides them.

    async logout(): Promise<void> {
        const { useSolanaStore } = await import('./store')
        useSolanaStore().disconnect()
    },
}

export default solanaPlatform
