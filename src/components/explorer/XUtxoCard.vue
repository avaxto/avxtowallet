<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  One X-Chain UTXO with every field Glacier returns for it: amount and asset,
  owners and spend rules (threshold, locktime), where it was created and
  where it was spent, and the credentials (public key + signature) that
  spent it. Addresses and transaction IDs emit `open` so the explorer can
  follow them.
-->
<template>
    <div class="utxo" :class="{ highlight }">
        <div class="utxo_head">
            <span class="amount">{{ formatAmount(utxo.asset.amount, utxo.asset.denomination) }} {{ utxo.asset.symbol || utxo.asset.name }}</span>
            <span class="badge">{{ utxo.utxoType }}</span>
            <span v-if="spentLabel" class="badge" :class="spentClass">{{ spentLabel }}</span>
        </div>
        <dl class="fields">
            <dt>UTXO ID</dt>
            <dd class="mono">{{ utxo.utxoId }} <CopyText :value="utxo.utxoId" class="copy" /></dd>
            <dt>Asset</dt>
            <dd>
                {{ utxo.asset.name }} ({{ utxo.asset.symbol }}) · {{ utxo.asset.type }} · {{ utxo.asset.denomination }} decimals
                <div class="mono small">{{ utxo.asset.assetId }}</div>
            </dd>
            <dt>Amount (base units)</dt>
            <dd class="mono">{{ utxo.asset.amount }}</dd>
            <dt>Output index</dt>
            <dd>{{ utxo.outputIndex }}</dd>
            <dt>{{ utxo.addresses.length === 1 ? 'Owner' : `Owners (${utxo.addresses.length})` }}</dt>
            <dd>
                <div v-for="a in utxo.addresses" :key="a">
                    <button type="button" class="link mono" :class="{ me: isMe(a) }" @click="$emit('open', `X-${a}`)">X-{{ a }}</button>
                </div>
            </dd>
            <dt>Threshold</dt>
            <dd>{{ utxo.threshold }} of {{ utxo.addresses.length }} signature{{ utxo.addresses.length === 1 ? '' : 's' }}</dd>
            <dt>Locktime</dt>
            <dd>
                <template v-if="utxo.locktime > 0">{{ utxo.locktime }} — spendable after {{ formatTime(utxo.locktime).local }}</template>
                <template v-else>0 (no time lock)</template>
            </dd>
            <dt>Created</dt>
            <dd>
                <button type="button" class="link mono" @click="$emit('open', utxo.creationTxHash)">{{ utxo.creationTxHash }}</button>
                <div class="small">on {{ chainName(utxo.createdOnChainId) }} · {{ formatTime(utxo.timestamp).local }}</div>
            </dd>
            <template v-if="utxo.consumingTxHash">
                <dt>Spent</dt>
                <dd>
                    <button type="button" class="link mono" @click="$emit('open', utxo.consumingTxHash)">{{ utxo.consumingTxHash }}</button>
                    <div class="small">
                        on {{ chainName(utxo.consumedOnChainId) }}<template v-if="utxo.consumingTxTimestamp"> · {{ formatTime(utxo.consumingTxTimestamp).local }}</template>
                    </div>
                </dd>
            </template>
            <template v-else-if="utxo.consumedOnChainId && utxo.consumedOnChainId !== utxo.createdOnChainId">
                <dt>Destination</dt>
                <dd>Exported to {{ chainName(utxo.consumedOnChainId) }}, waiting to be imported</dd>
            </template>
            <template v-if="utxo.credentials && utxo.credentials.length">
                <dt>Credentials</dt>
                <dd>
                    <div v-for="(c, i) in utxo.credentials" :key="i" class="cred">
                        <div><span class="small">Public key</span> <span class="mono">{{ c.publicKey }}</span></div>
                        <div><span class="small">Signature</span> <span class="mono">{{ c.signature }}</span></div>
                    </div>
                </dd>
            </template>
            <template v-if="utxo.utxoBytes">
                <dt>UTXO bytes</dt>
                <dd class="mono small">{{ utxo.utxoBytes }}</dd>
            </template>
            <template v-for="(v, k) in extras" :key="k">
                <dt>{{ k }}</dt>
                <dd class="mono small">{{ typeof v === 'object' ? JSON.stringify(v) : v }}</dd>
            </template>
        </dl>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, type PropType } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import { chainName, formatAmount, formatTime, type XUtxo } from '@/explorer/xchain'

/** Fields rendered above; anything else Glacier adds later still shows, under its own name. */
const KNOWN = new Set([
    'addresses',
    'utxoId',
    'asset',
    'utxoType',
    'outputIndex',
    'timestamp',
    'creationTxHash',
    'consumingTxHash',
    'consumingTxTimestamp',
    'locktime',
    'threshold',
    'createdOnChainId',
    'consumedOnChainId',
    'credentials',
    'utxoBytes',
])

export default defineComponent({
    name: 'XUtxoCard',
    components: { CopyText },
    props: {
        utxo: { type: Object as PropType<XUtxo>, required: true },
        /** The address being explored, to highlight its own outputs. */
        address: { type: String, default: '' },
        /** Show spent/unspent state (the UTXO list); a transaction's own inputs are spent by definition. */
        showState: { type: Boolean, default: false },
    },
    emits: ['open'],
    setup(props) {
        const isMe = (a: string) => !!props.address && a.toLowerCase() === props.address.toLowerCase()
        const highlight = computed(() => props.utxo.addresses.some(isMe))
        const spentLabel = computed(() => (props.showState ? (props.utxo.consumingTxHash ? 'spent' : 'unspent') : ''))
        const spentClass = computed(() => (props.utxo.consumingTxHash ? 'spent' : 'unspent'))
        const extras = computed(() => Object.fromEntries(Object.entries(props.utxo).filter(([k]) => !KNOWN.has(k))))
        return { formatAmount, formatTime, chainName, isMe, highlight, spentLabel, spentClass, extras }
    },
})
</script>

<style scoped lang="scss">
@use './explorer';
</style>
