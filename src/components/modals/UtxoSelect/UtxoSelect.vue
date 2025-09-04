<template>
    <modal ref="modal" :title="$t('modal.utxo_select.title')" class="modal_main">
        <div class="utxo_select_modal_body">
            <p>{{ $t('modal.utxo_select.desc') }}</p>
            <div class="table_cont">
                <table>
                    <thead>
                        <tr>
                            <th></th>
                            <th></th>
                            <th class="col_date">
                                {{ $t('modal.utxo_select.col1') }}
                            </th>
                            <th class="col_amt">
                                {{ $t('modal.utxo_select.col2') }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <UtxoRow
                            v-for="utxo in allSorted"
                            :key="utxo.getUTXOID()"
                            :utxo="utxo"
                            @add="addUtxo(utxo)"
                            @remove="removeUtxo(utxo)"
                        ></UtxoRow>
                    </tbody>
                </table>
            </div>
            <div class="tot">
                <label>{{ $t('modal.utxo_select.available') }}</label>
                <p>{{ selectedBalanceText }} AVAX</p>
            </div>
            <v-btn class="button_secondary" block depressed small @click="close">
                {{ $t('modal.utxo_select.submit') }}
            </v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'

import Modal from '@/components/modals/Modal.vue'
import {
    AmountOutput,
    PlatformVMConstants,
    SECPTransferOutput,
    StakeableLockOut,
    UTXO,
    UTXOSet,
} from 'avalanche/dist/apis/platformvm'

import UtxoRow from '@/components/modals/UtxoSelect/UtxoRow.vue'
import { BN } from 'avalanche'
import { UnixNow } from 'avalanche/dist/utils'
import { bnToBig } from '@/helpers/helper'

export default defineComponent({
    name: 'UtxoSelect',
    components: {
        Modal,
        UtxoRow,
    },
    props: {
        utxos: {
            type: Array as () => UTXO[],
            required: true
        },
        all: {
            type: Array as () => UTXO[],
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const customSet = ref(new UTXOSet())

        const addUtxo = (utxo: UTXO) => {
            customSet.value.add(utxo)
            emit('change', customSet.value.getAllUTXOs())
        }

        const removeUtxo = (utxo: UTXO) => {
            customSet.value.remove(utxo)
            emit('change', customSet.value.getAllUTXOs())
        }

        const open = (): void => {
            modal.value?.open()
        }

        const close = (): void => {
            modal.value?.close()
        }

        const allSorted = computed(() => {
            return props.all.sort((a: UTXO, b: UTXO) => {
                // Sort by Lock status
                let typeA = a.getOutput().getTypeID()
                let typeB = b.getOutput().getTypeID()

                let locktimeA = a.getOutput().getLocktime()
                let locktimeB = a.getOutput().getLocktime()

                if (typeA === PlatformVMConstants.STAKEABLELOCKOUTID) {
                    let sLocktime = (a.getOutput() as StakeableLockOut).getStakeableLocktime()
                    locktimeA = BN.max(locktimeA, sLocktime)
                }

                if (typeB === PlatformVMConstants.STAKEABLELOCKOUTID) {
                    let sLocktime = (b.getOutput() as StakeableLockOut).getStakeableLocktime()
                    locktimeB = BN.max(locktimeB, sLocktime)
                }

                let now = UnixNow()

                // if (now.lt(locktimeA) && now.lt(locktimeB)) {
                if (locktimeA.gt(locktimeB)) {
                    return -1
                } else if (locktimeA.lt(locktimeB)) {
                    return 1
                }
                // }

                // Sort by amount
                let outA = a.getOutput() as StakeableLockOut | SECPTransferOutput
                let outB = b.getOutput() as StakeableLockOut | SECPTransferOutput

                let amtA = outA.getAmount()
                let amtB = outB.getAmount()

                if (amtA.gt(amtB)) {
                    return -1
                } else {
                    return 1
                }

                return 0
            })
        })

        const selectedBalance = computed(() => {
            let res = props.utxos.reduce((acc, utxo) => {
                let out = utxo.getOutput() as AmountOutput | StakeableLockOut
                return acc.add(out.getAmount())
            }, new BN(0))
            return res
        })

        const selectedBalanceText = computed(() => {
            return bnToBig(selectedBalance.value, 9).toLocaleString()
        })

        return {
            modal,
            customSet,
            addUtxo,
            removeUtxo,
            open,
            close,
            allSorted,
            selectedBalance,
            selectedBalanceText
        }
    }
})
</script>
<style scoped lang="scss">
.utxo_select_modal_body {
    width: 720px;
    max-width: 100%;
    padding: 10px 20px;
}

table {
    width: 100%;
}

.table_cont {
    height: 230px;
    max-height: 100%;
    overflow: scroll;
    position: relative;
    background-color: var(--bg-light);
}

table {
    border-collapse: collapse;
}
th {
    background-color: var(--bg);
    z-index: 1;
    padding: 2px 0;
    border-bottom: 1px solid var(--bg);
    position: sticky;
    top: 0;
    font-size: 13px;
}

.col_amt {
    text-align: right;
    padding-right: 18px;
}

.tot {
    display: flex;
    //background-color: var(--bg-light);
    padding: 8px 12px;
    margin: 14px 0;
    justify-content: space-between;
}
</style>
