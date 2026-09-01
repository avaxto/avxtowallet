<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="insufficient_page">
        <div class="insufficient_body">
            <p class="insufficient_message">
                The
                <a
                    href="https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {{ thrSymbol }}
                </a>
                balance on this account is below the required minimum threshold to use AVXTO Wallet
                <template v-if="thrValue">
                    <br />
                    <br />
                    Minimum required:
                    <strong>{{ thrValueFormatted }} {{ thrSymbol }}</strong>
                </template>
                <br />
                Please deposit
                <strong>{{ thrSymbol }}</strong>
                tokens to continue.
                <template v-if="cChainAddress">
                    <br />
                    <br />
                    <div class="alert alert-warning" role="alert">
                        <a href="#" @click.prevent="goToSwap"><b>Click here</b></a>
                        to make a deposit to your Avalanche C-Chain deposit address to continue:
                        <br />
                        <code>{{ cChainAddress }}</code>
                    </div>
                </template>

                You can also swap
                <strong>{{ thrSymbol }}</strong>
                at
                <a
                    href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    LFJ
                </a>
                or
                <a
                    href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    ArenaTrade
                </a>
                .
                <br />
                (
                <em>
                    Or any other DEX with
                    <strong>{{ thrSymbol }}</strong>
                    support.
                </em>
                )
                <template v-if="cChainAddress">
                    <br />
                    <br />
                    <div class="alert alert-warning" role="alert">
                        Double check your C-Chain deposit address:
                        <br />
                        <code>{{ cChainAddress }}</code>
                    </div>
                </template>

                Always verify the
                <strong>{{ thrSymbol }}</strong>
                CA - Contract Address before making a purchase :
                <code>{{ thrAddress || '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D' }}</code>
                (Do NOT deposit to the contract address.)
            </p>
            <button class="restart_btn" @click="restart">Back to AVXTO Wallet Home</button>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref, computed } from 'vue'
import router from '@/router'
import { useActivePlatformStore } from '@/platforms'

export default defineComponent({
    name: 'InsufficientBalance',
    setup() {
        const thrValue = ref(sessionStorage.getItem('insufficientBalance_thr') ?? '')
        const thrSymbol = ref(sessionStorage.getItem('insufficientBalance_symbol') ?? 'AVXTO')
        const thrAddress = ref(sessionStorage.getItem('insufficientBalance_address') ?? '')
        const storedCChainAddress =
            sessionStorage.getItem('insufficientBalance_cChainAddress') ?? ''
        sessionStorage.removeItem('insufficientBalance_thr')
        sessionStorage.removeItem('insufficientBalance_symbol')
        sessionStorage.removeItem('insufficientBalance_address')
        sessionStorage.removeItem('insufficientBalance_cChainAddress')
        const provider = (window as any).avalanche ?? (window as any).ethereum

        // Snapshot the account that caused us to land here so we can
        // distinguish a real switch from the provider re-emitting the
        // current account on listener registration.
        let currentAccount: string | null = null

        // The address to show is whichever wallet's balance was actually
        // checked — Erc20Token.updateBalance() stores it before redirecting
        // here, and it can be a mnemonic/Ledger/singleton wallet with no
        // relationship at all to whatever the browser extension currently has
        // connected. It must never be replaced by `eth_accounts`: that reads
        // the *injected* wallet's account, which is a different wallet
        // whenever the flagged one wasn't injected — the bug this fixes was
        // exactly that override winning unconditionally, so every mnemonic
        // entered here displayed the extension's address instead of its own.
        const cChainAddress = ref<string | null>(storedCChainAddress || null)

        // Erc20Token.ts stores `baseAsset.thr` as a plain digit string
        // (BN#toString, e.g. "1000000") — comma-group it the same way
        // balances elsewhere use Big#toLocaleString (utils/big-extensions.ts).
        const thrValueFormatted = computed(() => {
            const n = Number(thrValue.value)
            return Number.isFinite(n) ? n.toLocaleString('en-US') : thrValue.value
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

        // The AVXTO balance check that lands the user here (Erc20Token.ts)
        // is Avalanche's own C-Chain check — it runs in the background no
        // matter which tab is currently in front (Bitcoin, Solana, another
        // EVM chain...), since Avalanche can stay connected behind another
        // active platform now. "Click here" must always open Avalanche's
        // swap form specifically, so switch tabs first if a different one is
        // active — Avalanche `supportsConcurrentSession`, and it's already
        // connected (that's the only way this check could have fired), so
        // this hands over in place rather than logging anyone out.
        const goToSwap = async () => {
            const platformStore = useActivePlatformStore()
            await platformStore.setActivePlatform('avalanche')
            router.push('/wallet/swap')
        }

        return {
            restart,
            goToSwap,
            thrValue,
            thrValueFormatted,
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

.insufficient_message {
    text-align: center;
    color: var(--primary-color, #e0e0e0);
    font-size: 15px;
    line-height: 1.7;
    margin: 0;

    a {
        color: var(--secondary-color, #e84142);
        text-decoration: underline;
    }
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
