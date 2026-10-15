<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Coin control: pick which UTXOs a send may spend. Off by default — the
  wallet then chooses automatically, as before. Turned on, the transaction
  may only draw from the ticked UTXOs; the builder still uses as few of them
  as it needs, and the page's preview shows which ones before signing.

  Chain-neutral: the X-Chain rows come from js/coinControl.ts, the P-Chain
  ones from js/pChainSend.ts, both as `CoinRow`s.
-->
<template>
    <div class="coin_control">
        <label class="toggle">
            <v-switch
                :model-value="enabled"
                :disabled="disabled"
                color="secondary"
                density="compact"
                hide-details
                inset
                @update:model-value="setEnabled"
            ></v-switch>
            <span>Choose which UTXOs to spend</span>
        </label>

        <div v-if="enabled" class="panel">
            <p v-if="loading" class="hint">Loading UTXOs…</p>
            <p v-else-if="error" class="err">{{ error }}</p>
            <p v-else-if="!rows.length" class="hint">No UTXOs on this chain.</p>
            <template v-else>
                <div class="bar">
                    <span class="hint">{{ picked.length }} of {{ spendableCount }} selected</span>
                    <span class="actions">
                        <button type="button" :disabled="disabled" @click="selectAll">All</button>
                        <button type="button" :disabled="disabled" @click="selectNone">None</button>
                    </span>
                </div>
                <ul class="rows">
                    <li v-for="r in rows" :key="r.utxoId" :class="{ off: !r.spendable, on: isPicked(r.utxoId) }">
                        <label :title="r.reason || r.utxoId">
                            <input
                                type="checkbox"
                                :checked="isPicked(r.utxoId)"
                                :disabled="disabled || !r.spendable"
                                @change="toggle(r.utxoId)"
                            />
                            <span class="amount">{{ fmt(r) }}</span>
                            <span class="meta">
                                <span class="mono">{{ short(r.txId) }}:{{ r.outputIdx }}</span>
                                <span v-if="r.owners.length">· {{ shortAddr(r.owners[0]) }}<template v-if="r.owners.length > 1"> +{{ r.owners.length - 1 }}</template></span>
                                <span v-if="r.reason" class="reason">· {{ r.reason }}</span>
                            </span>
                        </label>
                    </li>
                </ul>
                <div v-if="Object.keys(totals).length" class="totals">
                    <span class="hint">Selected:</span>
                    <span v-for="(amt, assetId) in totals" :key="assetId" class="total">{{ fmtAmount(assetId, amt) }}</span>
                </div>
                <label v-if="onlyRow && onlyRow.ownAddress" class="same_change">
                    <input type="checkbox" :checked="sameChange" :disabled="disabled" @change="onSameChange" />
                    <span>
                        Send the change back to the same address
                        <span class="mono addr">{{ onlyRow.ownAddress }}</span>
                    </span>
                </label>
                <p v-if="!picked.length" class="err">Select at least one UTXO, or turn coin control off.</p>
            </template>
        </div>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, watch, type PropType } from 'vue'
import Big from 'big.js'
import type { BN } from '@/avalanche'
import { pickedTotals, type CoinRow } from '@/js/coinControl'

export interface AssetMeta {
    symbol: string
    denomination: number
}

export default defineComponent({
    name: 'CoinControl',
    props: {
        rows: { type: Array as PropType<CoinRow[]>, required: true },
        /** Selected UTXO ids. */
        modelValue: { type: Array as PropType<string[]>, required: true },
        enabled: { type: Boolean, required: true },
        disabled: { type: Boolean, default: false },
        loading: { type: Boolean, default: false },
        error: { type: String, default: '' },
        /** Symbol and decimals per asset id; unknown assets show the raw amount. */
        assets: { type: Object as PropType<Record<string, AssetMeta>>, default: () => ({}) },
        /**
         * With exactly one UTXO picked: send the change back to that UTXO's own
         * address instead of the wallet's change address.
         */
        sameChange: { type: Boolean, default: false },
    },
    emits: ['update:modelValue', 'update:enabled', 'update:sameChange'],
    setup(props, { emit }) {
        const picked = computed(() => props.modelValue.filter((id) => props.rows.some((r) => r.utxoId === id && r.spendable)))
        const pickedSet = computed(() => new Set(picked.value))
        const spendableCount = computed(() => props.rows.filter((r) => r.spendable).length)
        const totals = computed(() => pickedTotals(props.rows, pickedSet.value))

        /** The single picked row, when exactly one is picked. */
        const onlyRow = computed(() => (picked.value.length === 1 ? props.rows.find((r) => r.utxoId === picked.value[0]) : undefined))
        // The option belongs to that one UTXO: any other selection switches it off.
        watch(onlyRow, (row, prev) => {
            if (props.sameChange && row?.utxoId !== prev?.utxoId) emit('update:sameChange', false)
        })

        const onSameChange = (e: Event) => emit('update:sameChange', (e.target as HTMLInputElement).checked)

        const isPicked = (id: string) => pickedSet.value.has(id)
        const toggle = (id: string) => {
            const next = new Set(picked.value)
            next.has(id) ? next.delete(id) : next.add(id)
            emit('update:modelValue', Array.from(next))
        }
        const selectAll = () => emit('update:modelValue', props.rows.filter((r) => r.spendable).map((r) => r.utxoId))
        const selectNone = () => emit('update:modelValue', [])
        // Turning it on starts with nothing ticked, so nothing is spent by surprise.
        const setEnabled = (v: boolean | null) => {
            emit('update:enabled', !!v)
            if (!v) {
                emit('update:modelValue', [])
                emit('update:sameChange', false)
            }
        }

        const fmtAmount = (assetId: string, amount: BN) => {
            const meta = props.assets[assetId]
            if (!meta) return `${amount.toString()} (${assetId.slice(0, 6)}…)`
            const v = new Big(amount.toString()).div(new Big(10).pow(meta.denomination))
            return `${v.toFixed()} ${meta.symbol}`
        }
        const fmt = (r: CoinRow) => fmtAmount(r.assetId, r.amount)
        const short = (s: string) => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s)
        const shortAddr = (s: string) => (s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s)

        return { picked, onlyRow, onSameChange, spendableCount, totals, isPicked, toggle, selectAll, selectNone, setEnabled, fmt, fmtAmount, short, shortAddr }
    },
})
</script>

<style scoped lang="scss">
.coin_control {
    margin: 10px 0;
    color: var(--primary-color);
}

.toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    cursor: pointer;

    :deep(.v-switch) {
        flex: 0 0 auto;
    }
}

.panel {
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--bg-light);
}

.bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;

    .actions button {
        color: var(--secondary-color);
        font-size: 12px;
        margin-left: 10px;

        &:disabled {
            opacity: 0.5;
        }
    }
}

.rows {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 260px;
    overflow-y: auto;

    li {
        border-top: 1px solid var(--bg);
        padding: 5px 0;

        &.on .amount {
            color: var(--secondary-color);
        }

        // Not pickable: muted, not faded — fading made the reason unreadable.
        &.off {
            .amount {
                color: var(--primary-color-light);
                font-weight: 500;
            }

            label {
                cursor: not-allowed;
            }
        }
    }

    label {
        display: grid;
        grid-template-columns: auto auto 1fr;
        align-items: baseline;
        gap: 4px 10px;
        cursor: pointer;
        font-size: 13px;
        width: 100%;
    }

    .amount {
        font-weight: 600;
        white-space: nowrap;
    }

    .meta {
        font-size: 11px;
        color: var(--primary-color-light);
        overflow-wrap: anywhere;
    }

    .reason {
        color: var(--warning, #d49534);
    }
}

.mono {
    font-family: monospace;
}

.totals {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-top: 8px;
    font-size: 13px;

    .total {
        font-weight: 600;
    }
}

.same_change {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 10px;
    font-size: 13px;
    cursor: pointer;

    input {
        margin-top: 3px;
    }

    .addr {
        display: block;
        font-size: 11px;
        color: var(--primary-color-light);
        overflow-wrap: anywhere;
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 0;
}

.err {
    font-size: 12px;
    color: var(--error);
    margin: 6px 0 0;
}
</style>
