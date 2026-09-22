<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="insufficient_page">
        <div class="insufficient_body">
            <InsufficientBalanceNotice
                :thr-value="thrValue"
                :thr-symbol="thrSymbol"
                :thr-address="thrAddress"
                :c-chain-address="cChainAddress"
                @goToSwap="goToSwap"
            ></InsufficientBalanceNotice>
            <button class="restart_btn" @click="restart">Back to AVXTO Wallet Home</button>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, computed } from 'vue'
import router from '@/router'
import { useActivePlatformStore } from '@/platforms'
import InsufficientBalanceNotice from '@/components/misc/InsufficientBalanceNotice.vue'
import { useAssetsStore, useMainStore } from '@/stores'
import { AVXTO_CONTRACT_ADDRESS, AVXTO_SYMBOL, AVXTO_THR } from '@/avxto/AVXTOConf'

export default defineComponent({
    name: 'InsufficientBalance',
    components: { InsufficientBalanceNotice },
    setup() {
        // Read from the live session when there is one, and fall back to the
        // configured constants when there isn't. This page used to be handed
        // its values through sessionStorage by the balance check that
        // redirected here — that redirect is gone (the holding requirement is
        // now asked per action, see composables/useBaseAssetGate), and with it
        // the only writer of those keys. The page itself stays: it is still
        // reachable by route, and from the AVXTO menu's "Swap AVXTO" link
        // while logged out, where there is no session to read at all.
        const assetsStore = useAssetsStore()
        const mainStore = useMainStore()

        const thrValue = computed(() => {
            const thr = assetsStore.baseAsset?.thr ?? AVXTO_THR
            return thr.toString()
        })
        const thrSymbol = computed(() => assetsStore.baseAsset?.symbol ?? AVXTO_SYMBOL)
        const thrAddress = computed(
            () => assetsStore.baseAsset?.address ?? AVXTO_CONTRACT_ADDRESS
        )

        const provider = (window as any).avalanche ?? (window as any).ethereum

        // Snapshot the account that caused us to land here so we can
        // distinguish a real switch from the provider re-emitting the
        // current account on listener registration.
        let currentAccount: string | null = null

        // Whichever wallet is actually connected, or empty when none is — the
        // notice hides its deposit-address blocks rather than showing a
        // borrowed address. It must never be filled from `eth_accounts`: that
        // reads the *injected* wallet's account, which is a different wallet
        // whenever the connected one wasn't injected.
        const cChainAddress = computed(() => {
            const eth = mainStore.activeWallet?.ethAddress
            return eth ? '0x' + eth : ''
        })

        const onAccountsChanged = (accounts: string[]) => {
            const newAccount = accounts?.[0]?.toLowerCase() ?? null
            if (newAccount === currentAccount) return
            // A different (or no) account — restart from the beginning.
            window.location.href = '/'
        }

        onMounted(async () => {
            // Only to snapshot the extension's current account for the
            // accounts-changed watcher below — never to set cChainAddress.
            try {
                const accounts: string[] = await provider?.request({ method: 'eth_accounts' })
                currentAccount = accounts?.[0]?.toLowerCase() ?? null
            } catch {
                // Provider unavailable — leave currentAccount null so any
                // accountsChanged event will still trigger a redirect.
            }
            provider?.on?.('accountsChanged', onAccountsChanged)
        })

        onUnmounted(() => {
            provider?.removeListener?.('accountsChanged', onAccountsChanged)
        })

        const restart = () => {
            window.location.href = '/'
        }

        // The holding requirement is Avalanche's own C-Chain check, so
        // "Click here" must always open Avalanche's swap form specifically —
        // switch tabs first if a different one is active. Avalanche
        // `supportsConcurrentSession`, so when it is already connected this
        // hands over in place rather than logging anyone out.
        const goToSwap = async () => {
            const platformStore = useActivePlatformStore()
            await platformStore.setActivePlatform('avalanche')
            router.push('/wallet/swap')
        }

        return {
            restart,
            goToSwap,
            thrValue,
            thrSymbol,
            thrAddress,
            cChainAddress,
        }
    },
})
</script>

<style scoped lang="scss">
.insufficient_page {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-light, #1a1a2e);
}

.insufficient_body {
    background-color: var(--bg-light, #1a1a2e);
    border-radius: 8px;
    padding: 40px 48px;
    max-width: 520px;
    width: 90%;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.restart_btn {
    margin-top: 24px;
    padding: 10px 28px;
    border: none;
    border-radius: 4px;
    background-color: var(--secondary-color, #e84142);
    color: #fff;
    font-size: 14px;
    cursor: pointer;

    &:hover {
        opacity: 0.85;
    }
}
</style>
