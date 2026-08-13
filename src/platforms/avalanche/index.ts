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

import { useMainStore, useAssetsStore } from '@/stores'
import { bnToBig } from '@/helpers/helper'
import type { Wallet } from '@/js/wallets/AbstractWallet'

import type {
    AccessMethodDescriptor,
    Platform,
    PlatformAddress,
    PlatformBalance,
    PlatformCapabilities,
    PlatformDescriptor,
    PlatformWallet,
} from '../types'

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

    getActiveWallet(): PlatformWallet | null {
        const wallet = useMainStore().activeWallet
        return wallet ? new AvalancheWallet(wallet as Wallet) : null
    },

    async logout(): Promise<void> {
        await useMainStore().logout()
    },
}

export default avalanchePlatform
