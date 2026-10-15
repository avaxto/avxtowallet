<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Everything Glacier knows about one X-Chain address: the chains it has used,
  its balances (unlocked, locked, and waiting in atomic memory for an
  import), the assets it holds, its full transaction history with what each
  transaction did to it, and its UTXOs — unspent, or every one it ever had.
-->
<template>
    <div class="addr_view">
        <div class="xcard">
            <h3>Address</h3>
            <dl class="fields">
                <dt>Address</dt>
                <dd class="mono">X-{{ address }} <CopyText :value="`X-${address}`" class="copy" /></dd>
                <dt>Network</dt>
                <dd>{{ network === 'mainnet' ? 'Mainnet' : 'Fuji testnet' }}</dd>
                <dt>Chains used</dt>
                <dd>
                    <span v-if="chainsError" class="err">{{ chainsError }}</span>
                    <span v-else-if="chains === null" class="small">Loading…</span>
                    <template v-else-if="chains.length">
                        <div v-for="c in chains" :key="c">{{ chainName(c) }} <span class="mono small">{{ c }}</span></div>
                    </template>
                    <span v-else class="muted">none yet — this address has no on-chain activity</span>
                </dd>
            </dl>
        </div>

        <div class="xcard">
            <h3>Balances</h3>
            <p v-if="balancesError" class="err">{{ balancesError }}</p>
            <p v-else-if="!balances" class="small">Loading…</p>
            <div v-else class="table_wrap">
                <table class="list">
                    <thead>
                        <tr>
                            <th>Kind</th>
                            <th>Asset</th>
                            <th class="num">Amount</th>
                            <th class="num">UTXOs</th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="kind in BALANCE_KINDS" :key="kind.key">
                            <tr v-for="b in balances[kind.key] || []" :key="kind.key + b.assetId">
                                <td>
                                    {{ kind.label }}
                                    <div class="small">{{ kind.hint }}</div>
                                </td>
                                <td>
                                    {{ b.name }} ({{ b.symbol }})
                                    <div class="mono small">{{ b.assetId }}</div>
                                </td>
                                <td class="num">{{ formatAmount(b.amount, b.denomination) }}</td>
                                <td class="num">{{ b.utxoCount }}</td>
                            </tr>
                        </template>
                        <tr v-if="!balanceRows">
                            <td colspan="4" class="muted">No balance.</td>
                        </tr>
                    </tbody>
                </table>
                <details class="raw">
                    <summary>Raw balances JSON</summary>
                    <pre>{{ JSON.stringify(balances, null, 2) }}</pre>
                </details>
            </div>
        </div>

        <div v-if="heldAssetIds.length" class="xcard">
            <h3>Assets held <span class="count">{{ heldAssetIds.length }}</span></h3>
            <div v-for="id in heldAssetIds" :key="id" class="asset">
                <dl v-if="assets[id]" class="fields">
                    <dt>Name</dt>
                    <dd>{{ assets[id].name }} ({{ assets[id].symbol }})</dd>
                    <dt>Asset ID</dt>
                    <dd class="mono">{{ id }}</dd>
                    <dt>Type</dt>
                    <dd>{{ assets[id].type }} · {{ assets[id].denomination }} decimals</dd>
                    <template v-if="assets[id].cap">
                        <dt>Cap</dt>
                        <dd>{{ assets[id].cap }}</dd>
                    </template>
                    <template v-if="assets[id].createdAtTimestamp">
                        <dt>Created</dt>
                        <dd>{{ formatTime(assets[id].createdAtTimestamp).local }}</dd>
                    </template>
                </dl>
                <p v-else-if="assetErrors[id]" class="err">{{ id }}: {{ assetErrors[id] }}</p>
                <p v-else class="small mono">{{ id }} — loading…</p>
            </div>
        </div>

        <div class="xcard">
            <h3>Transactions <span class="count">{{ txs.length }}{{ txToken ? '+' : '' }}</span></h3>
            <p v-if="txError" class="err">{{ txError }}</p>
            <div class="table_wrap">
                <table v-if="txs.length" class="list">
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Transaction</th>
                            <th class="num">Effect on this address</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in txs" :key="t.txHash">
                            <td :title="formatTime(t.timestamp).iso">{{ formatTime(t.timestamp).local }}</td>
                            <td>
                                {{ t.txType }}
                                <div v-if="t.destinationChain" class="small">to {{ chainName(t.destinationChain) }}</div>
                                <div v-else-if="t.sourceChain" class="small">from {{ chainName(t.sourceChain) }}</div>
                            </td>
                            <td>
                                <button type="button" class="link mono" @click="$emit('open', t.txHash)">{{ t.txHash }}</button>
                                <div class="small">
                                    <template v-if="t.blockHeight !== undefined">block #{{ t.blockHeight }}</template>
                                    <template v-else-if="t.vertices && t.vertices.length">vertex {{ t.vertices[0].height }}</template>
                                </div>
                            </td>
                            <td class="num">
                                <div v-for="c in netChangeFor(t, address)" :key="c.assetId" :class="c.net > BigInt(0) ? 'pos' : c.net < BigInt(0) ? 'neg' : ''">
                                    {{ c.net > BigInt(0) ? '+' : '' }}{{ formatAmount(c.net, c.denomination) }} {{ c.symbol }}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="!txs.length && !txLoading && !txError" class="muted">No transactions.</p>
            <p v-if="txLoading" class="small">Loading…</p>
            <button v-if="txToken && !txLoading" type="button" class="more_btn" @click="loadTxs">Load more transactions</button>
        </div>

        <div class="xcard">
            <h3>
                UTXOs <span class="count">{{ utxos.length }}{{ utxoToken ? '+' : '' }}</span>
                <label class="toggle small"><input v-model="includeSpent" type="checkbox" /> include spent</label>
            </h3>
            <p v-if="utxoError" class="err">{{ utxoError }}</p>
            <XUtxoCard v-for="u in utxos" :key="u.utxoId" :utxo="u" :address="address" show-state @open="$emit('open', $event)" />
            <p v-if="!utxos.length && !utxoLoading && !utxoError" class="muted">{{ includeSpent ? 'No UTXOs ever.' : 'No unspent UTXOs.' }}</p>
            <p v-if="utxoLoading" class="small">Loading…</p>
            <button v-if="utxoToken && !utxoLoading" type="button" class="more_btn" @click="loadUtxos(false)">Load more UTXOs</button>
        </div>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, watch, type PropType } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import XUtxoCard from './XUtxoCard.vue'
import {
    chainName,
    formatAmount,
    formatTime,
    getAssetDetails,
    getBalances,
    listChainIds,
    listTransactions,
    listUtxos,
    netChangeFor,
    type XAssetDetails,
    type XBalances,
    type XNetwork,
    type XTransaction,
    type XUtxo,
} from '@/explorer/xchain'

const BALANCE_KINDS = [
    { key: 'unlocked', label: 'Unlocked', hint: 'spendable now' },
    { key: 'locked', label: 'Locked', hint: 'time-locked outputs' },
    { key: 'atomicMemoryUnlocked', label: 'Atomic memory', hint: 'exported here, waiting to be imported' },
    { key: 'atomicMemoryLocked', label: 'Atomic memory (locked)', hint: 'exported here, time-locked' },
] as const

export default defineComponent({
    name: 'XAddressView',
    components: { CopyText, XUtxoCard },
    props: {
        address: { type: String, required: true },
        network: { type: String as PropType<XNetwork>, required: true },
    },
    emits: ['open'],
    setup(props) {
        const chains = ref<string[] | null>(null)
        const chainsError = ref('')
        const balances = ref<XBalances | null>(null)
        const balancesError = ref('')
        const assets = reactive<Record<string, XAssetDetails>>({})
        const assetErrors = reactive<Record<string, string>>({})

        const txs = ref<XTransaction[]>([])
        const txToken = ref<string | undefined>()
        const txLoading = ref(false)
        const txError = ref('')

        const utxos = ref<XUtxo[]>([])
        const utxoToken = ref<string | undefined>()
        const utxoLoading = ref(false)
        const utxoError = ref('')
        const includeSpent = ref(false)

        /** Bumped per address, so a slow response for the previous one is dropped. */
        let generation = 0
        /** Bumped whenever the UTXO list restarts (new address or the spent toggle). */
        let utxoGeneration = 0

        // Non-zero rows only, except that an empty "unlocked" list means no balance at all.
        const nonZero = (b: XBalances) => {
            const out: any = {}
            for (const k of BALANCE_KINDS) out[k.key] = (b[k.key] || []).filter((x) => x.amount !== '0' || x.utxoCount > 0)
            return out as XBalances
        }
        const balanceRows = computed(() => (balances.value ? BALANCE_KINDS.reduce((n, k) => n + (balances.value![k.key]?.length ?? 0), 0) : 0))
        const heldAssetIds = computed(() => {
            const ids = new Set<string>()
            if (balances.value) for (const k of BALANCE_KINDS) for (const b of balances.value[k.key] || []) ids.add(b.assetId)
            return Array.from(ids)
        })

        const loadTxs = async () => {
            const gen = generation
            txLoading.value = true
            txError.value = ''
            try {
                const page = await listTransactions(props.network, props.address, txToken.value)
                if (gen !== generation) return
                txs.value = txs.value.concat(page.items)
                txToken.value = page.nextPageToken
            } catch (e: any) {
                if (gen === generation) txError.value = e.message
            } finally {
                if (gen === generation) txLoading.value = false
            }
        }

        const loadUtxos = async (reset: boolean) => {
            if (reset) {
                utxoGeneration++
                utxos.value = []
                utxoToken.value = undefined
            }
            const gen = utxoGeneration
            utxoLoading.value = true
            utxoError.value = ''
            try {
                const page = await listUtxos(props.network, props.address, includeSpent.value, utxoToken.value)
                if (gen !== utxoGeneration) return
                utxos.value = utxos.value.concat(page.items)
                utxoToken.value = page.nextPageToken
            } catch (e: any) {
                if (gen === utxoGeneration) utxoError.value = e.message
            } finally {
                if (gen === utxoGeneration) utxoLoading.value = false
            }
        }

        const load = async () => {
            const gen = ++generation
            chains.value = null
            chainsError.value = ''
            balances.value = null
            balancesError.value = ''
            txs.value = []
            txToken.value = undefined
            const { address, network } = props
            listChainIds(network, address)
                .then((c) => gen === generation && (chains.value = c))
                .catch((e: Error) => gen === generation && (chainsError.value = e.message))
            getBalances(network, address)
                .then((b) => {
                    if (gen !== generation) return
                    balances.value = nonZero(b)
                    for (const id of heldAssetIds.value) {
                        if (assets[id]) continue
                        getAssetDetails(network, id)
                            .then((d) => (assets[id] = d))
                            .catch((e: Error) => (assetErrors[id] = e.message))
                    }
                })
                .catch((e: Error) => gen === generation && (balancesError.value = e.message))
            loadTxs()
            loadUtxos(true)
        }

        watch(() => [props.address, props.network], load, { immediate: true })
        watch(includeSpent, () => loadUtxos(true))

        return {
            BALANCE_KINDS,
            chains,
            chainsError,
            balances,
            balancesError,
            balanceRows,
            heldAssetIds,
            assets,
            assetErrors,
            txs,
            txToken,
            txLoading,
            txError,
            loadTxs,
            utxos,
            utxoToken,
            utxoLoading,
            utxoError,
            includeSpent,
            loadUtxos,
            chainName,
            formatAmount,
            formatTime,
            netChangeFor,
            BigInt,
        }
    },
})
</script>

<style scoped lang="scss">
@use './explorer';

.asset + .asset {
    border-top: 1px solid var(--bg);
    margin-top: 10px;
    padding-top: 10px;
}

.toggle {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
}
</style>
