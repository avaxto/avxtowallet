/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Avalanche platform adapter.
 *
 * This wraps the existing Avalanche implementation (`js/wallets/*`, the stores,
 * and the vendored `avalanche` / `avalanche-wallet-sdk` SDKs) rather than
 * relocating it. That is deliberate: ~200 files import those modules directly,
 * so physically moving them would be a mechanical rename touching the whole
 * codebase with real regression risk and no behavioural benefit. Instead this
 * adapter is the single place that *knows* those modules exist, and everything
 * reached through the `Platform` interface is chain-neutral. Avalanche-specific
 * code can then migrate behind this boundary file-by-file.
 *
 * The vendored SDK folders (`src/avalanche`, `src/avalanche-wallet-sdk`) are
 * third-party library code, not project code, and stay where they are.
 */
import Big from 'big.js'

import { useMainStore, useAssetsStore, useNetworkStore } from '@/stores'
import { bnToBig } from '@/helpers/helper'
import type { EvmSigner } from '@/evm/signer'
import type { Wallet } from '@/js/wallets/AbstractWallet'
import type { AvaWalletCore } from '@/js/wallets/types'

import { AvalancheEvmSigner, cChainNetworkFor } from './signer'

import type {
    AccessMethodDescriptor,
    Platform,
    PlatformAddress,
    PlatformBalance,
    PlatformCapabilities,
    PlatformChain,
    PlatformDescriptor,
    PlatformNetwork,
    PlatformWallet,
} from '../types'
import { avalancheTokenRegistry } from './tokenRegistry'

const descriptor: PlatformDescriptor = {
    id: 'avalanche',
    name: 'Avalanche',
    symbol: 'AVAX',
    status: 'available',
    description: 'X, P and C chains — send, stake, swap and bridge AVAX and C-Chain tokens.',
    icon: '/img/avax_icon_circle.png',
}

const capabilities: PlatformCapabilities = {
    send: true,
    receive: true,
    stake: true,
    swap: true,
    crossChain: true,
    signMessage: true,
    collectibles: true,
    offlineSigning: true,
}

/**
 * Avalanche's three sub-chains, declared through the generic chain shape.
 *
 * This is what the UI reads to decide whether to render X/P-specific features,
 * instead of assuming every wallet has an X and a P address. A platform with
 * only an `evm` chain (Robinhood, Ethereum) therefore hides those surfaces with
 * no per-platform branching in the views.
 */
const chains: PlatformChain[] = [
    { id: 'X', label: 'X-Chain', kind: 'utxo' },
    { id: 'P', label: 'P-Chain', kind: 'staking' },
    { id: 'C', label: 'C-Chain', kind: 'evm', evmChainId: 43114 },
]

/**
 * Mirrors the built-in entries in `@/stores/network`. Declared here so the
 * generic layer can list a platform's networks uniformly; the Avalanche network
 * *store* remains the authority on which one is connected, because switching
 * involves far more than an RPC swap (blockchain ids, SDK config, pollers).
 */
const networks: PlatformNetwork[] = [
    {
        id: 'mainnet',
        name: 'Mainnet',
        isTestnet: false,
        rpcUrl: 'https://api.avax.network:443',
        explorerUrl: 'https://explorer-xp.avax.network',
        evmChainId: 43114,
        nativeSymbol: 'AVAX',
        nativeDecimals: 18,
    },
    {
        id: 'fuji',
        name: 'Fuji',
        isTestnet: true,
        rpcUrl: 'https://api.avax-test.network:443',
        explorerUrl: 'https://explorer-xp.avax-test.network',
        evmChainId: 43113,
        nativeSymbol: 'AVAX',
        nativeDecimals: 18,
    },
]

/**
 * Mirrors the buttons the access screen has always shown, in the same order.
 * The login UI renders from this list, so a platform's supported login paths
 * are declared here rather than hardcoded in the view.
 */
const accessMethods: AccessMethodDescriptor[] = [
    {
        id: 'injected',
        label: 'Connect Wallet',
        labelKey: 'access.but_connect_wallet',
        kind: 'action',
        icon: { day: '/img/coreapp.svg', night: '/img/coreapp.svg' },
        run: async () => {
            await useMainStore().accessWalletInjected()
        },
    },
    {
        id: 'ledger',
        label: 'Ledger',
        kind: 'component',
        component: 'LedgerButton',
    },
    {
        id: 'mnemonic',
        label: 'Mnemonic Key Phrase',
        labelKey: 'access.but_mnemonic',
        kind: 'route',
        route: '/access/mnemonic',
        icon: {
            day: '/img/access_icons/day/mnemonic.svg',
            night: '/img/access_icons/night/mnemonic.svg',
        },
    },
    {
        id: 'privatekey',
        label: 'Private Key',
        labelKey: 'access.but_private_key',
        kind: 'route',
        route: '/access/privatekey',
        icon: {
            day: '/img/access_icons/day/privatekey.svg',
            night: '/img/access_icons/night/privatekey.svg',
        },
    },
    {
        id: 'keystore',
        label: 'Keystore File',
        labelKey: 'access.but_keystore',
        kind: 'route',
        route: '/access/keystore',
        icon: {
            day: '/img/access_icons/day/keystore.svg',
            night: '/img/access_icons/night/keystore.svg',
        },
    },
    {
        id: 'xpub',
        label: 'XPUB (Readonly)',
        kind: 'route',
        route: '/access/xpub',
        readonly: true,
    },
]

/** Maps an internal wallet `type` onto the access method that produced it. */
function accessMethodIdForWallet(wallet: Wallet): string {
    switch (wallet.type) {
        case 'injected':
            return 'injected'
        case 'ledger':
            return 'ledger'
        case 'singleton':
            return 'privatekey'
        case 'mnemonic':
        default:
            return 'mnemonic'
    }
}

class AvalancheWallet implements PlatformWallet {
    readonly platformId = 'avalanche'
    readonly native: Wallet

    constructor(wallet: Wallet) {
        this.native = wallet
    }

    get id(): string {
        return this.native.id
    }

    get accessMethodId(): string {
        return accessMethodIdForWallet(this.native)
    }

    get isReadonly(): boolean {
        // The XPUB flow uses a separate read-only view rather than becoming the
        // active wallet, so anything active here can sign.
        return false
    }

    getAddresses(): PlatformAddress[] {
        const w = this.native
        const addresses: PlatformAddress[] = []

        // Each accessor can throw for wallet types that don't derive that chain
        // (e.g. an old Ledger app with no EVM address), so failures degrade to
        // "this chain has no address" instead of breaking the whole list.
        const push = (chain: string, label: string, read: () => string) => {
            try {
                const address = read()
                if (address) addresses.push({ chain, address, label })
            } catch {
                /* chain unavailable for this wallet type */
            }
        }

        push('X', 'X-Chain', () => w.getCurrentAddressAvm())
        push('P', 'P-Chain', () => w.getCurrentAddressPlatform())
        push('C', 'C-Chain', () => w.getEvmChecksumAddress())

        return addresses
    }

    getPrimaryAddress(): string {
        return this.getAddresses()[0]?.address ?? ''
    }

    async getBalances(): Promise<PlatformBalance[]> {
        const assetsStore = useAssetsStore()
        const balances: PlatformBalance[] = []

        // X/P chain assets (AVAX plus any ANT the wallet holds).
        for (const asset of assetsStore.walletAssetsArray) {
            balances.push({
                assetId: asset.id,
                symbol: asset.symbol,
                name: asset.name,
                decimals: asset.denomination,
                amount: bnToBig(asset.amount, asset.denomination),
                chain: 'X',
            })
        }

        // C-chain ERC20s for the active network.
        for (const token of assetsStore.networkErc20Tokens) {
            balances.push({
                assetId: token.data.address,
                symbol: token.data.symbol,
                name: token.data.name,
                decimals: parseInt(token.data.decimals as string) || 18,
                amount: token.balanceBig,
                logoUri: token.data.logoURI,
                chain: 'C',
            })
        }

        // Native C-chain AVAX, which is tracked on the wallet rather than in
        // the assets store.
        const ethBalance = this.native.ethBalance
        if (ethBalance) {
            balances.push({
                assetId: 'avax-c',
                symbol: 'AVAX',
                name: 'Avalanche',
                decimals: 18,
                amount: bnToBig(ethBalance, 18),
                chain: 'C',
            })
        }

        return balances
    }

    async signMessage(message: string, address?: string): Promise<string> {
        // Mnemonic/Ledger sign per-address on the X chain; singleton and
        // injected wallets ignore the address argument.
        return await this.native.signMessage(message, address as string)
    }
}

export const avalanchePlatform: Platform = {
    descriptor,
    capabilities,
    accessMethods,
    chains,
    networks,
    tokenRegistry: avalancheTokenRegistry,

    getActiveNetwork(): PlatformNetwork | null {
        // Derived from the Avalanche network store rather than tracked here, so
        // there is exactly one source of truth for the connected network.
        const selected = useNetworkStore().selectedNetwork
        if (!selected) return null
        return (
            networks.find((n) => n.evmChainId === (selected.networkId === 1 ? 43114 : 43113)) ??
            null
        )
    },

    getActiveWallet(): PlatformWallet | null {
        const wallet = useMainStore().activeWallet
        return wallet ? new AvalancheWallet(wallet as Wallet) : null
    },

    /**
     * Bound to the C-Chain of whichever Avalanche network is selected, read
     * from the network store rather than tracked here — same single source of
     * truth as `getActiveNetwork` above.
     */
    getEvmSigner(): EvmSigner | null {
        const wallet = useMainStore().activeWallet
        if (!wallet) return null

        const selected = useNetworkStore().selectedNetwork
        const chainId = selected?.networkId === 1 ? 43114 : 43113
        return new AvalancheEvmSigner(
            (wallet as unknown) as AvaWalletCore,
            cChainNetworkFor(chainId)
        )
    },

    // No `unlockWithMnemonic`, and deliberately so — a recovery phrase is a
    // perfectly good Avalanche credential (`/access/mnemonic` uses one). What
    // is missing is the isolation: this platform's wallet lives in the legacy
    // global stores, so it cannot hold a session alongside the others, and
    // joining the one-phrase unlock would hand the user a set of tabs that log
    // each other out. Same prerequisite, and the same fix, as
    // `supportsConcurrentSession`. See ../types.ts.

    async logout(): Promise<void> {
        await useMainStore().logout()
    },
}

export default avalanchePlatform
