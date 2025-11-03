<template>
    <div class="activity_page">
        <ExportGlacierHistoryModal ref="glacier_csv_modal"></ExportGlacierHistoryModal>
        <div class="explorer_warning" v-if="!hasExplorer">
            <div class="warning_body">
                <h1>{{ $t('activity.no_explorer.title') }}</h1>
                <p>{{ $t('activity.no_explorer.desc') }}</p>
            </div>
        </div>
        <div class="settings">
            <div class="filter_col">
                <div class="filter_cont">
                    <label>
                        Export CSV File (BETA)
                        <span style="font-size: 0.8em; opacity: 0.8" v-if="isCsvDisabled">
                            Not Supported For This Network
                        </span>
                    </label>
                    <div class="csv_buttons">
                        <v-btn
                            x-small
                            depressed
                            class="button_secondary"
                            @click="openGlacierCsvModal"
                            :disabled="isCsvDisabled"
                        >
                            Export History
                        </v-btn>
                    </div>
                </div>
                <div class="filter_cont">
                    <label>{{ $t('activity.label1') }}</label>
                    <RadioButtons :labels="modes" :keys="modeKey" v-model="mode"></RadioButtons>
                </div>
            </div>
            <div v-if="showList">
                <div class="pagination">
                    <p class="date_display">{{ monthNowName }} {{ yearNow }}</p>
                    <div>
                        <button @click="prevPage" :disabled="!isPrevPage">
                            <fa icon="angle-left"></fa>
                        </button>
                        <button @click="nextPage" :disabled="!isNextPage">
                            <fa icon="angle-right"></fa>
                        </button>
                    </div>
                </div>
                <div class="pagination_info">
                    <p>{{ $t('activity.found', [txs.length]) }}</p>
                    <button @click="updateHistory">
                        <fa icon="sync"></fa>
                    </button>
                </div>
            </div>
        </div>
        <div class="tx_table" ref="list">
            <div class="tx_list" v-show="showList">
                <virtual-list
                    v-show="txs.length > 0"
                    :style="{ height: `${listH}px`, overflowY: 'auto' }"
                    :data-key="'txHash'"
                    :data-sources="txsProcessed"
                    :data-component="RowComponent"
                    :keeps="20"
                    ref="vlist"
                    :estimate-size="txsProcessed.length"
                ></virtual-list>
                <div v-if="txs.length === 0" class="empty">
                    <p>{{ $t('activity.empty') }}</p>
                </div>
            </div>
            <div v-if="!showList" class="loading">
                <template v-if="!isError">
                    <Spinner class="spinner"></Spinner>
                    <p>{{ $t('activity.loading') }}</p>
                </template>
                <template v-else>
                    <p>Error Loading Activity History</p>
                    <v-btn @click="updateHistory" class="button_secondary" small depressed>
                        Try Again
                    </v-btn>
                </template>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import {
    isTransactionC,
    isTransactionX,
    TransactionType,
    TransactionTypeName,
} from '@/js/Glacier/models'

import TxRow from '@/components/wallet/activity/TxRow.vue'
import RadioButtons from '@/components/misc/RadioButtons.vue'
import Spinner from '@/components/misc/Spinner.vue'
//@ts-ignore
import VirtualList from 'vue3-virtual-scroll-list'
import { AvaNetwork } from '@/js/AvaNetwork'
import ExportCsvModal from '@/components/modals/ExportCsvModal.vue'
import ExportAvaxCsvModal from '@/components/modals/ExportAvaxCsvModal.vue'
import { WalletType } from '@/js/wallets/types'
import { BlockchainId } from '@avalabs/glacier-sdk'
import ExportGlacierHistoryModal from '@/components/modals/ExportGlacierHistoryModal.vue'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { isTestnetNetworkID } from '@/utils/network-utils'

type FilterModeType = 'all' | 'transfer' | 'export_import' | 'stake'
type ModeKeyType = 'all' | 'transfer' | 'swap' | 'stake'

const PAGE_LIMIT = 100
const YEAR_MIN = 2020
const MONTH_MIN = 8

export default defineComponent({
    name: 'activity',
    components: {
        ExportAvaxCsvModal,
        ExportCsvModal,
        ExportGlacierHistoryModal,
        Spinner,
        TxRow,
        RadioButtons,
        VirtualList,
    },
    setup() {
        const store = useStore()
        const { t } = useI18n()

        const mode = ref<ModeKeyType>('all')
        const modes = [
            t('activity.mode1'),
            t('activity.mode2'),
            t('activity.mode3'),
            t('activity.mode4'),
        ]
        const modeKey: ModeKeyType[] = ['all', 'transfer', 'swap', 'stake']
        const isLoading = ref(false)
        const pageNow = ref(0)
        const RowComponent = TxRow

        const monthNow = ref(0)
        const yearNow = ref(0)
        const listH = ref(100)

        const csv_modal = ref<InstanceType<typeof ExportCsvModal>>()
        const avax_csv_modal = ref<InstanceType<typeof ExportAvaxCsvModal>>()
        const glacier_csv_modal = ref<InstanceType<typeof ExportGlacierHistoryModal>>()
        const vlist = ref()
        const list = ref()

        const openCsvModal = () => {
            csv_modal.value?.open()
        }

        const openAvaxCsvModal = () => {
            avax_csv_modal.value?.open()
        }

        const openGlacierCsvModal = () => {
            glacier_csv_modal.value?.open()
        }

        const isCsvDisabled = computed(() => {
            return !hasExplorer.value || isFuji.value
        })

        const showList = computed((): boolean => {
            if (isUpdatingAll.value || isLoading.value || isError.value) return false
            return true
        })

        const isUpdatingAll = computed((): boolean => {
            return store.state.History.isUpdatingAll
        })

        const isNextPage = computed(() => {
            let now = new Date()
            if (yearNow.value < now.getFullYear()) return true
            if (monthNow.value < now.getMonth()) return true
            return false
        })

        const isPrevPage = computed(() => {
            if (monthNow.value === MONTH_MIN && yearNow.value === YEAR_MIN) return false
            return true
        })

        const monthNowName = computed(() => {
            return t(`activity.months.${monthNow.value}`)
        })

        const activeNetwork = computed((): AvaNetwork | null => {
            return store.state.Network.selectedNetwork
        })

        const isMainnet = computed(() => {
            return activeNetwork.value && isMainnetNetworkID(activeNetwork.value.networkId)
        })

        const isFuji = computed(() => {
            return activeNetwork.value && isTestnetNetworkID(activeNetwork.value.networkId)
        })

        const hasExplorer = computed(() => {
            if (!activeNetwork.value) return false
            return isMainnet.value || isFuji.value
        })

        const isError = computed(() => {
            return store.state.History.isError
        })

        const updateHistory = async () => {
            store.dispatch('History/updateAllTransactionHistory')
        }

        const monthGroups = computed((): any => {
            let res: any = {}
            let txsVal = txs.value

            for (var i = 0; i < txsVal.length; i++) {
                let tx = txsVal[i]
                let date = new Date(getTxTimestamp(tx))
                let month = date.getMonth()
                let year = date.getFullYear()
                let key = `${month}/${year}`
                if (res[key]) {
                    res[key].push(tx)
                } else {
                    res[key] = [tx]
                }
            }
            return res
        })

        const allTxs = computed((): TransactionType[] => {
            const supportedTypes: TransactionTypeName[] = [
                'BaseTx',
                'ImportTx',
                'ExportTx',
                'OperationTx',
                'AddValidatorTx',
                'AddDelegatorTx',
                'CreateAssetTx',
            ]
            return store.state.History.allTransactions.filter((tx: TransactionType) => {
                return supportedTypes.includes(tx.txType)
            })
        })

        const getTxTimestamp = (tx: TransactionType) => {
            if (isTransactionX(tx) || isTransactionC(tx)) {
                return tx.timestamp * 1000
            } else {
                return tx.blockTimestamp * 1000
            }
        }

        const txs = computed((): TransactionType[] => {
            let txsVal
            switch (mode.value) {
                case 'transfer':
                    txsVal = txsTransfer.value
                    break
                case 'swap':
                    txsVal = txsSwap.value
                    break
                case 'stake':
                    txsVal = txsStake.value
                    break
                default:
                    txsVal = allTxs.value
                    break
            }

            let filtered = txsVal.filter((tx) => {
                let date = new Date(getTxTimestamp(tx))

                if (date.getMonth() === monthNow.value && date.getFullYear() === yearNow.value) {
                    return true
                }
                return false
            })
            return filtered
        })

        const txsProcessed = computed(() => {
            let txsVal = txs.value

            let res = txsVal.map((tx, index) => {
                let showMonth = false
                let showDay = false

                if (index === 0) {
                    showMonth = true
                    showDay = true
                } else {
                    let txBefore = txsVal[index - 1]

                    let date = new Date(getTxTimestamp(tx))
                    let dateBefore = new Date(getTxTimestamp(txBefore))

                    if (dateBefore.getMonth() !== date.getMonth()) {
                        showMonth = true
                        showDay = true
                    } else if (dateBefore.getDay() !== date.getDay()) {
                        showDay = true
                    }
                }

                return {
                    ...tx,
                    isMonthChange: showMonth,
                    isDayChange: showDay,
                }
            })
            return res
        })

        const pageAmount = computed((): number => {
            return Math.floor(txs.value.length / PAGE_LIMIT)
        })

        const prevPage = () => {
            if (monthNow.value === 0) {
                yearNow.value = yearNow.value - 1
                monthNow.value = 11
            } else {
                monthNow.value = monthNow.value - 1
            }
            scrollToTop()
            setScrollHeight()
        }

        const nextPage = () => {
            if (monthNow.value === 11) {
                yearNow.value = yearNow.value + 1
                monthNow.value = 0
            } else {
                monthNow.value = monthNow.value + 1
            }
            scrollToTop()
            setScrollHeight()
        }

        const txsTransfer = computed((): TransactionType[] => {
            let transferTypes: TransactionTypeName[] = ['BaseTx', 'CreateAssetTx', 'OperationTx']
            return allTxs.value.filter((tx) => {
                return transferTypes.includes(tx.txType)
            })
        })

        const txsSwap = computed((): TransactionType[] => {
            let exportTypes: TransactionTypeName[] = ['ExportTx', 'ImportTx']
            return allTxs.value.filter((tx) => {
                return exportTypes.includes(tx.txType)
            })
        })

        const txsStake = computed((): TransactionType[] => {
            let stakeTypes: TransactionTypeName[] = ['AddValidatorTx', 'AddDelegatorTx']
            return allTxs.value.filter((tx) => {
                return stakeTypes.includes(tx.txType)
            })
        })

        const scrollToTop = () => {
            vlist.value?.scrollToIndex(0)
        }

        const setScrollHeight = () => {
            let h = list.value?.clientHeight
            listH.value = h
        }

        onMounted(() => {
            updateHistory()

            let now = new Date()
            yearNow.value = now.getFullYear()
            monthNow.value = now.getMonth()
            scrollToTop()
            setScrollHeight()
        })

        onUnmounted(() => {
            // Cleanup if needed
        })

        return {
            mode,
            modes,
            modeKey,
            isLoading,
            pageNow,
            RowComponent,
            monthNow,
            yearNow,
            listH,
            csv_modal,
            avax_csv_modal,
            glacier_csv_modal,
            vlist,
            list,
            openCsvModal,
            openAvaxCsvModal,
            openGlacierCsvModal,
            isCsvDisabled,
            showList,
            isUpdatingAll,
            isNextPage,
            isPrevPage,
            monthNowName,
            activeNetwork,
            isMainnet,
            isFuji,
            hasExplorer,
            isError,
            updateHistory,
            monthGroups,
            allTxs,
            getTxTimestamp,
            txs,
            txsProcessed,
            pageAmount,
            prevPage,
            nextPage,
            txsTransfer,
            txsSwap,
            txsStake,
            scrollToTop,
            setScrollHeight,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.activity_page {
    position: relative;
    display: grid;
    grid-template-rows: max-content 1fr;
    padding-bottom: 14px;
}

.explorer_warning {
    position: absolute;
    background-color: var(--bg);
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;

    h1 {
        font-weight: normal;
        margin-bottom: 14px;
        color: #fff;
    }

    .warning_body {
        display: flex;
        flex-direction: column;
        max-width: 380px;
        background-color: var(--secondary-color);
        color: #fff;
        padding: 30px;
        border-radius: 12px;
    }
}

.header {
    display: flex;
    flex-direction: row;
    align-items: center;

    p {
        margin: 0px 24px !important;
        color: var(--primary-color-light);
        font-size: 22px;
    }
}

.settings {
    display: flex;
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 12px;
}

.tx_table {
    height: 100%;
    overflow: auto;
    border-top: 2px solid var(--bg-wallet);
    //overflow: scroll;
    //padding-right: 20px;
    //margin-right: 20px;
    //border-right: 1px solid var(--bg-light);
}

.tx_list {
    //max-height: 480px;
    //overflow: scroll;
    height: 100%;
    position: relative;
}

.table_headers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    //border-bottom: 1px solid var(--bg-light);
    //background-color: var(--bg-light);
}

.month_group {
    padding-bottom: 30px;
    border-bottom: 1px solid var(--bg-light);
    margin-bottom: 30px;

    &:last-of-type {
        border: none;
    }
}
.month_label {
    position: sticky;
    top: 0px;
}

.cols {
    height: 100%;
    //overflow: auto;
    //display: grid;
    //grid-template-columns: 1fr 240px;
}

.empty,
.loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 18px 12px;
}

.loading {
    background-color: var(--bg-light);
    padding: 30px;
}
.spinner {
    //width: 40px;
    //height: 40px;
    font-size: 32px;
    margin-bottom: 22px;
    color: #1d82bb;
}

.pagination {
    display: flex;
    flex-direction: row;
    align-items: center;
    p {
        margin-right: 12px !important;
    }
    button {
        width: 24px;
        height: 24px;
        border-radius: 3px;
        border: 1px solid var(--secondary-color);
        color: var(--secondary-color);
        margin-left: 6px;
        opacity: 0.6;
        transition-duration: 0.1s;

        &:hover {
            opacity: 1;
        }

        &[disabled] {
            border-color: var(--primary-color-light);
            color: var(--primary-color-light);
            opacity: 0.4;
        }
    }
}

.date_display {
    font-size: 24px;
}

.filter_col {
    //display: flex;
    //flex-direction: row;
    //align-items: center;
}

.filter_cont {
    label {
        font-size: 12px;
        color: var(--primary-color);
    }
}

.pagination_info {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
    font-size: 13px;
    color: var(--primary-color-light);
    transition-duration: 0.1s;

    button {
        margin-left: 14px;
        color: var(--secondary-color);
        opacity: 0.6;
        &:hover {
            opacity: 1;
        }
    }
}

.csv_buttons {
    .v-btn {
        margin-right: 1em;
    }
}
@include main.medium-device {
    .pagination {
        p {
            font-size: 18px;
        }
    }
}

@include main.mobile-device {
    .settings {
        display: grid;
        grid-template-columns: none;
        grid-template-rows: auto auto;
    }

    .filter_col {
        grid-row: 2;
        justify-content: center;
    }

    .pagination {
        justify-content: space-between;
        button {
            width: 35px;
            height: 35px;
        }
    }

    .pagination_info {
        justify-content: flex-start;
    }

    .tx_list {
        height: 90vh;
    }
}
</style>
