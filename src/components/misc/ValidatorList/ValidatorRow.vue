<template>
    <tr class="validator_row">
        <td class="id">{{ validator.nodeID }}</td>
        <td class="amount">{{ amtText }}</td>
        <td class="amount">{{ remainingAmtText }}</td>
        <td style="text-align: center">{{ numDelegators }}</td>
        <td>{{ remainingTimeText }}</td>
        <td>{{ feeText }}%</td>
        <td>
            <button class="button_secondary" @click="select">Select</button>
        </td>
    </tr>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import moment from 'moment'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import { ValidatorListItem } from '@/types'

export default defineComponent({
    name: 'ValidatorRow',
    props: {
        validator: {
            type: Object as () => ValidatorListItem,
            required: true
        }
    },
    emits: ['select'],
    setup(props, { emit }) {
        const remainingMs = computed((): number => {
            let end = props.validator.endTime
            let remain = end.getTime() - Date.now()
            return remain
        })

        const remainingTimeText = computed(() => {
            let ms = remainingMs.value
            let duration = moment.duration(ms, 'milliseconds')
            return duration.humanize(true)
        })

        const stakeAmt = computed((): BN => {
            return props.validator.validatorStake
        })

        const amtText = computed(() => {
            let amt = stakeAmt.value
            let big = bnToBig(amt, 9)
            return big.toLocaleString(0)
        })

        const feeText = computed(() => {
            return props.validator.fee
        })

        const numDelegators = computed(() => {
            return props.validator.numDelegators
        })

        const totalDelegated = computed((): BN => {
            return props.validator.delegatedStake
        })

        const remainingStake = computed((): BN => {
            return props.validator.remainingStake
        })

        const remainingAmtText = computed((): string => {
            let big = bnToBig(remainingStake.value, 9)
            return big.toLocaleString(0)
        })

        const select = () => {
            emit('select', props.validator)
        }

        return {
            remainingMs,
            remainingTimeText,
            stakeAmt,
            amtText,
            feeText,
            numDelegators,
            totalDelegated,
            remainingStake,
            remainingAmtText,
            select
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.amount {
    text-align: right;
    font-family: monospace;
}

button {
    padding: 3px 12px;
    font-size: 13px;
    border-radius: 3px;
}

.id {
    word-break: break-all;
}
td {
    padding: 4px 14px;
    background-color: var(--bg-light);
    border: 1px solid var(--bg);
    font-size: 13px;
}

@include main.medium-device {
    td {
        font-size: 10px !important;
    }
}
</style>
