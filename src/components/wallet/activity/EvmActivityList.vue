<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Transaction history for the unified EVM platform — Activity.vue's own body
  is Avalanche/Glacier-specific from top to bottom (TransactionType, month
  pagination, X/P/staking filters, CSV export), so rather than force a second
  data shape through that component, this is a self-contained sibling
  Activity.vue delegates to instead of its usual body whenever the EVM
  platform is active. See evm/explorers/types.ts's `ExplorerAdapter.
  listTransactions` for where the data actually comes from.

  Deliberately simpler than the Avalanche page: no month grouping (an
  explorer's own recency cursor, not a calendar range, is what these APIs
  paginate by), no CSV export, no ERC-20-transfer sub-decoding. A real,
  accurate list beats a feature-complete-looking one built on data these
  explorers don't actually return.
-->
<template>
    <div class="evm_activity">
        <div v-if="!wallet" class="state_message">
            <p>Connect a wallet to see its transaction history.</p>
        </div>

        <div v-else-if="!supported" class="state_message">
            <p>
                Transaction history isn't available for {{ network.name }} — its explorer (
                <code>{{ network.explorerApi.family }}</code>
                ) doesn't support listing transactions yet.
            </p>
        </div>

        <template v-else>
            <div class="header_row">
                <p class="found">{{ txs.length }} transaction{{ txs.length === 1 ? '' : 's' }}</p>
                <button class="refresh_btn" @click="reload" :disabled="isLoadingFirstPage">
                    <fa icon="sync"></fa>
                </button>
            </div>

            <div v-if="isLoadingFirstPage" class="state_message">
                <Spinner class="spinner"></Spinner>
                <p>Loading transaction history…</p>
            </div>

            <div v-else-if="err" class="state_message">
                <p>{{ err }}</p>
                <v-btn @click="reload" class="button_secondary" small depressed>Try Again</v-btn>
            </div>

            <div v-else-if="txs.length === 0" class="state_message">
                <p>No transactions found.</p>
            </div>

            <div v-else class="tx_list">
                <div v-for="tx in txs" :key="tx.hash" class="evm_tx_row">
                    <div class="row_top">
                        <span class="direction" :data-kind="directionOf(tx)">
                            {{ directionLabel(tx) }}
                        </span>
                        <span v-if="tx.methodLabel" class="method">{{ tx.methodLabel }}</span>
                        <span v-if="tx.status === 'failed'" class="status_failed">Failed</span>
                        <a
                            :href="txUrl(tx)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="explorer_link"
                            title="View on explorer"
                        >
                            <fa icon="search"></fa>
                        </a>
                    </div>
                    <div class="row_mid">
                        <span class="addr">{{ shortAddr(tx.from) }}</span>
                        <span class="arr">→</span>
                        <span class="addr">
                            {{ tx.to ? shortAddr(tx.to) : 'Contract Creation' }}
                        </span>
                    </div>
                    <div class="row_bottom">
                        <span class="value" v-if="!isZero(tx.valueWei)">
                            {{ formatValue(tx.valueWei) }} {{ network.native.symbol }}
                        </span>
                        <span class="time">{{ formatTime(tx.timestampMs) }}</span>
                    </div>
                </div>

                <div class="load_more_row" v-if="nextCursor !== null || isLoadingMore">
                    <v-btn
                        @click="loadMore"
                        class="button_secondary"
                        small
                        depressed
                        :loading="isLoadingMore"
                    >
                        Load More
                    </v-btn>
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onMounted } from 'vue'
import Big from 'big.js'

import { useEvmStore } from '@/platforms/evm/store'
import { explorerAdapterFor, type EvmActivityTx } from '@/evm/explorers'
import { explorerTxUrl } from '@/evm/networkRegistry'
import Spinner from '@/components/misc/Spinner.vue'

export default defineComponent({
    name: 'EvmActivityList',
    components: { Spinner },
    setup() {
        const evmStore = useEvmStore()

        const wallet = computed(() => evmStore.wallet)
        const network = computed(() => evmStore.network)

        const supported = computed(
            (): boolean => !!explorerAdapterFor(network.value)?.listTransactions
        )

        const txs = ref<EvmActivityTx[]>([])
        const nextCursor = ref<unknown | null>(null)
        const isLoadingFirstPage = ref(false)
        const isLoadingMore = ref(false)
        const err = ref('')

        // Every fetch (first page or "load more") is stamped with the
        // address/network it was issued for, so a slow response landing
        // after the user switched networks or accounts can't append onto a
        // list it no longer belongs to.
        let requestKey = ''
        const keyFor = (addr: string, chainId: number) => `${addr.toLowerCase()}:${chainId}`

        const reload = async (): Promise<void> => {
            const w = wallet.value
            if (!w || !supported.value) return
            const key = keyFor(w.getPrimaryAddress(), network.value.evmChainId)
            requestKey = key
            txs.value = []
            nextCursor.value = null
            err.value = ''
            isLoadingFirstPage.value = true
            try {
                const page = await explorerAdapterFor(network.value)!.listTransactions!(
                    w.getPrimaryAddress(),
                    network.value
                )
                if (requestKey !== key) return
                txs.value = page.transactions
                nextCursor.value = page.nextCursor
            } catch (e: any) {
                if (requestKey !== key) return
                err.value = e?.message || 'Could not load transaction history.'
            } finally {
                if (requestKey === key) isLoadingFirstPage.value = false
            }
        }

        const loadMore = async (): Promise<void> => {
            const w = wallet.value
            if (!w || !supported.value || nextCursor.value === null) return
            const key = keyFor(w.getPrimaryAddress(), network.value.evmChainId)
            isLoadingMore.value = true
            try {
                const page = await explorerAdapterFor(network.value)!.listTransactions!(
                    w.getPrimaryAddress(),
                    network.value,
                    nextCursor.value
                )
                if (requestKey !== key) return
                txs.value = [...txs.value, ...page.transactions]
                nextCursor.value = page.nextCursor
            } catch (e: any) {
                if (requestKey !== key) return
                err.value = e?.message || 'Could not load more transactions.'
            } finally {
                if (requestKey === key) isLoadingMore.value = false
            }
        }

        // Re-fetches on wallet connect/disconnect and on switching network —
        // a stale list from the previous address/chain is worse than an
        // empty one.
        watch([wallet, network], () => {
            if (wallet.value) reload()
            else {
                txs.value = []
                nextCursor.value = null
                err.value = ''
            }
        })
        onMounted(() => {
            if (wallet.value) reload()
        })

        const directionOf = (tx: EvmActivityTx): 'in' | 'out' | 'other' => {
            const addr = wallet.value?.getPrimaryAddress().toLowerCase()
            if (!addr) return 'other'
            if (tx.from.toLowerCase() === addr) return 'out'
            if (tx.to?.toLowerCase() === addr) return 'in'
            return 'other'
        }

        const directionLabel = (tx: EvmActivityTx): string => {
            if (tx.isContractCreation) return 'Contract Creation'
            const dir = directionOf(tx)
            if (dir === 'out') return 'Sent'
            if (dir === 'in') return 'Received'
            return 'Contract Interaction'
        }

        const shortAddr = (addr: string): string =>
            addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr

        const isZero = (wei: string): boolean => !wei || /^0+$/.test(wei)

        const formatValue = (wei: string): string => {
            try {
                return Big(wei)
                    .div(Big(10).pow(network.value.native.decimals))
                    .toFixed(6)
                    .replace(/\.?0+$/, '')
            } catch {
                return '0'
            }
        }

        const formatTime = (ms: number): string => {
            if (!ms) return ''
            return new Date(ms).toLocaleString()
        }

        const txUrl = (tx: EvmActivityTx): string => explorerTxUrl(network.value, tx.hash)

        return {
            wallet,
            network,
            supported,
            txs,
            nextCursor,
            isLoadingFirstPage,
            isLoadingMore,
            err,
            reload,
            loadMore,
            directionOf,
            directionLabel,
            shortAddr,
            isZero,
            formatValue,
            formatTime,
            txUrl,
        }
    },
})
</script>

<style scoped lang="scss">
.evm_activity {
    padding: 14px 0;
}

.state_message {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 40px 0;
    text-align: center;
    color: var(--primary-color-light);
    font-size: 14px;

    code {
        color: var(--primary-color);
    }
}

.spinner {
    width: 28px;
    height: 28px;
}

.header_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;

    .found {
        color: var(--primary-color-light);
        font-size: 13px;
    }

    .refresh_btn {
        color: var(--primary-color-light);
        &:hover {
            color: var(--primary-color);
        }
    }
}

.tx_list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.evm_tx_row {
    background: var(--bg-light);
    border-radius: 8px;
    padding: 12px 14px;
}

.row_top {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;

    .direction {
        font-weight: 600;
        font-size: 13px;
        color: var(--primary-color);

        &[data-kind='out'] {
            color: var(--error);
        }
        &[data-kind='in'] {
            color: var(--success);
        }
    }

    .method {
        font-size: 12px;
        color: var(--primary-color-light);
        background: var(--bg);
        border-radius: 4px;
        padding: 1px 6px;
    }

    .status_failed {
        font-size: 11px;
        font-weight: 600;
        color: var(--error);
        text-transform: uppercase;
    }

    .explorer_link {
        margin-left: auto;
        color: var(--primary-color-light);
        &:hover {
            color: var(--secondary-color);
        }
    }
}

.row_mid {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: monospace;
    font-size: 12px;
    color: var(--primary-color-light);
    margin-bottom: 4px;

    .arr {
        opacity: 0.6;
    }
}

.row_bottom {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--primary-color-light);

    .value {
        color: var(--primary-color);
        font-weight: 600;
    }
}

.load_more_row {
    display: flex;
    justify-content: center;
    margin-top: 8px;
}
</style>
