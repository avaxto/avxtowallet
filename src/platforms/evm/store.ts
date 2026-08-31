/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * EVM platform session state: which network is selected, and the connected
 * wallet.
 *
 * Separate from `@/stores/main` on purpose — that store is Avalanche's (X/P
 * addresses, UTXO sets, HD key state). Keeping this platform's session here
 * means switching platforms never leaves a half-populated Avalanche wallet
 * behind, and neither store has to know about the other.
 *
 * The selected network lives here and ONLY here. The previous per-chain
 * platform kept one copy in a module variable and another in a store ref,
 * which could disagree; chain id decides which RPC a transaction is signed
 * for, so two sources of truth for it is a correctness bug, not just untidy.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import Big from 'big.js'
import * as bip39 from 'bip39'

import router from '@/router'
import type { AccessOptions, PlatformWallet } from '../types'
import { useActivePlatformStore } from '../store'
import { vaultWith } from '../vault'
import {
    getEvmNetworkById,
    getEvmNetworks,
    loadCustomEvmNetworks,
    type EvmNetwork,
} from '@/evm/networkRegistry'
import { DEFAULT_EVM_PATH, deriveEvmAddress } from '@/evm/keys'
import { readNativeBalance } from '@/evm/tokenReader'
import { wipe } from '@/js/security/memory'
import {
    connectInjected as connectInjectedWallet,
    EvmWallet,
    InjectedEvmWallet,
    LocalEvmWallet,
    type Eip1193Provider,
} from './wallet'

const NETWORK_STORAGE_KEY = 'evm_active_network'
/**
 * Ethereum, not Avalanche C-Chain: this platform exists precisely because the
 * user has a *separate* Avalanche platform, so defaulting it to Avalanche is
 * both surprising and redundant. It is only a starting point anyway —
 * connecting adopts whichever chain the extension is already on.
 */
const DEFAULT_NETWORK_ID = 'ethereum'

/**
 * Module-scope mirrors of the active wallet and network.
 *
 * `Platform.getActiveWallet()` / `getActiveNetwork()` are synchronous and get
 * called from contexts that must not construct a Pinia store (platform
 * registration runs before Pinia is installed). Mirroring lets the platform
 * read them without touching the store, while the store stays the single
 * writer.
 */
let activeWalletRef: EvmWallet | null = null
let activeNetworkRef: EvmNetwork | null = null

export function peekActiveWallet(): PlatformWallet | null {
    return activeWalletRef
}

export function peekActiveNetwork(): EvmNetwork | null {
    if (activeNetworkRef) return activeNetworkRef
    // Before the store is ever constructed (e.g. the status bar rendering on
    // first paint), fall back to the persisted or default choice so callers
    // get a usable network rather than null.
    return resolveInitialNetwork()
}

function resolveInitialNetwork(): EvmNetwork {
    loadCustomEvmNetworks()
    let savedId: string | null = null
    try {
        savedId = localStorage.getItem(NETWORK_STORAGE_KEY)
    } catch {
        /* storage unavailable — fall through to the default */
    }
    return (
        (savedId ? getEvmNetworkById(savedId) : undefined) ??
        getEvmNetworkById(DEFAULT_NETWORK_ID) ??
        getEvmNetworks()[0]
    )
}

export const useEvmStore = defineStore('evm', () => {
    // shallowRef, not ref: a local wallet holds a SessionVault and an injected
    // one holds the extension's provider object. Deep reactivity would proxy
    // both, and a proxied CryptoKey fails WebCrypto's brand check.
    const wallet = shallowRef<EvmWallet | null>(null)
    const network = shallowRef<EvmNetwork>(resolveInitialNetwork())
    const isConnecting = ref(false)

    activeNetworkRef = network.value

    const isAuth = computed(() => wallet.value !== null)
    const networks = computed(() => getEvmNetworks())

    // Native balance for the connected wallet. Unlike Avalanche's `Wallet`
    // (whose `ethBalance` is a reactive field the wallet class itself keeps
    // current), `EvmWallet` only exposes an async `getBalances()` — this ref is
    // what the send form and anything else needing a synchronous number reads
    // instead.
    const nativeBalance = shallowRef<Big>(Big(0))
    const isLoadingBalance = ref(false)

    const refreshNativeBalance = async (): Promise<void> => {
        const w = wallet.value
        if (!w) {
            nativeBalance.value = Big(0)
            return
        }
        isLoadingBalance.value = true
        try {
            nativeBalance.value = await readNativeBalance(w.getPrimaryAddress(), w.network)
        } catch (e) {
            console.warn('[evm/store] Could not refresh native balance:', e)
        } finally {
            isLoadingBalance.value = false
        }
    }

    const setWallet = (w: EvmWallet | null) => {
        wallet.value = w
        activeWalletRef = w
        // activeWalletRef is a plain variable, not a Vue ref, so nothing
        // reading it through `Platform.getActiveWallet()` would otherwise know
        // to re-run when it changes — see `walletEpoch` in platforms/store.ts.
        useActivePlatformStore().notifyWalletChanged()
        void refreshNativeBalance()
        // Only an extension has an account that can change out from under us; a
        // local wallet's address is fixed by its derivation path.
        if (w instanceof InjectedEvmWallet) attachAccountsChangedListener(w)
    }

    // Which provider object the listener below is currently attached to, so
    // reconnecting on the SAME provider (the common case — `window.ethereum`
    // is one object for the page's lifetime) doesn't register a second
    // listener, and switching to a genuinely different provider tears the old
    // one down first. A plain closure variable, not a Vue ref: this is
    // bookkeeping for the browser API, not UI state.
    let listenerProvider: Eip1193Provider | null = null
    let accountsChangedListener: ((accounts: string[]) => void) | null = null

    /**
     * Keeps the connected wallet following whichever account is active in the
     * extension. Without this, switching accounts in MetaMask while the EVM
     * platform is active did nothing at all — the app kept signing/displaying
     * the OLD account indefinitely, silently wrong, until a manual
     * disconnect/reconnect or a full page reload. Avalanche's own
     * `mainStore.accessWalletInjected()` has had the equivalent listener since
     * before this platform existed; this was the one place it was missing.
     */
    const attachAccountsChangedListener = (w: InjectedEvmWallet): void => {
        const provider = w.native
        if (!provider || provider === listenerProvider) return

        if (listenerProvider && accountsChangedListener) {
            listenerProvider.removeListener?.('accountsChanged', accountsChangedListener)
        }

        accountsChangedListener = (accounts: string[]) => {
            if (!accounts || accounts.length === 0) {
                // Extension disconnected/locked — log out cleanly, same as
                // Avalanche's own listener does for the identical event.
                disconnect()
                return
            }
            const newAddress = accounts[0]
            const current = wallet.value
            if (!current) return
            if (current.getPrimaryAddress().toLowerCase() === newAddress.toLowerCase()) return

            // Same network and provider — only the account changed, so there
            // is no need to re-run ensureChain() or re-request permissions,
            // just rebuild the wallet object around the new address.
            setWallet(
                new InjectedEvmWallet({
                    address: newAddress,
                    network: current.network,
                    provider: current.native,
                    accessMethodId: current.accessMethodId,
                })
            )
        }

        provider.on?.('accountsChanged', accountsChangedListener)
        listenerProvider = provider
    }

    const applyNetwork = (next: EvmNetwork): void => {
        network.value = next
        activeNetworkRef = next
        try {
            localStorage.setItem(NETWORK_STORAGE_KEY, next.id)
        } catch {
            /* persistence is a convenience, not a requirement */
        }
    }

    const connectInjected = async (): Promise<void> => {
        isConnecting.value = true
        try {
            const w = await connectInjectedWallet(network.value)
            // The wallet may have adopted the chain the extension was already
            // on instead of the selected one (see connectInjected in
            // ./wallet.ts). Follow it, or the app would display and sign for a
            // different network than the wallet is actually on.
            if (w.network.evmChainId !== network.value.evmChainId) {
                applyNetwork(w.network)
            }
            setWallet(w)
            router.push('/wallet')
        } finally {
            isConnecting.value = false
        }
    }

    /**
     * Imports a BIP-39 recovery phrase.
     *
     * The phrase is validated, converted to a seed, and the account at the
     * standard EVM path derived from it — see evm/keys.ts for why that path is
     * fixed rather than probed the way Solana's is.
     *
     * `sessionPassword` encrypts the seed in memory and is never stored; it
     * must be re-entered to authorize each signature.
     *
     * Nothing about this is network-specific: an EVM key is the same account on
     * every chain, so this opens the wallet on whichever network is currently
     * selected and the picker moves it freely afterwards (see `setNetwork`).
     */
    const accessWithMnemonic = async (
        mnemonic: string,
        sessionPassword: string,
        options: AccessOptions = {}
    ): Promise<void> => {
        const phrase = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase()
        if (!bip39.validateMnemonic(phrase)) {
            throw new Error(
                'That is not a valid BIP-39 recovery phrase. Check the word list and order.'
            )
        }

        // Uint8Array, not the Buffer bip39 returns, so `wipe` works on it.
        const seed = new Uint8Array(await bip39.mnemonicToSeed(phrase))

        let address: string
        try {
            address = deriveEvmAddress(seed, DEFAULT_EVM_PATH)
        } catch (e) {
            wipe(seed)
            throw e
        }

        // vaultWith consumes and wipes `seed`.
        const vault = await vaultWith('seed', seed, sessionPassword)

        setWallet(
            new LocalEvmWallet({
                address,
                network: network.value,
                vault,
                derivationPath: DEFAULT_EVM_PATH,
            })
        )
        if (options.navigate !== false) router.push('/wallet')
    }

    /**
     * Rebuilds a locally-signing wallet bound to a different network.
     *
     * A NEW object rather than an in-place `wallet.network = next`, which is
     * the obvious shortcut and is wrong: the wallet lives in a `shallowRef`, so
     * mutating a property changes nothing Vue tracks, and anything watching
     * `platformStore.activeWallet` for identity would keep showing the previous
     * chain's figures.
     *
     * Safe to rebuild because an EVM address is chain-independent — the same
     * key is the same account on every chain — so this re-points where the
     * wallet reads and broadcasts without touching what it can sign for. The
     * vault carries over by reference; no secret is re-derived.
     */
    const rebindLocalWallet = (current: LocalEvmWallet, next: EvmNetwork): LocalEvmWallet =>
        new LocalEvmWallet({
            address: current.getPrimaryAddress(),
            network: next,
            vault: current.vault,
            derivationPath: current.derivationPath,
        })

    const setNetwork = async (id: string): Promise<void> => {
        const next = getEvmNetworkById(id)
        if (!next) throw new Error(`Unknown EVM network: ${id}`)
        if (next.evmChainId === network.value.evmChainId) return

        // A locally-signing wallet has no extension to move: the chain id it
        // signs for comes from the network it is bound to, so switching is just
        // rebinding it. Running the injected path here would prompt for an
        // extension the user may not even have, and fail if they do not.
        const current = wallet.value
        if (current instanceof LocalEvmWallet) {
            applyNetwork(next)
            setWallet(rebindLocalWallet(current, next))
            return
        }

        // An explicit pick from the network menu, so this one DOES move the
        // extension — unlike connect, where the extension's own chain wins.
        if (current) {
            isConnecting.value = true
            try {
                const w = await connectInjectedWallet(next, { force: true })
                applyNetwork(w.network)
                setWallet(w)
            } finally {
                isConnecting.value = false
            }
            return
        }

        applyNetwork(next)
    }

    const disconnect = (): void => {
        // Discard the vault's ciphertext. The wallet becomes permanently
        // watch-only, which is fine because it is being dropped anyway.
        const current = wallet.value
        if (current instanceof LocalEvmWallet) {
            current.vault.clear()
        }

        setWallet(null)
        // Hands off to the platform store rather than hard-navigating here: a
        // reload would end every OTHER live platform session too (their vaults
        // are in memory only). It falls back to the same full reset when this
        // was the last session. See `finishDisconnect` in ../store.ts.
        void useActivePlatformStore().finishDisconnect()
    }

    return {
        wallet,
        network,
        networks,
        isConnecting,
        isAuth,
        nativeBalance,
        isLoadingBalance,
        refreshNativeBalance,
        connectInjected,
        accessWithMnemonic,
        setNetwork,
        disconnect,
    }
})
