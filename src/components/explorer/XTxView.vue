<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Everything about one X-Chain transaction: the summary Glacier returns, the
  block (or, before Cortina, the DAG vertex) it was accepted in, every asset
  it moved, every input and output UTXO in full, and the raw response.
-->
<template>
    <div class="tx_view">
        <div class="xcard">
            <h3>
                Transaction
                <span class="xbadge">{{ tx.txType }}</span>
                <span class="xbadge in">Accepted</span>
            </h3>
            <dl class="fields">
                <dt>Transaction ID</dt>
                <dd class="mono">{{ tx.txHash }} <CopyText :value="tx.txHash" class="copy" /></dd>
                <dt>Network</dt>
                <dd>{{ network === 'mainnet' ? 'Mainnet' : 'Fuji testnet' }} · X-Chain</dd>
                <dt>Time</dt>
                <dd :title="time.iso">{{ time.local }} <span class="small">({{ tx.timestamp }})</span></dd>
                <dt>Format</dt>
                <dd>{{ tx.chainFormat === 'non-linear' ? 'Non-linear (DAG vertex, before the Cortina upgrade)' : 'Linear (block)' }}</dd>
                <template v-if="tx.blockHash">
                    <dt>Block</dt>
                    <dd>
                        #{{ tx.blockHeight }} <span class="mono small">{{ tx.blockHash }}</span>
                    </dd>
                </template>
                <template v-if="tx.vertices && tx.vertices.length">
                    <dt>{{ tx.vertices.length === 1 ? 'Vertex' : 'Vertices' }}</dt>
                    <dd>
                        <div v-for="v in tx.vertices" :key="v.hash">
                            height {{ v.height }} · {{ formatTime(v.timestamp).local }} <span class="mono small">{{ v.hash }}</span>
                        </div>
                    </dd>
                </template>
                <template v-if="tx.sourceChain">
                    <dt>Source chain</dt>
                    <dd>{{ chainName(tx.sourceChain) }} <span class="mono small">{{ tx.sourceChain }}</span></dd>
                </template>
                <template v-if="tx.destinationChain">
                    <dt>Destination chain</dt>
                    <dd>{{ chainName(tx.destinationChain) }} <span class="mono small">{{ tx.destinationChain }}</span></dd>
                </template>
                <dt>Memo</dt>
                <dd>
                    <template v-if="memo.hex">
                        <div v-if="memo.text !== null">“{{ memo.text }}”</div>
                        <div class="mono small">{{ memo.hex }}</div>
                    </template>
                    <span v-else class="muted">none</span>
                </dd>
                <dt>Fee</dt>
                <dd>
                    <div v-for="f in fees" :key="f.assetId">{{ formatAmount(f.net, f.denomination) }} {{ f.symbol }}</div>
                    <span v-if="!fees.length" class="muted">none</span>
                </dd>
                <dt>Inputs total</dt>
                <dd>
                    <div v-for="a in tx.amountUnlocked" :key="a.assetId">{{ formatAmount(a.amount, a.denomination) }} {{ a.symbol }}</div>
                </dd>
                <dt>Outputs total</dt>
                <dd>
                    <div v-for="a in tx.amountCreated" :key="a.assetId">{{ formatAmount(a.amount, a.denomination) }} {{ a.symbol }}</div>
                </dd>
                <template v-if="address">
                    <dt>Effect on X-{{ short(address) }}</dt>
                    <dd>
                        <div v-for="c in myChange" :key="c.assetId" :class="c.net > BigInt(0) ? 'pos' : c.net < BigInt(0) ? 'neg' : ''">
                            {{ c.net > BigInt(0) ? '+' : '' }}{{ formatAmount(c.net, c.denomination) }} {{ c.symbol }}
                        </div>
                        <span v-if="!myChange.length" class="muted">not involved</span>
                    </dd>
                </template>
                <template v-for="(v, k) in extras" :key="k">
                    <dt>{{ k }}</dt>
                    <dd class="mono small">{{ typeof v === 'object' ? JSON.stringify(v) : v }}</dd>
                </template>
            </dl>
        </div>

        <div v-if="tx.blockHash || (tx.vertices && tx.vertices.length)" class="xcard">
            <h3>{{ tx.blockHash ? 'Block' : 'Vertex' }}</h3>
            <p v-if="containerError" class="err">{{ containerError }}</p>
            <p v-else-if="!block && !vertex" class="small">Loading…</p>
            <dl v-if="block" class="fields">
                <dt>Height</dt>
                <dd>{{ block.blockNumber }}</dd>
                <dt>Hash</dt>
                <dd class="mono">{{ block.blockHash }}</dd>
                <dt>Parent</dt>
                <dd class="mono">{{ block.parentHash }}</dd>
                <dt>Time</dt>
                <dd>{{ formatTime(block.blockTimestamp).local }} <span class="small">({{ block.blockTimestamp }})</span></dd>
                <dt>Type</dt>
                <dd>{{ block.blockType }}</dd>
                <dt>Size</dt>
                <dd>{{ block.blockSizeBytes }} bytes</dd>
                <dt>Transactions ({{ block.txCount }})</dt>
                <dd>
                    <div v-for="h in block.transactions" :key="h">
                        <button type="button" class="link mono" :disabled="h === tx.txHash" @click="$emit('open', h)">{{ h }}</button>
                    </div>
                </dd>
                <template v-for="(v, k) in blockExtras" :key="k">
                    <dt>{{ k }}</dt>
                    <dd>
                        <dl v-if="v && typeof v === 'object'" class="fields">
                            <template v-for="(v2, k2) in v" :key="k2">
                                <dt>{{ k2 }}</dt>
                                <dd class="mono small">{{ v2 }}</dd>
                            </template>
                        </dl>
                        <span v-else class="mono small">{{ v }}</span>
                    </dd>
                </template>
            </dl>
            <dl v-if="vertex" class="fields">
                <dt>Height</dt>
                <dd>{{ vertex.vertexHeight }}</dd>
                <dt>Index</dt>
                <dd>{{ vertex.vertexIndex }}</dd>
                <dt>Hash</dt>
                <dd class="mono">{{ vertex.vertexHash }}</dd>
                <dt>Parents</dt>
                <dd>
                    <div v-for="p in vertex.parentHashes" :key="p" class="mono">{{ p }}</div>
                </dd>
                <dt>Time</dt>
                <dd>{{ formatTime(vertex.vertexTimestamp).local }} <span class="small">({{ vertex.vertexTimestamp }})</span></dd>
                <dt>Size</dt>
                <dd>{{ vertex.vertexSizeBytes }} bytes</dd>
                <dt>Transactions ({{ vertex.txCount }})</dt>
                <dd>
                    <div v-for="h in vertex.transactions" :key="h">
                        <button type="button" class="link mono" :disabled="h === tx.txHash" @click="$emit('open', h)">{{ h }}</button>
                    </div>
                </dd>
            </dl>
            <details v-if="block || vertex" class="raw">
                <summary>Raw {{ block ? 'block' : 'vertex' }} JSON</summary>
                <pre>{{ JSON.stringify(block || vertex, null, 2) }}</pre>
            </details>
        </div>

        <div class="xcard">
            <h3>Assets <span class="count">{{ assetIds.length }}</span></h3>
            <div v-for="id in assetIds" :key="id" class="asset">
                <template v-if="assets[id]">
                    <dl class="fields">
                        <dt>Name</dt>
                        <dd>{{ assets[id].name }} ({{ assets[id].symbol }})</dd>
                        <dt>Asset ID</dt>
                        <dd class="mono">{{ id }}</dd>
                        <dt>Type</dt>
                        <dd>{{ assets[id].type }}</dd>
                        <dt>Denomination</dt>
                        <dd>{{ assets[id].denomination }} decimals</dd>
                        <template v-if="assets[id].cap">
                            <dt>Cap</dt>
                            <dd>{{ assets[id].cap }}</dd>
                        </template>
                        <template v-if="assets[id].createdAtTimestamp">
                            <dt>Created</dt>
                            <dd>{{ formatTime(assets[id].createdAtTimestamp).local }}</dd>
                        </template>
                    </dl>
                </template>
                <p v-else-if="assetErrors[id]" class="err">{{ id }}: {{ assetErrors[id] }}</p>
                <p v-else class="small mono">{{ id }} — loading…</p>
            </div>
        </div>

        <div class="xcard">
            <h3>Inputs <span class="count">{{ tx.consumedUtxos.length }} UTXO{{ tx.consumedUtxos.length === 1 ? '' : 's' }} spent</span></h3>
            <XUtxoCard v-for="u in tx.consumedUtxos" :key="u.utxoId" :utxo="u" :address="address" @open="$emit('open', $event)" />
            <p v-if="!tx.consumedUtxos.length" class="small">No inputs (e.g. an import, whose inputs come from another chain's atomic memory).</p>
        </div>

        <div class="xcard">
            <h3>Outputs <span class="count">{{ tx.emittedUtxos.length }} UTXO{{ tx.emittedUtxos.length === 1 ? '' : 's' }} created</span></h3>
            <XUtxoCard v-for="u in tx.emittedUtxos" :key="u.utxoId" :utxo="u" :address="address" show-state @open="$emit('open', $event)" />
        </div>

        <details class="raw xcard">
            <summary>Raw transaction JSON (everything Glacier returned)</summary>
            <pre>{{ JSON.stringify(tx, null, 2) }}</pre>
        </details>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, reactive, ref, watch, type PropType } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import XUtxoCard from './XUtxoCard.vue'
import {
    chainName,
    decodeMemo,
    feesOf,
    formatAmount,
    formatTime,
    getAssetDetails,
    getBlock,
    getVertex,
    netChangeFor,
    type XAssetDetails,
    type XBlock,
    type XNetwork,
    type XTransaction,
    type XVertex,
} from '@/explorer/xchain'

const KNOWN_TX = new Set([
    'txHash',
    'chainFormat',
    'blockHash',
    'blockHeight',
    'vertices',
    'txType',
    'timestamp',
    'sourceChain',
    'destinationChain',
    'memo',
    'consumedUtxos',
    'emittedUtxos',
    'amountUnlocked',
    'amountCreated',
])
const KNOWN_BLOCK = new Set(['blockNumber', 'blockHash', 'parentHash', 'blockTimestamp', 'blockType', 'txCount', 'blockSizeBytes', 'transactions'])

export default defineComponent({
    name: 'XTxView',
    components: { CopyText, XUtxoCard },
    props: {
        tx: { type: Object as PropType<XTransaction>, required: true },
        network: { type: String as PropType<XNetwork>, required: true },
        /** When opened from an address, show what the transaction did to it. */
        address: { type: String, default: '' },
    },
    emits: ['open'],
    setup(props) {
        const time = computed(() => formatTime(props.tx.timestamp))
        const memo = computed(() => decodeMemo(props.tx.memo))
        const fees = computed(() => feesOf(props.tx))
        const myChange = computed(() => (props.address ? netChangeFor(props.tx, props.address) : []))
        const extras = computed(() => Object.fromEntries(Object.entries(props.tx).filter(([k]) => !KNOWN_TX.has(k))))
        const short = (a: string) => `${a.slice(0, 10)}…${a.slice(-6)}`

        const block = ref<XBlock | null>(null)
        const vertex = ref<XVertex | null>(null)
        const containerError = ref('')
        const blockExtras = computed(() => (block.value ? Object.fromEntries(Object.entries(block.value).filter(([k]) => !KNOWN_BLOCK.has(k))) : {}))

        const assetIds = computed(() => {
            const ids = new Set<string>()
            for (const u of [...props.tx.consumedUtxos, ...props.tx.emittedUtxos]) ids.add(u.asset.assetId)
            return Array.from(ids)
        })
        const assets = reactive<Record<string, XAssetDetails>>({})
        const assetErrors = reactive<Record<string, string>>({})

        const load = async () => {
            block.value = null
            vertex.value = null
            containerError.value = ''
            const tx = props.tx
            const container = tx.blockHash
                ? getBlock(props.network, tx.blockHash).then((b) => (block.value = b))
                : tx.vertices?.[0]
                  ? getVertex(props.network, tx.vertices[0].hash).then((v) => (vertex.value = v))
                  : Promise.resolve()
            container.catch((e: Error) => (containerError.value = e.message))
            for (const id of assetIds.value) {
                if (assets[id]) continue
                getAssetDetails(props.network, id)
                    .then((d) => (assets[id] = d))
                    .catch((e: Error) => (assetErrors[id] = e.message))
            }
        }
        watch(() => props.tx.txHash, load, { immediate: true })

        return {
            time,
            memo,
            fees,
            myChange,
            extras,
            short,
            block,
            vertex,
            containerError,
            blockExtras,
            assetIds,
            assets,
            assetErrors,
            chainName,
            formatAmount,
            formatTime,
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
</style>
