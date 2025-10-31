<template>
    <div class="utxo" :income="isIncome">
        <p class="action">{{ actionText }}</p>
        <p
            class="amount"
            :style="{
                color: color,
            }"
        >
            {{ amountText }} {{ symbolText }}
        </p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, type PropType } from 'vue'
import { useStore } from '@/stores'

import Big from 'big.js'
import { TransactionType } from '@/store/modules/history/types'

export default defineComponent({
    name: 'TxHistoryValue',
    props: {
        amount: {
            type: [Number, String] as PropType<number | string>,
            required: true
        },
        assetId: {
            type: String,
            required: true
        },
        type: {
            type: String as PropType<TransactionType>,
            required: true
        },
        operationDirection: {
            type: String as PropType<'Sent' | 'Received'>,
            required: true
        }
    },
    setup(props) {
        const store = useStore()

        const asset = computed(() => {
            return (
                store.state.Assets.assetsDict[props.assetId] ||
                store.state.Assets.nftFamsDict[props.assetId]
            )
        })

        const color = computed((): string => {
            if (props.type === 'add_validator') return '#008dc5'
            if (props.type === 'add_delegator') return '#008dc5'

            if (props.amount > 0) {
                return '#6BC688'
            } else if (props.amount === 0) {
                return '#999'
            } else {
                return '#d04c4c'
            }
        })

        const isIncome = computed((): boolean => {
            if (props.amount > 0) {
                return true
            }
            return false
        })

        const actionText = computed((): string => {
            switch (props.type) {
                case 'pvm_import':
                    return 'Import (P)'
                case 'import':
                    return 'Import (X)'
                case 'pvm_export':
                    return 'Export (P)'
                case 'export':
                    return 'Export (X)'
                case 'base':
                    if (isIncome.value) {
                        return 'Received'
                    }
                    return 'Sent'
                case 'operation':
                    return props.operationDirection
                default:
                    // Capitalize first letter
                    return props.type
                        .split('_')
                        .map((value) => value[0].toUpperCase() + value.substring(1))
                        .join(' ')
            }
        })

        const amountText = computed((): string => {
            let assetVal = asset.value

            if (!assetVal) return props.amount.toString()

            try {
                let val = Big(props.amount).div(Math.pow(10, assetVal.denomination))
                return val.toLocaleString()
            } catch (e) {
                return ''
            }
        })

        const symbolText = computed((): string => {
            let assetVal = asset.value

            if (!assetVal) return props.assetId.substring(0, 4)

            return assetVal.symbol
        })

        return {
            asset,
            color,
            isIncome,
            actionText,
            amountText,
            symbolText
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.utxo {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 10px;

    > * {
        align-self: center;
    }

    &:not(:first-child) {
        .action {
            visibility: hidden;
        }
    }
}

.action {
    font-size: 12px;
    color: main.$primary-color-light;
}
.amount {
    text-align: right;
    white-space: nowrap;
    font-size: 15px;
}

@include main.medium-device {
    .amount {
        font-size: 14px;
    }
}
</style>
