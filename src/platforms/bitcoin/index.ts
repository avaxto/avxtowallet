/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Bitcoin platform.
 *
 * Bitcoin is a UTXO chain, which makes it the closest conceptual match to
 * Avalanche's X-Chain of anything here — but only conceptually. None of the
 * X-Chain code is reusable: different address encodings (four of them), a
 * different signature scheme layout, no atomic imports/exports, an explicit
 * per-vbyte fee market instead of a fixed fee, and no shared library. So this
 * is a self-contained implementation, reaching into `@/bitcoin/` for chain
 * primitives the same way the EVM and Solana platforms use `@/evm/` and
 * `@/solana/`.
 *
 * Custody is local-key only. Unlike Solana — where Phantom's interface became
 * a de-facto standard every wallet copied — Bitcoin browser extensions
 * (Unisat, Xverse, Leather, OKX) each expose a bespoke API, so "connect
 * wallet" would mean writing and maintaining an adapter per vendor rather than
 * one integration. Watch-only covers the read-only case in the meantime.
 */
import type {
    AccessMethodDescriptor,
    Platform,
    PlatformCapabilities,
    PlatformChain,
    PlatformDescriptor,
    PlatformNetwork,
    PlatformWallet,
} from '../types'
import { getBitcoinNetworks, type BitcoinNetwork } from '@/bitcoin/networks'
import { peekActiveNetwork, peekActiveWallet } from './store'

/** Bitcoin orange. */
export const BITCOIN_ACCENT = 'rgb(247, 147, 26)'

const descriptor: PlatformDescriptor = {
    id: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    status: 'available',
    description: 'Native BTC — SegWit, Taproot and legacy.',
    theme: {
        accent: BITCOIN_ACCENT,
        // Bitcoin orange is mid-luminance; dark text reads better on it than
        // white, the same reasoning as the EVM platform's chartreuse.
        onAccent: '#1a1206',
        logo: BITCOIN_ACCENT,
    },
}

/**
 * What this platform can do today.
 *
 * `signMessage` is false: Bitcoin message signing has two competing formats
 * (the legacy BIP-137 scheme and BIP-322), and which one a verifier accepts
 * depends on the address type. Declaring it true would light up a UI producing
 * signatures many verifiers reject.
 *
 * `stake` and `swap` have no Bitcoin equivalent. `crossChain` is false —
 * Bitcoin has one chain. `collectibles` is false: ordinals/inscriptions exist
 * but need an indexer this wallet does not have, and mis-handling them risks
 * spending an inscribed sat as ordinary change.
 */
const capabilities: PlatformCapabilities = {
    send: true,
    receive: true,
    stake: false,
    swap: false,
    crossChain: false,
    signMessage: false,
    collectibles: false,
    offlineSigning: false,
}

/**
 * Local-key and watch-only access.
 *
 * The ids matter beyond labelling: `views/access/Menu.vue` treats
 * `mnemonic`/`privatekey`/`keystore` as "this platform can be accessed by a
 * locally-held key", and `js/security/authorize.ts` gates signing on them.
 *
 * Routes are Bitcoin's own rather than the unprefixed ones, which build
 * Avalanche wallets.
 */
const accessMethods: AccessMethodDescriptor[] = [
    {
        id: 'mnemonic',
        label: 'Recovery Phrase',
        kind: 'route',
        route: '/access/bitcoin/mnemonic',
    },
    {
        id: 'privatekey',
        label: 'Private Key (WIF)',
        kind: 'route',
        route: '/access/bitcoin/privatekey',
    },
    {
        id: 'watch',
        label: 'Watch an Address or xpub',
        kind: 'route',
        route: '/access/bitcoin/watch',
        readonly: true,
    },
]

function toPlatformNetwork(n: BitcoinNetwork): PlatformNetwork {
    return {
        id: n.id,
        name: n.name,
        isTestnet: n.isTestnet,
        // The Esplora REST base is this platform's equivalent of an RPC URL —
        // it is where every read and the broadcast go.
        rpcUrl: n.esploraUrl,
        explorerUrl: n.explorerUrl,
        nativeSymbol: n.native.symbol,
        nativeDecimals: n.native.decimals,
    }
}

export const bitcoinPlatform: Platform = {
    descriptor,
    capabilities,
    accessMethods,

    // The whole session is this platform's own Pinia store — see ./store.ts.
    // Nothing here touches the legacy global stores, so it can stay connected
    // alongside other platforms. See `supportsConcurrentSession` in ../types.ts.
    supportsConcurrentSession: true,

    /**
     * One chain, of kind `bitcoin` — deliberately NOT `utxo`.
     *
     * Bitcoin genuinely is a UTXO chain, so `utxo` reads like the honest
     * label. It is the wrong one: in this codebase `utxo` is consumed as a
     * proxy for "is this Avalanche?". Every one of the eight call sites tests
     * `hasChainKind('utxo') || hasChainKind('staking')` and names the result
     * `isAvalanche` — App.vue boots the Avalanche network store behind it,
     * Transfer.vue renders the X-Chain send form, BalanceCard renders X/P
     * rows out of Avalanche's store. Claiming `utxo` here turns all of that on
     * and produces a broken wallet.
     *
     * See the note on `PlatformChainKind` in ../types.ts.
     */
    get chains(): PlatformChain[] {
        const network = peekActiveNetwork()
        return [
            {
                id: 'BTC',
                label: network?.name ?? 'Bitcoin',
                kind: 'bitcoin',
            },
        ]
    },

    get networks(): PlatformNetwork[] {
        return getBitcoinNetworks().map(toPlatformNetwork)
    },

    getActiveNetwork(): PlatformNetwork | null {
        const network = peekActiveNetwork()
        return network ? toPlatformNetwork(network) : null
    },

    async setActiveNetwork(id: string): Promise<void> {
        const { useBitcoinStore } = await import('./store')
        await useBitcoinStore().setNetwork(id)
    },

    getActiveWallet(): PlatformWallet | null {
        // Module-scope mirror rather than the Pinia store — this is called
        // from synchronous contexts that may run before Pinia is installed.
        return peekActiveWallet()
    },

    // No getEvmSigner: Bitcoin has no EVM chain, which is what correctly
    // disables every EVM-only feature without those features naming Bitcoin.

    // Bitcoin's own derivation runs behind this — the same probe of all four
    // standard address types plus the Core-compatible candidate the dedicated
    // screen performs, since opening on an empty address would be no better
    // here than there. `navigate: false` is what makes it composable: the
    // caller unlocking several platforms navigates once, at the end.
    async unlockWithMnemonic(mnemonic: string, sessionPassword: string): Promise<void> {
        const { useBitcoinStore } = await import('./store')
        await useBitcoinStore().accessWithMnemonic(mnemonic, sessionPassword, {
            navigate: false,
        })
    },

    async logout(): Promise<void> {
        const { useBitcoinStore } = await import('./store')
        useBitcoinStore().disconnect()
    },
}

export default bitcoinPlatform
