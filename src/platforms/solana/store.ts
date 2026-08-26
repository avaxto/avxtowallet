/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana platform session state: the selected cluster and the connected wallet.
 *
 * Separate from `@/stores/main` (Avalanche's) for the same reason the EVM
 * platform keeps its own — that store models X/P addresses, UTXO sets and HD
 * key state, none of which exist here. Switching platforms therefore can't
 * leave a half-populated wallet from another chain behind.
 *
 * The selected cluster lives here and only here. Which cluster is active
 * decides which RPC a transaction is broadcast to, so a second copy that could
 * disagree with this one would be a correctness bug rather than untidiness.
 */
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import Big from 'big.js'
import * as bip39 from 'bip39'

import router from '@/router'
import type { PlatformWallet } from '../types'
import { useActivePlatformStore } from '../store'
import { SessionVault } from '@/js/security/SessionVault'
import { AuthHandle, AuthScope } from '@/js/security/session'
import { wipe } from '@/js/security/memory'
import {
    getSolanaNetworkById,
    getSolanaNetworks,
    type SolanaNetwork,
} from '@/solana/networks'
import { readSolBalance } from '@/solana/tokens'
import { resetConnections } from '@/solana/rpc'
import { addressFromSeed, parseSolanaSecretKey, DEFAULT_SOLANA_PATH } from '@/solana/keys'
import { discoverAccounts, pickBestAccount } from '@/solana/discovery'
import {
    InjectedSolanaWallet,
    LocalSolanaWallet,
    SolanaWallet,
    WatchSolanaWallet,
    connectInjectedSolana,
} from './wallet'
import { requireSolanaProvider, type SolanaProvider } from './provider'

const NETWORK_STORAGE_KEY = 'solana_active_network'
const DEFAULT_NETWORK_ID = 'mainnet-beta'

/**
 * Module-scope mirrors of the active wallet and cluster.
 *
 * `Platform.getActiveWallet()` / `getActiveNetwork()` are synchronous and are
 * called from contexts that must not construct a Pinia store — platform
 * registration runs before Pinia is installed. Mirroring lets the platform
 * read them without touching the store, while the store stays the sole writer.
 */
let activeWalletRef: SolanaWallet | null = null
let activeNetworkRef: SolanaNetwork | null = null

export function peekActiveWallet(): PlatformWallet | null {
    return activeWalletRef
}

export function peekActiveNetwork(): SolanaNetwork | null {
    if (activeNetworkRef) return activeNetworkRef
    return resolveInitialNetwork()
}

function resolveInitialNetwork(): SolanaNetwork {
    let savedId: string | null = null
    try {
        savedId = localStorage.getItem(NETWORK_STORAGE_KEY)
    } catch {
        /* storage unavailable — fall through to the default */
    }
    return (
        (savedId ? getSolanaNetworkById(savedId) : undefined) ??
        getSolanaNetworkById(DEFAULT_NETWORK_ID) ??
        getSolanaNetworks()[0]
    )
}

/**
 * Builds a vault holding one secret, encrypted under the session password.
 *
 * Mirrors `MnemonicWallet.create` / `SingletonWallet.create`: derive the key,
 * store the secret inside a one-shot authorization, then dispose it. `markRaw`
 * keeps Vue's reactivity from proxying the vault — a proxied `CryptoKey` fails
 * WebCrypto's brand check.
 *
 * `vault.put` wipes the plaintext it is given, so callers must not reuse the
 * buffer afterwards.
 */
async function vaultWith(
    secretName: 'seed' | 'pk',
    plaintext: Uint8Array,
    password: string
): Promise<SessionVault> {
    const vault = markRaw(new SessionVault())
    let stored = false
    try {
        // deriveKey runs PBKDF2 and can reject (a hostile or unavailable
        // WebCrypto). It happens BEFORE vault.put, whose own finally is what
        // normally wipes the plaintext — so without the catch below a failure
        // here would leave the seed sitting in memory unwiped.
        const key = await vault.deriveKey(password)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
        try {
            await vault.put(auth, secretName, plaintext)
            stored = true
            return vault
        } finally {
            auth.dispose()
        }
    } finally {
        // vault.put already wiped it on the success path; wiping twice is
        // harmless, but skipping it when put never ran is not.
        if (!stored) wipe(plaintext)
    }
}

export const useSolanaStore = defineStore('solana', () => {
    // shallowRef, not ref: the wallet holds a SessionVault and (for injected
    // wallets) the extension's provider object. Deep reactivity would proxy
    // both, and a proxied CryptoKey fails WebCrypto's brand check.
    const wallet = shallowRef<SolanaWallet | null>(null)
    const network = shallowRef<SolanaNetwork>(resolveInitialNetwork())
    const isConnecting = ref(false)

    activeNetworkRef = network.value

    const isAuth = computed(() => wallet.value !== null)
    const networks = computed(() => getSolanaNetworks())

    // Synchronous native balance for the send form and balance card, which
    // can't await `getBalances()` during render.
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
            nativeBalance.value = await readSolBalance(w.getPrimaryAddress(), w.network)
        } catch (e) {
            console.warn('[solana/store] Could not refresh SOL balance:', e)
        } finally {
            isLoadingBalance.value = false
        }
    }

    const setWallet = (w: SolanaWallet | null): void => {
        wallet.value = w
        activeWalletRef = w
        // A plain variable, so nothing reading it through
        // `Platform.getActiveWallet()` would otherwise re-run — see
        // `walletEpoch` in platforms/store.ts.
        useActivePlatformStore().notifyWalletChanged()
        void refreshNativeBalance()
        if (w instanceof InjectedSolanaWallet) attachAccountListeners(w)
    }

    // Which provider the listeners below are attached to, so reconnecting on
    // the same provider doesn't stack duplicates and switching to a different
    // one tears the old down first. Plain closure variables — bookkeeping for a
    // browser API, not UI state.
    let listenerProvider: SolanaProvider | null = null
    let accountChangedListener: ((publicKey: unknown) => void) | null = null
    let disconnectListener: (() => void) | null = null

    /**
     * Keeps the session following the account selected in the extension.
     *
     * Without this, switching accounts in Phantom leaves the app displaying and
     * signing for the previous one indefinitely — silently wrong, with no
     * visible cue. Phantom emits `accountChanged` with the new public key, or
     * with null when the user disconnects the site from inside the extension.
     */
    const attachAccountListeners = (w: InjectedSolanaWallet): void => {
        const provider = w.native
        if (!provider || provider === listenerProvider) return

        if (listenerProvider) {
            if (accountChangedListener) {
                listenerProvider.removeListener?.('accountChanged', accountChangedListener)
            }
            if (disconnectListener) {
                listenerProvider.removeListener?.('disconnect', disconnectListener)
            }
        }

        accountChangedListener = (publicKey: unknown) => {
            const next = (publicKey as { toString(): string } | null)?.toString()
            if (!next) {
                // Disconnected from inside the extension.
                disconnect()
                return
            }
            const current = wallet.value
            if (!current || current.getPrimaryAddress() === next) return

            setWallet(
                new InjectedSolanaWallet({
                    address: next,
                    network: current.network,
                    provider,
                    providerName: (current as InjectedSolanaWallet).providerName,
                })
            )
        }

        disconnectListener = () => disconnect()

        provider.on?.('accountChanged', accountChangedListener)
        provider.on?.('disconnect', disconnectListener)
        listenerProvider = provider
    }

    const applyNetwork = (next: SolanaNetwork): void => {
        network.value = next
        activeNetworkRef = next
        try {
            localStorage.setItem(NETWORK_STORAGE_KEY, next.id)
        } catch {
            /* persistence is a convenience, not a requirement */
        }
    }

    // ---- Access methods ----

    const connectInjected = async (): Promise<void> => {
        isConnecting.value = true
        try {
            const detected = requireSolanaProvider()
            const w = await connectInjectedSolana(network.value, detected)
            setWallet(w)
            router.push('/wallet')
        } finally {
            isConnecting.value = false
        }
    }

    /**
     * Imports a BIP-39 recovery phrase.
     *
     * The phrase is validated, converted to a seed, then used to probe both
     * common Solana derivation-path conventions so the account that actually
     * holds funds is the one opened — see solana/discovery.ts for why guessing
     * one path is not acceptable here.
     *
     * `sessionPassword` encrypts the seed in memory and is never stored; it
     * must be re-entered to authorize each signature.
     */
    const accessWithMnemonic = async (
        mnemonic: string,
        sessionPassword: string
    ): Promise<void> => {
        const phrase = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase()
        if (!bip39.validateMnemonic(phrase)) {
            throw new Error(
                'That is not a valid BIP-39 recovery phrase. Check the word list and order.'
            )
        }

        // Uint8Array, not the Buffer bip39 returns, so `wipe` works on it.
        const seed = new Uint8Array(await bip39.mnemonicToSeed(phrase))

        let chosenPath = DEFAULT_SOLANA_PATH
        let address: string
        try {
            const accounts = await discoverAccounts(seed, network.value)
            const best = pickBestAccount(accounts)
            chosenPath = best.path
            address = best.address
        } catch (e) {
            // Discovery already swallows RPC failure; anything reaching here is
            // a derivation bug, and continuing would open the wrong account.
            wipe(seed)
            throw e
        }

        // vaultWith consumes and wipes `seed`.
        const vault = await vaultWith('seed', seed, sessionPassword)

        setWallet(
            new LocalSolanaWallet({
                address,
                network: network.value,
                vault,
                accessMethodId: 'mnemonic',
                derivationPath: chosenPath,
            })
        )
        router.push('/wallet')
    }

    /**
     * Imports a raw private key, in either format Solana wallets export
     * (base58, or a solana-keygen JSON byte array).
     */
    const accessWithPrivateKey = async (
        privateKey: string,
        sessionPassword: string
    ): Promise<void> => {
        // Throws with a specific message for each malformed shape.
        const seed = parseSolanaSecretKey(privateKey)
        const address = addressFromSeed(seed)

        // vaultWith consumes and wipes `seed`.
        const vault = await vaultWith('pk', seed, sessionPassword)

        setWallet(
            new LocalSolanaWallet({
                address,
                network: network.value,
                vault,
                accessMethodId: 'privatekey',
            })
        )
        router.push('/wallet')
    }

    /** Watch-only access from a pasted address. */
    const accessWatchOnly = async (address: string): Promise<void> => {
        setWallet(new WatchSolanaWallet({ address: address.trim(), network: network.value }))
        router.push('/wallet')
    }

    // ---- Session ----

    /**
     * Rebuilds the connected wallet bound to a different cluster.
     *
     * A NEW object rather than an in-place `wallet.network = next`, which is
     * the obvious shortcut and is wrong: the wallet lives in a `shallowRef`, so
     * mutating a property changes nothing Vue tracks. Anything watching
     * `platformStore.activeWallet` for identity (BalanceCard refetches its
     * balance that way) would keep showing the previous cluster's figures
     * indefinitely.
     *
     * Safe to rebuild because a Solana address is cluster-independent — the
     * same keypair is the same account on every cluster — so this re-points
     * where the wallet reads and writes without touching what it can sign for.
     * The vault carries over by reference; no secret is re-derived.
     */
    const rebindWallet = (current: SolanaWallet, next: SolanaNetwork): SolanaWallet => {
        if (current instanceof InjectedSolanaWallet) {
            return new InjectedSolanaWallet({
                address: current.getPrimaryAddress(),
                network: next,
                provider: current.native,
                providerName: current.providerName,
            })
        }
        if (current instanceof LocalSolanaWallet) {
            return new LocalSolanaWallet({
                address: current.getPrimaryAddress(),
                network: next,
                vault: current.vault,
                accessMethodId: current.accessMethodId,
                derivationPath: current.derivationPath,
            })
        }
        return new WatchSolanaWallet({ address: current.getPrimaryAddress(), network: next })
    }

    const setNetwork = async (id: string): Promise<void> => {
        const next = getSolanaNetworkById(id)
        if (!next) throw new Error(`Unknown Solana cluster: ${id}`)
        if (next.id === network.value.id) return

        applyNetwork(next)

        // Unlike EVM there is no extension-side chain to switch — a Solana
        // provider signs whatever transaction it is handed, and the cluster is
        // a property of the RPC this app talks to — so there is nothing that
        // can fail or be rejected here.
        const current = wallet.value
        if (current) {
            setWallet(rebindWallet(current, next))
        }
    }

    const disconnect = (): void => {
        const current = wallet.value

        if (listenerProvider) {
            if (accountChangedListener) {
                listenerProvider.removeListener?.('accountChanged', accountChangedListener)
            }
            if (disconnectListener) {
                listenerProvider.removeListener?.('disconnect', disconnectListener)
            }
            listenerProvider = null
            accountChangedListener = null
            disconnectListener = null
        }

        // Ask the extension to drop the session too, so reconnecting prompts
        // again rather than silently reusing the old approval.
        if (current instanceof InjectedSolanaWallet) {
            void current.native.disconnect?.().catch(() => {
                /* the extension may already be gone — nothing to do */
            })
        }

        // Discard the vault's ciphertext. The wallet becomes permanently
        // watch-only, which is fine because it is being dropped anyway.
        if (current instanceof LocalSolanaWallet) {
            current.vault.clear()
        }

        setWallet(null)
        nativeBalance.value = Big(0)
        resetConnections()

        // Matches every other platform's logout: hard-navigate home so the
        // router's auth guard takes over rather than leaving the user on
        // /wallet with nothing attached.
        window.location.href = '/'
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
        accessWithPrivateKey,
        accessWatchOnly,
        setNetwork,
        disconnect,
    }
})
