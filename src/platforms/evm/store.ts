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

import router from '@/router'
import type { PlatformWallet } from '../types'
import { useActivePlatformStore } from '../store'
import {
    getEvmNetworkById,
    getEvmNetworks,
    loadCustomEvmNetworks,
    type EvmNetwork,
} from '@/evm/networkRegistry'
import { connectInjected as connectInjectedWallet, EvmWallet } from './wallet'

const NETWORK_STORAGE_KEY = 'evm_active_network'
const DEFAULT_NETWORK_ID = 'avalanche-c'

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
    const wallet = shallowRef<EvmWallet | null>(null)
    const network = shallowRef<EvmNetwork>(resolveInitialNetwork())
    const isConnecting = ref(false)

    activeNetworkRef = network.value

    const isAuth = computed(() => wallet.value !== null)
    const networks = computed(() => getEvmNetworks())

    const setWallet = (w: EvmWallet | null) => {
        wallet.value = w
        activeWalletRef = w
        // activeWalletRef is a plain variable, not a Vue ref, so nothing
        // reading it through `Platform.getActiveWallet()` would otherwise know
        // to re-run when it changes — see `walletEpoch` in platforms/store.ts.
        useActivePlatformStore().notifyWalletChanged()
    }

    const connectInjected = async (): Promise<void> => {
        isConnecting.value = true
        try {
            const w = await connectInjectedWallet(network.value)
            setWallet(w)
            router.push('/wallet')
        } finally {
            isConnecting.value = false
        }
    }

    const setNetwork = async (id: string): Promise<void> => {
        const next = getEvmNetworkById(id)
        if (!next) throw new Error(`Unknown EVM network: ${id}`)
        if (next.evmChainId === network.value.evmChainId) return

        network.value = next
        activeNetworkRef = next
        try {
            localStorage.setItem(NETWORK_STORAGE_KEY, next.id)
        } catch {
            /* persistence is a convenience, not a requirement */
        }

        // The connected wallet is bound to the previous network's chain id, so
        // it must not survive the switch. Reconnect on the new chain when a
        // wallet was attached, so the user isn't silently logged out by what
        // reads as a network change.
        if (wallet.value) {
            setWallet(null)
            await connectInjected()
        }
    }

    const disconnect = (): void => {
        setWallet(null)
        // Matches Avalanche's logout: hard-navigate home so the router's auth
        // guard takes over, rather than leaving the user on /wallet with no
        // wallet attached.
        window.location.href = '/'
    }

    return {
        wallet,
        network,
        networks,
        isConnecting,
        isAuth,
        connectInjected,
        setNetwork,
        disconnect,
    }
})
