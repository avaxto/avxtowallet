<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  X-Chain explorer: look up an X-Chain address or transaction ID through
  Glacier and show everything it returns (src/explorer/xchain.ts). The query
  lives in the URL (?q=…&net=…), so links inside the results, the browser's
  Back button and shared links all work. Read-only: nothing here signs.
-->
<template>
    <div class="xexplorer">
        <div class="head">
            <h1>X-Chain Explorer</h1>
            <p class="desc">Look up an X-Chain address or transaction ID. Data from Avalanche's Glacier API.</p>
        </div>

        <form class="search" autocomplete="off" @submit.prevent="submit">
            <input
                v-model="input"
                class="field mono"
                spellcheck="false"
                autocapitalize="none"
                autocorrect="off"
                placeholder="X-avax1… address or transaction ID"
                aria-label="X-Chain address or transaction ID"
            />
            <button type="submit" class="button_primary search_btn" :disabled="!input.trim()">Search</button>
        </form>
        <div class="options">
            <span class="small">Network for transaction IDs:</span>
            <label><input v-model="network" type="radio" value="mainnet" /> Mainnet</label>
            <label><input v-model="network" type="radio" value="fuji" /> Fuji</label>
            <button v-if="myAddress" type="button" class="link small" @click="open(`X-${myAddress}`)">My X address</button>
        </div>

        <p v-if="error" class="err">{{ error }}</p>
        <p v-if="loading" class="small center">Looking it up…</p>

        <XTxView v-if="result && result.kind === 'tx'" :tx="result.tx" :network="result.network" :address="fromAddress" @open="open" />
        <XAddressView v-else-if="result && result.kind === 'address'" :address="result.address" :network="result.network" @open="open" />
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import XTxView from '@/components/explorer/XTxView.vue'
import XAddressView from '@/components/explorer/XAddressView.vue'
import { classifyQuery, findTransaction, type XNetwork, type XTransaction } from '@/explorer/xchain'
import { useMainStore } from '@/stores'

type Result = { kind: 'tx'; tx: XTransaction; network: XNetwork } | { kind: 'address'; address: string; network: XNetwork }

export default defineComponent({
    name: 'XExplorer',
    components: { XTxView, XAddressView },
    setup() {
        const route = useRoute()
        const router = useRouter()
        const mainStore = useMainStore()

        const input = ref('')
        const network = ref<XNetwork>(route.query.net === 'fuji' ? 'fuji' : 'mainnet')
        const result = ref<Result | null>(null)
        const error = ref('')
        const loading = ref(false)
        /** The address a transaction was opened from, to show its effect on it. */
        const fromAddress = ref('')

        // The gated wallet: only offer "my address" while Avalanche is the active platform.
        const myAddress = computed(() => {
            try {
                const a = (mainStore.activeWallet as any)?.getCurrentAddressAvm?.()
                return typeof a === 'string' ? a.replace(/^X-/, '') : ''
            } catch {
                return ''
            }
        })

        let generation = 0
        const run = async (q: string) => {
            const gen = ++generation
            error.value = ''
            const query = classifyQuery(q)
            if (query.kind === 'invalid') {
                result.value = null
                error.value = query.reason
                return
            }
            if (query.kind === 'address') {
                network.value = query.network
                result.value = { kind: 'address', address: query.address, network: query.network }
                return
            }
            loading.value = true
            try {
                const found = await findTransaction(query.txHash, network.value)
                if (gen !== generation) return
                network.value = found.network
                result.value = { kind: 'tx', tx: found.tx, network: found.network }
            } catch (e: any) {
                if (gen !== generation) return
                result.value = null
                error.value = e?.message || 'Lookup failed.'
            } finally {
                if (gen === generation) loading.value = false
            }
        }

        /** Navigates, so the search is in the URL and Back returns to the previous result. */
        const open = (q: string) => {
            const current = result.value
            const from = current?.kind === 'address' ? current.address : ''
            router.push({ query: { q, net: network.value, ...(from && classifyQuery(q).kind === 'tx' ? { from } : {}) } })
        }
        const submit = () => {
            if (input.value.trim()) router.push({ query: { q: input.value.trim(), net: network.value } })
        }

        watch(
            () => [route.query.q, route.query.net, route.query.from],
            () => {
                const q = typeof route.query.q === 'string' ? route.query.q : ''
                if (route.query.net === 'fuji' || route.query.net === 'mainnet') network.value = route.query.net
                fromAddress.value = typeof route.query.from === 'string' ? route.query.from : ''
                input.value = q
                if (q) run(q)
                else {
                    result.value = null
                    error.value = ''
                }
            },
            { immediate: true }
        )

        return { input, network, result, error, loading, fromAddress, myAddress, open, submit }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.xexplorer {
    max-width: 960px;
    margin: 0 auto;
    color: var(--primary-color);
}

.head {
    text-align: center;
    margin-bottom: 18px;

    h1 {
        font-weight: normal;
    }
}

.desc,
.small {
    font-size: 13px;
    color: var(--primary-color-light);
}

.mono {
    font-family: monospace;
}

.search {
    display: flex;
    gap: 8px;
}

.field {
    flex: 1;
    min-width: 0;
    padding: 11px 14px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: var(--bg-light);
    color: var(--primary-color);
    font-size: 14px;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.search_btn {
    padding: 0 18px;
    border-radius: 8px;
}

.options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    margin: 10px 0 16px;
    font-size: 13px;

    label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
    }
}

.link {
    color: var(--secondary-color);
    margin-left: auto;

    &:hover {
        text-decoration: underline;
    }
}

.err {
    color: var(--error);
    font-size: 14px;
    margin-bottom: 12px;
}

.center {
    text-align: center;
}
</style>
