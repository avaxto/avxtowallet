<template>
    <tr :locked="isLocked">
        <td style="text-align: left; padding-left: 8px">
            <input type="checkbox" @change="onSelect" v-model="isSelect" />
        </td>
        <td style="opacity: 0.4">
            <template v-if="isLocked"><fa icon="lock"></fa></template>
            <template v-else></template>
        </td>
        <td class="date_col">{{ lockDateText }}</td>
        <td class="amt_col">{{ amount.toLocaleString() }}</td>
    </tr>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import {
    UTXO,
    PlatformVMConstants,
    AmountOutput,
    StakeableLockOut,
} from 'avalanche/dist/apis/platformvm'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'
import { UnixNow } from 'avalanche/dist/utils'
import { BN } from 'avalanche'

interface Props {
    utxo: UTXO
}

export default defineComponent({
    name: 'UtxoRow',
    props: {
        utxo: {
            type: Object as () => UTXO,
            required: true
        }
    },
    emits: ['add', 'remove'],
    setup(props: Props, { emit }) {
        const isSelect = ref(false)

        const out = computed(() => {
            return props.utxo.getOutput()
        })

        const amount = computed((): Big => {
            let outId = out.value.getOutputID()
            if (outId === PlatformVMConstants.SECPXFEROUTPUTID) {
                let outValue = out.value as AmountOutput
                let amtBig = bnToBig(outValue.getAmount(), 9)
                return amtBig
            } else if (outId === PlatformVMConstants.STAKEABLELOCKOUTID) {
                let outValue = out.value as StakeableLockOut
                let amtBig = bnToBig(outValue.getAmount(), 9)
                return amtBig
            }

            return Big(0)
        })

        const lockTime = computed((): BN => {
            let outId = out.value.getOutputID()

            if (outId === PlatformVMConstants.SECPXFEROUTPUTID) {
                let outValue = out.value as AmountOutput
                return outValue.getLocktime()
            } else if (outId === PlatformVMConstants.STAKEABLELOCKOUTID) {
                let outValue = out.value as StakeableLockOut
                return outValue.getStakeableLocktime()
            }

            return new BN(0)
        })

        const lockDateText = computed((): string => {
            if (lockTime.value.eq(new BN(0))) {
                return '-'
            }
            let date = new Date(lockTime.value.toNumber() * 1000)

            return date.toLocaleString()
        })

        const isLocked = computed((): boolean => {
            let now = UnixNow()

            if (now.lt(lockTime.value)) {
                return true
            }

            return false
        })

        const onSelect = () => {
            if (isSelect.value) {
                emit('add')
            } else {
                emit('remove')
            }
        }

        return {
            isSelect,
            out,
            amount,
            lockTime,
            lockDateText,
            isLocked,
            onSelect
        }
    }
})
</script>
<style scoped lang="scss">
tr {
    border-bottom: 1px solid var(--bg);
}
td {
    font-size: 14px;
    padding: 2px 0;
}
.date_col {
    color: var(--primary-color-light);
}

.amt_col {
    text-align: right;
    padding-right: 18px;
}

tr[locked] {
    .date_col {
        color: var(--primary-color);
    }
}

.amt_col,
.date_col {
    font-family: monospace;
}
</style>
