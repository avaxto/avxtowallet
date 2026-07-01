<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="batch_report">
        <h4>{{ title }}</h4>
        <p class="summary">
            <span class="ok">{{ successCount }} sent</span>
            <span v-if="failCount > 0" class="fail">, {{ failCount }} failed</span>
        </p>
        <ul class="report_list">
            <li v-for="(row, i) in results" :key="i" :class="row.status">
                <div class="row_head">
                    <fa :icon="row.status === 'success' ? 'check-circle' : 'times-circle'"></fa>
                    <span class="addr">{{ row.address }}</span>
                </div>
                <p v-if="row.status === 'success'" class="tx_id">
                    <b>ID:</b>
                    <a
                        v-if="explorerUrl(row.txId)"
                        :href="explorerUrl(row.txId)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ row.txId }}</a
                    >
                    <template v-else>{{ row.txId }}</template>
                </p>
                <p v-else class="err_msg">{{ row.error }}</p>
            </li>
        </ul>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'

export interface BatchTxResult {
    address: string
    status: 'success' | 'error'
    txId?: string
    error?: string
}

export default defineComponent({
    name: 'BatchTxReport',
    props: {
        results: {
            type: Array as () => BatchTxResult[],
            default: () => [],
        },
        title: {
            type: String,
            default: 'Transaction Report',
        },
        // Optional explorer base, e.g. https://subnets.avax.network/c-chain/tx/
        // or an X-chain explorer tx path. When empty, tx ids are plain text.
        explorerBase: {
            type: String,
            default: '',
        },
    },
    setup(props) {
        const successCount = computed(
            () => props.results.filter((r) => r.status === 'success').length
        )
        const failCount = computed(() => props.results.filter((r) => r.status === 'error').length)

        const explorerUrl = (txId?: string): string => {
            if (!props.explorerBase || !txId) return ''
            return props.explorerBase + txId
        }

        return { successCount, failCount, explorerUrl }
    },
})
</script>
<style scoped lang="scss">
.batch_report {
    text-align: left;
}

h4 {
    font-size: 13px;
    font-weight: bold;
    margin-bottom: 6px;
}

.summary {
    font-size: 13px;
    margin-bottom: 10px;

    .ok {
        color: var(--success);
    }
    .fail {
        color: var(--error);
    }
}

.report_list {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 320px;
    overflow-y: auto;

    li {
        background-color: var(--bg-light);
        border-radius: 3px;
        padding: 8px 12px;
        margin-bottom: 8px;

        &.success .row_head {
            color: var(--success);
        }
        &.error .row_head {
            color: var(--error);
        }
    }
}

.row_head {
    display: flex;
    align-items: center;
    column-gap: 8px;
    font-size: 13px;

    .addr {
        word-break: break-all;
        color: var(--primary-color);
    }
}

.tx_id,
.err_msg {
    font-size: 12px;
    word-break: break-all;
    margin: 4px 0 0;
    color: var(--primary-color-light);

    a {
        color: var(--secondary-color);
        text-decoration: underline;
    }
}

.err_msg {
    color: var(--error);
}
</style>
