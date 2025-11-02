<template>
    <div class="confirmation">
        <!--        <div>-->
        <!--            <label>{{ $t('earn.delegate.confirmation.node') }}</label>-->
        <!--            <p style="word-break: break-all">{{ nodeID }}</p>-->
        <!--        </div>-->
        <div>
            <label>{{ $t('earn.delegate.confirmation.amount') }}</label>
            <p>{{ amtText }} AVAX</p>
        </div>
        <div>
            <label>{{ $t('earn.delegate.confirmation.start') }}</label>
            <p>{{ $t('earn.delegate.confirmation.start_desc') }}</p>
        </div>
        <div>
            <label>{{ $t('earn.delegate.confirmation.end') }}</label>
            <p>{{ end.toLocaleString() }}</p>
        </div>
        <div>
            <label>{{ $t('earn.delegate.confirmation.reward') }} ({{ walletType }})</label>
            <p style="word-break: break-all">{{ rewardAddress }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
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
        const amtBig = computed(() => {
            let stakeAmt = Big(props.amount.toString()).div(Math.pow(10, 9))
            return stakeAmt
        })

        const walletType = computed(() => {
            if (props.rewardDestination === 'local') {
                return 'This wallet'
            }
            return 'Custom'
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
