<template>
    <div class="tx_history_panel">
        <div class="history_block" :disabled="!isActivityPage"></div>
        <div class="header">
            <h2>Transactions</h2>
            <Spinner v-if="isUpdating" class="spinner"></Spinner>
        </div>
        <div class="empty" v-if="!isExplorer">
            <h4>{{ $t('transactions.error_api') }}</h4>
            <p>{{ $t('transactions.error_api_desc') }}</p>
        </div>
        <div class="empty" v-else-if="isEmpty && !isUpdating">
            <p>{{ $t('transactions.notx') }}</p>
        </div>
        <div class="list no_scroll_bar" v-else>
            <tx-history-row
                v-for="tx in transactions"
                :key="tx.txHash"
                :transaction="tx"
                class="tx_row"
            ></tx-history-row>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { useRoute } from 'vue-router'

import Spinner from '@/components/misc/Spinner.vue'
import TxHistoryRow from '@/components/SidePanels/TxHistoryRow.vue'
import { AvaNetwork } from '@/js/AvaNetwork'
import { TransactionType } from '@/js/Glacier/models'

export default defineComponent({
    name: 'TransactionHistoryPanel',
    components: {
        TxHistoryRow,
        Spinner,
    },
    setup() {
        const store = useStore()
        const route = useRoute()

        const isExplorer = computed((): boolean => {
            const network: AvaNetwork | null = store.state.Network.selectedNetwork
            if (!network) return false
            if (network.explorerUrl) {
                return true
            }
            return false
        })

        const isEmpty = computed((): boolean => {
            if (transactions.value.length === 0) {
                return true
            }
            return false
        })

        const isUpdating = computed((): boolean => {
            return store.state.History.isUpdating
        })

        const transactions = computed((): TransactionType[] => {
            return store.state.History.recentTransactions
        })

        const isActivityPage = computed(() => {
            if (route.fullPath.includes('/activity')) {
                return true
            }
            return false
        })

        const explorerUrl = computed((): string => {
            const addr = store.state.address.split('-')[1]
            return `https://explorer.avax.network/address/${addr}`
        })

        return {
            isExplorer,
            isEmpty,
            isUpdating,
            transactions,
            isActivityPage,
            explorerUrl
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.tx_history_panel {
    display: grid;
    grid-template-rows: max-content 1fr;
    overflow: auto;
    position: relative;
}

.header {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--bg-light);
    padding: 8px 16px;

    h2 {
        font-weight: normal;
    }

    a {
        /*background-color: var(--primary-color);*/
        /*color: #fff !important;*/
        padding: 4px 18px;
        font-size: 12px;
    }
}

.spinner {
    display: block;
    align-self: center;
    margin: 0 !important;
}
.list {
    overflow: scroll;
    padding: 8px 16px;
    padding-bottom: 20px;
}

.empty {
    font-size: 12px;
    text-align: center;
    padding: 30px;
}

.tx_row {
    border-bottom: 1px solid var(--bg-light);

    &:last-of-type {
        border: none;
    }
}
.warn {
    background-color: var(--bg-light);
    text-align: center;
    font-size: 12px;
    font-weight: bold;
    padding: 15px;
}

.history_block {
    position: absolute;
    background-color: var(--bg-wallet);
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    z-index: 1;
    opacity: 0.8;
    pointer-events: none;
    transition-duration: 0.2s;

    &[disabled] {
        opacity: 0;
    }
}
@include main.medium-device {
}
</style>
