<template>
    <div class="tx_out">
        <div class="addresses">
            <p v-for="addr in summary.addresses" :key="addr">{{ direction }} {{ 'X-' + addr }}</p>
        </div>
        <p class="amount" :profit="isProfit">
            {{ amtText }}
            <template v-if="assetDetail">
                {{ assetDetail.symbol }}
            </template>
        </p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { BaseTxAssetSummary } from '@/helpers/history_helper'
import AvaAsset from '@/js/AvaAsset'
import { bnToBig } from '@/helpers/helper'
import { BN } from '@/avalanche'

interface Props {
    assetID: string
    summary: BaseTxAssetSummary
}

export default defineComponent({
    name: 'BaseTxOutput',
    props: {
        assetID: {
            type: String,
            required: true
        },
        summary: {
            type: Object as () => BaseTxAssetSummary,
            required: true
        }
    },
    setup(props: Props) {
        const store = useStore()

        const assetDetail = computed((): AvaAsset => {
            return (
                store.state.Assets.assetsDict[props.assetID] ||
                store.state.Assets.nftFamsDict[props.assetID]
            )
        })

        const payload = computed(() => {
            return props.summary.payload
        })

        const isProfit = computed(() => {
            return props.summary.amount.gte(new BN(0))
        })

        const actionText = computed(() => {
            if (isProfit.value) {
                return 'Received'
            } else {
                return 'Sent'
            }
        })

        const direction = computed(() => {
            if (isProfit.value) {
                return 'from'
            } else {
                return 'to'
            }
        })

        const amtText = computed(() => {
            const big = bnToBig(props.summary.amount, assetDetail.value?.denomination || 0)
            return big.toLocaleString()
        })

        return {
            assetDetail,
            payload,
            isProfit,
            actionText,
            direction,
            amtText
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../../main";
.tx_out {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 12px;
}
.amount {
    text-align: right;
    white-space: nowrap;
    font-size: 15px;
    color: #d04c4c;

    &[profit] {
        color: var(--success);
    }
}

.addresses {
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-self: center;
    p {
        overflow: hidden;
        color: var(--primary-color-light);
        white-space: nowrap;
        font-size: 12px;
        line-height: 12px;
        font-family: monospace;
        text-overflow: ellipsis;
    }

    label {
        line-height: 12px;
    }
}
label {
    font-size: 12px;
    color: var(--primary-color-light);
}

@include main.medium-device {
    .amount {
        font-size: 13px;
    }
}
</style>
