/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Robinhood Chain platform adapter.
 *
 * NOTE: this replaces an earlier stub that modelled Robinhood as a *custodial
 * brokerage* (API session, no local keys). That was the wrong target. Robinhood
 * Chain is a self-custodial Arbitrum L2 on Ethereum with ETH as its native gas
 * token — an ordinary EVM chain the user holds keys for. If a custodial
 * brokerage integration is ever wanted it belongs under a separate platform id,
 * because its custody model and access methods share nothing with this one.
 *
 * Because it declares exactly one `evm` chain and no `utxo`/`staking` chain,
 * the UI hides every X/P-chain surface automatically — see `chains` in
 * ../types.ts. Nothing in the feature components tests for this platform's id.
 */
import type {
    AccessMethodDescriptor,
    Platform,
    PlatformCapabilities,
    PlatformDescriptor,
    PlatformNetwork,
    PlatformWallet,
} from '../types'
import { ROBINHOOD_ACCENT, ROBINHOOD_CHAINS, ROBINHOOD_NETWORKS, getRobinhoodNetwork } from './config'
import { peekActiveWallet } from './store'
import { connectInjected } from './wallet'

const descriptor: PlatformDescriptor = {
    id: 'robinhood',
    name: 'Robinhood',
    symbol: 'ETH',
    status: 'available',
    description: 'Robinhood Chain — an Arbitrum L2 on Ethereum. ETH and ERC-20 tokens.',
    theme: {
        accent: ROBINHOOD_ACCENT,
        // Robinhood's accent is a high-luminance chartreuse, so anything placed
        // on top of it must be dark to stay legible — white-on-accent would be
        // unreadable.
        onAccent: '#101410',
        logo: ROBINHOOD_ACCENT,
    },
}

/**
 * A single EVM chain: no cross-chain transfers, no native staking, and no
 * in-app swap (no DEX aggregator is wired up for this chain yet).
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
 * derive X/P addresses and write to the Avalanche stores), so listing them here
 * would hand back a wallet that cannot talk to this chain.
 */
const accessMethods: AccessMethodDescriptor[] = [
    {
        id: 'injected',
        label: 'Connect Wallet',
        labelKey: 'access.but_connect_wallet',
        kind: 'action',
        run: async () => {
            const { useRobinhoodStore } = await import('./store')
            await useRobinhoodStore().connectInjected()
        },
    },
]

let activeNetworkId = ROBINHOOD_NETWORKS[0].id

export const robinhoodPlatform: Platform = {
    descriptor,
    capabilities,
    accessMethods,
    chains: ROBINHOOD_CHAINS,
    networks: ROBINHOOD_NETWORKS,

    getActiveNetwork(): PlatformNetwork | null {
        return getRobinhoodNetwork(activeNetworkId) ?? null
    },

    async setActiveNetwork(id: string): Promise<void> {
        if (!getRobinhoodNetwork(id)) {
            throw new Error(`Unknown Robinhood Chain network: ${id}`)
        }
        activeNetworkId = id
    },

    getActiveWallet(): PlatformWallet | null {
        // Reads the store's module-scope mirror rather than constructing the
        // Pinia store: this is called from synchronous contexts that may run
        // before Pinia is installed. See the note in ./store.ts.
        return peekActiveWallet()
    },

    async logout(): Promise<void> {
        const { useRobinhoodStore } = await import('./store')
        useRobinhoodStore().disconnect()
    },
}

export { connectInjected }
export default robinhoodPlatform
