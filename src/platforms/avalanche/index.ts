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

    /**
     * Avalanche can hold a session alongside the other platforms.
     *
     * This was the last platform to be able to say so, and it says it for a
     * different reason than the others. Bitcoin, Solana and EVM qualify because
     * their whole session lives in a store of their own. Avalanche's still does
     * not — it is spread across `@/stores/main`, assets, history, earn, erc721
     * and the pollers, and moving it would be a rename across some seventy
     * files for no behavioural gain.
     *
     * What actually made those stores unsafe to share the page with was not
     * where they live but two specific things, and both are fixed:
     *
     *  - `mainStore.activeWallet` now returns null unless Avalanche is the
     *    active platform, so none of those seventy readers can render this
     *    wallet onto another platform's tab. See the comment on it.
     *  - `logout()` tears the session down in place instead of reloading the
     *    page. The reload was what made this platform destructive to be near:
     *    it took every other platform's in-memory vault with it.
     *
     * See `resetSession` in @/stores/main for what teardown has to cover, and
     * tests/avalancheConcurrency.test.ts for the platform-layer half of this
     * contract — including what that file states it cannot yet reach.
     */
    supportsConcurrentSession: true,

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

    /**
     * `avalancheWallet`, NOT `activeWallet` — the one place that distinction is
     * load-bearing rather than defensive.
     *
     * `mainStore.activeWallet` is deliberately null whenever Avalanche is not
     * the active platform, which is what stops seventy Avalanche-specific call
     * sites from rendering onto another platform's tab. This function is the
     * exception that proves it: the platform layer calls it to ask "is
     * Avalanche connected?", and it asks precisely when some *other* platform
     * is active — that is how `connectedPlatforms` decides which tabs to draw.
     * Reading the gated accessor here would make the Avalanche tab disappear
     * the moment the user clicked away from it.
     */
    getActiveWallet(): PlatformWallet | null {
        const wallet = useMainStore().avalancheWallet
        return wallet ? new AvalancheWallet(wallet as Wallet) : null
    },

    /**
     * Bound to the C-Chain of whichever Avalanche network is selected, read
     * from the network store rather than tracked here — same single source of
     * truth as `getActiveNetwork` above.
     */
    getEvmSigner(): EvmSigner | null {
        // Gated: a signer is for acting as the wallet the user is currently on.
        const wallet = useMainStore().activeWallet
        if (!wallet) return null

        const selected = useNetworkStore().selectedNetwork
        const chainId = selected?.networkId === 1 ? 43114 : 43113
        return new AvalancheEvmSigner(
            (wallet as unknown) as AvaWalletCore,
            cChainNetworkFor(chainId)
        )
    },

    /**
     * Brings Avalanche's shared machinery up, and refreshes it on re-entry.
     *
     * Two callers, two reasons. At boot this runs for the restored platform,
     * where it does what App.vue used to do unconditionally. After boot it runs
     * whenever the user switches to the Avalanche tab — which is new: the
     * network store could not previously exist without Avalanche being the
     * platform for the whole life of the page.
     *
     * The refresh matters because Avalanche's pollers read
     * `mainStore.activeWallet`, which is null while another tab is active, so
     * they no-op there rather than keeping this session warm. That is the right
     * trade — no background RPC traffic for a chain the user is not looking at
     * — but it means the data is as old as the last visit, so it is refetched
     * on the way back in.
     */
    async activate(): Promise<void> {
        const networkStore = useNetworkStore()
        // Idempotent: the boot path may already have run it, and `init()`
        // itself is not safe to call twice. See stores/network.ts.
        await networkStore.ensureInitialized()

        const mainStore = useMainStore()
        if (!mainStore.avalancheWallet) return

        mainStore.updateAvaxPrice()
        useAssetsStore().updateUTXOs()
    },

    /**
     * Opens an Avalanche session from a recovery phrase, without navigating.
     *
     * The network has to be up first. On the single-platform path App.vue had
     * already booted it before the access screen rendered, but this can run
     * while a different platform is active — from the one-phrase unlock — and
     * then nothing has configured the SDK's endpoints yet. Deriving a wallet
     * against an unconfigured connection would produce an account that cannot
     * read a balance.
     */
    async unlockWithMnemonic(mnemonic: string, sessionPassword: string): Promise<void> {
        await useNetworkStore().ensureInitialized()
        await useMainStore().accessWallet(mnemonic, sessionPassword, { navigate: false })
    },

    /**
     * Core injects `window.avalanche`; MetaMask and the rest inject
     * `window.ethereum`, and the C-Chain is an ordinary EVM chain they can all
     * sign for — which is why this accepts either rather than insisting on
     * Core. `InjectedWallet.connect()` reads the same two handles.
     */
    isInjectedAvailable(): boolean {
        const w = window as any
        return (w.avalanche ?? w.ethereum) != null
    },

    /**
     * Opens an Avalanche session from the installed extension, without
     * navigating — see `connectWithInjected` in ../store.ts.
     *
     * The network has to be up first, for the same reason `unlockWithMnemonic`
     * above brings it up: this can run while a different platform is active, so
     * nothing may have configured the SDK's endpoints yet.
     */
    async connectInjected(): Promise<void> {
        await useNetworkStore().ensureInitialized()
        await useMainStore().accessWalletInjected({ navigate: false })
    },

    async logout(): Promise<void> {
        await useMainStore().logout()
    },
}

export default avalanchePlatform
