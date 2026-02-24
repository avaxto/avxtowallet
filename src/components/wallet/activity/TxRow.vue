<template>
    <div class="tx_row" :day_change="source.isDayChange">
        <div class="tx_cols">
            <div class="explorer_col">
                <a
                    v-if="explorerUrl"
                    :href="explorerUrl"
                    target="_blank"
                    tooltip="View in Explorer"
                    class="explorer_link"
                >
                    <fa icon="search"></fa>
                </a>
            </div>
            <div class="meta_col">
                <div>
                    <label>Date</label>
                    <p class="time">
                        {{ date.toDateString() }}
                        <span>{{ date.toLocaleTimeString() }}</span>
                    </p>
                </div>
            </div>
            <div class="tx_detail">
                <component :is="tx_comp" :transaction="source"></component>
                <p v-if="hasMultisig" class="multisig_warn">
                    <fa icon="exclamation-triangle"></fa>
                    Contains Shared Balance (Multisig)
                </p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useAssetsStore } from '@/stores'
import { AssetsDict, NftFamilyDict } from '@/types'
import { PChainUtxo, Utxo } from '@avalabs/glacier-sdk'

import StakingTx from '@/components/SidePanels/History/ViewTypes/StakingTx.vue'
import BaseTx from '@/components/SidePanels/History/ViewTypes/BaseTx.vue'
import ImportExport from '@/components/SidePanels/History/ViewTypes/ImportExport.vue'
import moment from 'moment'
import { getUrlFromTransaction } from '@/js/Glacier/getUrlFromTransaction'
import {
    TransactionType,
    isCChainImportTransaction,
    isTransactionX,
    isTransactionC,
    TransactionTypeName,
} from '@/js/Glacier/models'
import { ava } from '@/AVA'

interface Props {
    index: number
    source: TransactionType
}

export default defineComponent({
    name: 'TxRow',
    components: {
        StakingTx,
        BaseTx,
        ImportExport,
    },
    props: {
        index: {
            type: Number,
            required: true
        },
        source: {
            type: Object as () => TransactionType,
            required: true
        }
    },
    setup(props: Props) {
        const assetsStore = useAssetsStore()
        const explorerUrl = computed((): string | null => {
            const netID = ava.getNetworkID()
            return getUrlFromTransaction(netID, props.source)
        })

        const hasMultisig = computed(() => {
            if (!isCChainImportTransaction(props.source)) {
                if (!props.source.emittedUtxos) return false
                let totMultiSig = 0
                props.source.emittedUtxos.forEach((utxo: Utxo | PChainUtxo) => {
                    if (utxo.addresses.length > 1) {
                        totMultiSig++
                    }
                })
                return totMultiSig > 0
            }
            return false
        })

        const timestamp = computed(() => {
            if (isTransactionX(props.source) || isTransactionC(props.source)) {
                return props.source.timestamp * 1000
            } else {
                return props.source.blockTimestamp * 1000
            }
        })

        const date = computed(() => {
            return new Date(timestamp.value)
        })

        const type = computed((): TransactionTypeName => {
            return props.source.txType
        })

        const tx_comp = computed(() => {
            switch (type.value) {
                case 'ExportTx':
                case 'ImportTx':
                    return ImportExport
                case 'AddDelegatorTx':
                case 'AddValidatorTx':
                    return StakingTx
                default:
                    return BaseTx
            }
        })

        const assets = computed((): AssetsDict => {
            return assetsStore.assetsDict
        })

        const nftFams = computed((): NftFamilyDict => {
            return assetsStore.nftFamsDict
        })

        const mom = computed(() => {
            return moment(timestamp.value)
        })

        const dayLabel = computed(() => {
            return mom.value.format('dddd Do')
        })

        const monthLabel = computed((): string => {
            const month = mom.value.format('MMMM')
            return month
        })

        const yearLabel = computed((): string => {
            return mom.value.format('Y')
        })

        return {
            explorerUrl,
            hasMultisig,
            timestamp,
            date,
            type,
            tx_comp,
            assets,
            nftFams,
            mom,
            dayLabel,
            monthLabel,
            yearLabel
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../main";
.tx_row {
    //display: grid;
    //grid-template-columns: 1fr 1fr;
    padding: 1px 0px;
    font-size: 13px;
    //display: grid;
    //grid-template-columns: 1fr 1fr;
    //margin-bottom: 22px;

    &[day_change] {
        margin-top: 14px;
        padding-top: 14px;
        border-top: 1px solid var(--bg-light);
    }
}
.tx_cols {
    display: grid;
    grid-template-columns: max-content 2fr 1fr;
    column-gap: 14px;
    background-color: var(--bg-light);
    padding: 8px 14px;
    border-radius: 4px;
}

.date {
    color: var(--primary-color);
    font-size: 14px;
    //display: flex;
    //max-width: 320px;
    //justify-content: space-between;
    padding-right: 30px;
    text-align: right;
    //padding-left: 40%;
}

.tx_detail {
    //margin-bottom: 8px;
    width: 100%;
}

.time {
    //color: var(--primary-color-light);
    font-size: 13px;

    span {
        margin-left: 12px;
    }
}
.memo {
    p {
        font-size: 12px;
    }
    overflow-wrap: break-word;
    width: 100%;
    max-width: 420px;
}

.meta_col {
    overflow: auto;
    display: grid;
    column-gap: 14px;
    grid-template-columns: max-content max-content;
}
.date_label {
    line-height: 24px;
    position: sticky;
    top: 0px;
    height: max-content;
    font-size: 24px;
    width: max-content;
    z-index: 2;
    //background-color: var(--bg);
}

.explorer_col {
    a {
        color: var(--primary-color);
        opacity: 0.4;
        font-size: 12px;

        &:hover {
            opacity: 1;
        }
    }
}

label {
    font-size: 12px;
    color: var(--primary-color-light);
}

.multisig_warn {
    color: var(--error);
}

@include main.mobile-device {
    .tx_cols {
        grid-template-columns: max-content 1fr;
    }

    .meta_col {
        border-bottom: 1px solid var(--bg);
        padding-bottom: 8px;
        margin-bottom: 8px;
    }

    .tx_detail {
        grid-column: 2/3;
        grid-row: 2;
    }
} ;
</style>
