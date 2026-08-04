<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="signed_tx_export" v-if="records.length">
        <p class="title">
            <fa icon="check-circle"></fa>
            {{ records.length === 1 ? 'Transaction signed — not sent' : `${records.length} transactions signed — not sent` }}
        </p>

        <p class="lead">
            Copy the transaction below and submit it from
            <router-link to="/wallet/broadcast">Broadcast Tx</router-link>
            when you are ready.
        </p>

        <div v-if="partialNote" class="partial">{{ partialNote }}</div>

        <div v-for="(rec, i) in records" :key="rec.id" class="record">
            <div class="rec_head">
                <span class="idx" v-if="records.length > 1">{{ i + 1 }}</span>
                <span class="label">{{ rec.label }}</span>
                <span class="badge">{{ familyLabel(rec) }}</span>
            </div>
            <textarea class="b64" readonly rows="4" :value="rec.base64" @focus="selectAll"></textarea>
            <div class="rec_actions">
                <CopyText :value="rec.base64" class="copy_btn"></CopyText>
                <span class="size">{{ byteLength(rec.base64) }} bytes</span>
            </div>
        </div>

        <div v-if="records.length > 1" class="bulk">
            <CopyText :value="allBase64" class="copy_btn"></CopyText>
            <span class="bulk_hint">
                Copy all {{ records.length }}, newline separated — submit them in
                this order, each depends on the one before it.
            </span>
        </div>

        <p class="warn">
            <b>These expire.</b>
            {{ warningText }}
            Broadcast promptly, and do not sign the same funds twice in the meantime.
        </p>

        <v-btn class="button_secondary" small depressed @click="$emit('done')">
            Done
        </v-btn>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, PropType } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import type { SignedTxRecord } from '@/stores/offlineSigning'

export default defineComponent({
    name: 'SignedTxExport',
    components: { CopyText },
    props: {
        records: {
            type: Array as PropType<SignedTxRecord[]>,
            required: true,
        },
        /**
         * Shown when only part of a multi-step flow could be signed up front —
         * cross-chain and swap, where the later step depends on the earlier one
         * being confirmed on chain first.
         */
        partialNote: {
            type: String,
            default: '',
        },
    },
    emits: ['done'],
    setup(props) {
        const familyLabel = (rec: SignedTxRecord) =>
            rec.family === 'evm' ? 'C-Chain (EVM)' : `${rec.chain}-Chain`

        const byteLength = (b64: string) => {
            // Length of the decoded payload, derived from the base64 length so
            // this stays cheap in a render path.
            const padding = (b64.match(/=+$/) || [''])[0].length
            return Math.max(0, (b64.length / 4) * 3 - padding)
        }

        const allBase64 = computed(() => props.records.map((r) => r.base64).join('\n'))

        const warningText = computed(() => {
            const hasEvm = props.records.some((r) => r.family === 'evm')
            const hasAvax = props.records.some((r) => r.family === 'avalanche')

            if (hasEvm && hasAvax) {
                return 'They are bound to a specific account nonce and to specific UTXOs, both of which become invalid if anything else spends them first.'
            }
            if (hasEvm) {
                return 'Each is bound to a specific account nonce — if another transaction uses that nonce first, this one can never be mined.'
            }
            return 'Each spends specific UTXOs — if those are spent by anything else first, this transaction becomes permanently invalid.'
        })

        const selectAll = (e: FocusEvent) => {
            ;(e.target as HTMLTextAreaElement).select()
        }

        return { familyLabel, byteLength, allBase64, warningText, selectAll }
    },
})
</script>

<style scoped lang="scss">
.signed_tx_export {
    margin-top: 20px;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 16px;
}

.title {
    color: var(--success);
    margin-bottom: 8px;
}

.lead {
    font-size: 0.85em;
    color: var(--primary-color-light);
    margin-bottom: 12px;
}

.partial {
    font-size: 0.82em;
    background-color: var(--bg);
    border-radius: 4px;
    padding: 8px 12px;
    margin-bottom: 12px;
}

.record {
    margin-bottom: 14px;
}

.rec_head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    font-size: 0.8em;
}

.idx {
    background-color: var(--bg);
    border-radius: 50%;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9em;
}

.label {
    flex-grow: 1;
    word-break: break-word;
}

.badge {
    color: var(--primary-color-light);
    white-space: nowrap;
}

.b64 {
    width: 100%;
    font-family: monospace;
    font-size: 0.75em;
    padding: 8px 10px;
    background-color: var(--bg);
    color: var(--primary-color);
    border: none;
    border-radius: 4px;
    resize: vertical;
    word-break: break-all;
}

.rec_actions,
.bulk {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 4px;
}

.bulk {
    margin: 12px 0;
    padding-top: 12px;
    border-top: 1px solid var(--bg);
}

.size,
.bulk_hint {
    font-size: 0.75em;
    color: var(--primary-color-light);
}

.warn {
    font-size: 0.78em;
    color: var(--primary-color-light);
    margin: 12px 0;
}
</style>
