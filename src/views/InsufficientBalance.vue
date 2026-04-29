<template>
    <div class="insufficient_page">
        <div class="insufficient_body">
            <p class="insufficient_message">
                The <a href="https://dexscreener.com/avalanche/0x2bdebde7e1088e42aafef104b5f7457aca5ab86f" target="_blank" rel="noopener noreferrer">{{ thrSymbol }}</a> balance on this account is below the required minimum threshold to use this wallet.
                <template v-if="thrValue">
                    <br /><br />
                    Minimum required: <strong>{{ thrValue }} {{ thrSymbol }}</strong>
                </template>
                <br /><br />
                Please acquire more <strong>{{ thrSymbol }}</strong> tokens to continue.
                <br /><br />
                You can swap <strong>{{ thrSymbol }}</strong> at <a href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" target="_blank" rel="noopener noreferrer">LFJ</a>
                or <a href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" target="_blank" rel="noopener noreferrer">ArenaTrade</a>. (<em>Or any other DEX with <strong>{{ thrSymbol }}</strong> support.</em>.)
                <br /><br />    
                Always check the contract address before making a purchase : <code>{{ thrAddress || '0xf56CeCc07d97Ac50630022CF84C19e612ae8C93D' }}</code>

            </p>
            <button class="restart_btn" @click="restart">Back to AVXTO Wallet Home</button>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, onMounted, onUnmounted, ref } from 'vue'

export default defineComponent({
    name: 'InsufficientBalance',
    setup() {
        const thrValue = ref(sessionStorage.getItem('insufficientBalance_thr') ?? '')
        const thrSymbol = ref(sessionStorage.getItem('insufficientBalance_symbol') ?? 'AVXTO')
        const thrAddress = ref(sessionStorage.getItem('insufficientBalance_address') ?? '')
        sessionStorage.removeItem('insufficientBalance_thr')
        sessionStorage.removeItem('insufficientBalance_symbol')
        sessionStorage.removeItem('insufficientBalance_address')
        const provider = (window as any).avalanche ?? (window as any).ethereum

        // Snapshot the account that caused us to land here so we can
        // distinguish a real switch from the provider re-emitting the
        // current account on listener registration.
        let currentAccount: string | null = null

        const onAccountsChanged = (accounts: string[]) => {
            const newAccount = accounts?.[0]?.toLowerCase() ?? null
            if (newAccount === currentAccount) return
            // A different (or no) account — restart from the beginning.
            window.location.href = '/'
        }

        onMounted(async () => {
            // Capture the active account before attaching the listener.
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

        return { restart, thrValue, thrSymbol, thrAddress }
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
