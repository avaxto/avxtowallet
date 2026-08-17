/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Robinhood Chain session state.
 *
 * Separate from `@/stores/main` on purpose: that store is Avalanche's (it holds
 * X/P addresses, UTXO sets, HD key state and Avalanche access flows). Keeping
 * this platform's session here means switching platforms never leaves a
 * half-populated Avalanche wallet behind, and neither store has to learn about
 * the other.
 */
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import router from '@/router'
import type { PlatformWallet } from '../types'
import { useActivePlatformStore } from '../store'
import { getRobinhoodNetwork, ROBINHOOD_NETWORKS } from './config'
import { connectInjected as connectInjectedWallet, RobinhoodWallet } from './wallet'

/**
 * Module-scope mirror of the active wallet.
 *
 * `Platform.getActiveWallet()` is synchronous and is called from contexts that
 * must not construct a Pinia store (platform registration runs before Pinia is
 * installed). Mirroring the value here lets the platform read it without
 * touching the store, while the store stays the single writer.
 */
let activeWalletRef: RobinhoodWallet | null = null

export function peekActiveWallet(): PlatformWallet | null {
    return activeWalletRef
}

export const useRobinhoodStore = defineStore('robinhood', () => {
    const wallet = shallowRef<RobinhoodWallet | null>(null)
    const networkId = ref<string>(ROBINHOOD_NETWORKS[0].id)
    const isConnecting = ref(false)

    const isAuth = computed(() => wallet.value !== null)
    const network = computed(
        () => getRobinhoodNetwork(networkId.value) ?? ROBINHOOD_NETWORKS[0]
    )

    const setWallet = (w: RobinhoodWallet | null) => {
        wallet.value = w
        activeWalletRef = w
        // activeWalletRef is a plain variable, not a Vue ref, so nothing reading
        // it through `Platform.getActiveWallet()` (e.g. AddressCard.vue's
        // `activeWallet` computed) would otherwise know to re-run when it
        // changes — see the comment on `walletEpoch` in platforms/store.ts.
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

    const setNetwork = (id: string): void => {
        if (!getRobinhoodNetwork(id)) throw new Error(`Unknown Robinhood network: ${id}`)
        networkId.value = id
        // The connected wallet is bound to the previous network's RPC/chain id,
        // so it must not survive a network change.
        setWallet(null)
    }

    const disconnect = (): void => {
        setWallet(null)
        // Avalanche's mainStore.logout() hard-navigates home after clearing its
        // session (see stores/main.ts) so the router's auth guard immediately
        // takes over rather than leaving the user stranded on /wallet with no
        // active wallet. Match that here — nothing re-routes automatically just
        // because `platformStore.activeWallet` went null while already on the
        // page.
        window.location.href = '/'
    }

    return {
        wallet,
        networkId,
        network,
        isConnecting,
        isAuth,
        connectInjected,
        setNetwork,
        disconnect,
    }
})
