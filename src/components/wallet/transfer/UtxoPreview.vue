<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Shows which UTXOs a pending X or P chain transaction will consume.

  Collapsed to a one-line summary by default: the count and total are what
  most people need, and expanding costs a click only when the detail matters.
  The change line is the reason this exists at all — on a UTXO chain, sending
  10 from a 500 coin spends the whole 500 and returns 490, which is
  surprising the first time you see it on an explorer rather than here.

  Purely presentational; selection itself comes from the real transaction
  builder. See js/utxoPreview.ts.
-->
<template>
    <div class="utxo_preview" v-if="preview && preview.rows.length">
        <button type="button" class="preview_head" @click="expanded = !expanded">
            <fa :icon="expanded ? 'angle-down' : 'angle-right'" class="chevron"></fa>
            <span class="head_label">
                Spending {{ preview.rows.length }} UTXO{{ preview.rows.length === 1 ? '' : 's' }}
            </span>
            <span class="head_total">{{ totalText }}</span>
        </button>

        <div v-if="expanded" class="preview_body">
            <div v-for="row in preview.rows" :key="row.utxoId" class="utxo_row">
                <div class="row_main">
                    <span class="row_amount">{{ formatAmount(row.amount, row.assetId) }}</span>
                    <span v-if="row.threshold > 1" class="tag multisig">
                        {{ row.threshold }}-of-{{ row.owners.length }}
                    </span>
                    <span v-if="!row.locktime.isZero()" class="tag">locked</span>
                </div>
                <p class="row_ref mono">{{ row.txId }}:{{ row.outputIdx }}</p>
            </div>

            <div v-if="changeRows.length" class="change_note">
                <p v-for="c in changeRows" :key="c.assetId">
                    <fa icon="arrow-left"></fa>
                    {{ c.text }} returns to your wallet as change
                </p>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { useAssetsStore } from '@/stores'
import { bnToBig } from '@/helpers/helper'
import type { UtxoPreview } from '@/js/utxoPreview'

export default defineComponent({
    name: 'UtxoPreview',
    props: {
        preview: {
            type: Object as () => UtxoPreview | null,
            default: null,
        },
    },
    setup(props) {
        const assetsStore = useAssetsStore()
        const expanded = ref(false)

        const assetMeta = (assetId: string): { symbol: string; denomination: number } => {
            const asset = assetsStore.assetsDict[assetId]
            return {
                symbol: asset?.symbol ?? assetId.slice(0, 8),
                // Falling back to 0 shows the raw base-unit figure rather than
                // silently mis-scaling one — an asset the store has not seen
                // is better shown honestly than shown wrong.
                denomination: asset?.denomination ?? 0,
            }
        }

        const formatAmount = (amount: BN, assetId: string): string => {
            const { symbol, denomination } = assetMeta(assetId)
            const big: Big = bnToBig(amount, denomination)
            return `${big.toString()} ${symbol}`
        }

        const totalText = computed((): string => {
            if (!props.preview) return ''
            return Object.keys(props.preview.totals)
                .map((assetId) => formatAmount(props.preview!.totals[assetId], assetId))
                .join(' · ')
        })

        const changeRows = computed(() => {
            if (!props.preview) return []
            return Object.keys(props.preview.change).map((assetId) => ({
                assetId,
                text: formatAmount(props.preview!.change[assetId], assetId),
            }))
        })

        return { expanded, totalText, changeRows, formatAmount }
    },
})
</script>

<style scoped lang="scss">
.utxo_preview {
    margin-top: 12px;
    background: var(--bg-light);
    border-radius: 8px;
    overflow: hidden;
}

.preview_head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px 12px;
    text-align: left;
    font-size: 12px;
    color: var(--primary-color-light);

    &:hover {
        color: var(--primary-color);
    }
}

.chevron {
    font-size: 10px;
    flex-shrink: 0;
}

.head_label {
    font-weight: 600;
}

.head_total {
    margin-left: auto;
    color: var(--primary-color);
    white-space: nowrap;
}

.preview_body {
    padding: 0 12px 10px;
}

.utxo_row {
    padding: 6px 0;
    border-top: 1px solid var(--bg);
}

.row_main {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.row_amount {
    font-size: 13px;
    color: var(--primary-color);
}

.tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--bg);
    color: var(--primary-color-light);

    &.multisig {
        color: var(--secondary-color);
    }
}

.row_ref {
    margin-top: 2px;
    font-size: 10px;
    color: var(--primary-color-light);
    word-break: break-all;
    opacity: 0.75;
}

.mono {
    font-family: monospace;
}

.change_note {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--bg);

    p {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--primary-color-light);
        line-height: 1.5;
    }
}
</style>
