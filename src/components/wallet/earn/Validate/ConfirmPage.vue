<template>
    <div class="confirmation">
        <div>
            <label>{{ $t('earn.validate.confirmation.id') }}</label>
            <p style="word-break: break-all">{{ nodeID }}</p>
        </div>
        <div>
            <label>{{ $t('earn.validate.confirmation.amount') }}</label>
            <p>{{ amtText }} AVAX</p>
        </div>
        <div>
            <label>{{ $t('earn.validate.confirmation.start') }}</label>
            <p>{{ $t('earn.validate.confirmation.start_desc') }}</p>
        </div>
        <div>
            <label>{{ $t('earn.validate.confirmation.end') }}</label>
            <p>{{ end.toLocaleString() }}</p>
        </div>
        <div>
            <label>{{ $t('earn.validate.confirmation.fee') }}</label>
            <p>{{ delegationFee }} %</p>
        </div>
        <div>
            <label>{{ $t('earn.validate.confirmation.reward') }} ({{ walletType }})</label>
            <p style="word-break: break-all">{{ rewardAddress }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BN } from '@/avalanche'
import Big from 'big.js'

export default defineComponent({
    name: 'ConfirmPage',
    props: {
        nodeID: {
            type: String,
            required: true
        },
        end: {
            type: Date,
            required: true
        },
        delegationFee: {
            type: Number,
            required: true
        },
        amount: {
            type: Object as () => BN,
            required: true
        },
        rewardAddress: {
            type: String,
            required: true
        },
        rewardDestination: {
            type: String,
            required: true
        }
    },
    setup(props) {
        const { t } = useI18n()

        const amtBig = computed(() => {
            let stakeAmt = Big(props.amount.toString()).div(Math.pow(10, 9))
            return stakeAmt
        })

        const walletType = computed(() => {
            if (props.rewardDestination === 'local') {
                return t('earn.validate.confirmation.type_local')
            }
            return t('earn.validate.confirmation.type_custom')
        })

        const amtText = computed(() => {
            let amt = amtBig.value
            return amt.toLocaleString(9)
        })

        return {
            amtBig,
            walletType,
            amtText
        }
    }
})
</script>
<style scoped lang="scss">
.confirmation {
    > div {
        background-color: var(--bg-light);
        margin: 14px 0;
        padding: 6px 14px;

        label {
            font-size: 14px;
            color: var(--primary-color-light);
        }
        p {
            font-size: 18px;
        }
    }

    .err {
        font-size: 14px;
    }
}
</style>
