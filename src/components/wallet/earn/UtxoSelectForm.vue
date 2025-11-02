<template>
    <div>
        <h4>{{ $t('earn.shared.utxo_select.label') }}</h4>
        <p class="desc">
            {{ $t('earn.shared.utxo_select.desc') }}
        </p>
        <v-chip-group @change="onTypeChange" :model-value="formType" @update:model-value="formType = $event" mandatory>
            <v-chip value="all" small>{{ $t('earn.shared.utxo_select.all') }}</v-chip>
            <v-chip value="custom" small>{{ $t('earn.shared.utxo_select.custom') }}</v-chip>
        </v-chip-group>

        <div class="available">
            <div>
                <label>{{ $t('earn.shared.utxo_select.available') }}</label>
                <p>
                    <span>{{ selectedBalanceText }} AVAX</span>
                </p>
            </div>

            <button @click="openModal" v-if="formType === 'custom'" class="select_but">
                <fa icon="search"></fa>
                {{ $t('earn.shared.utxo_select.select') }}
            </button>
        </div>

        <UtxoSelectModal ref="modal" v-model="customUtxos" :all="platformUtxos"></UtxoSelectModal>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from '@/stores'
import UtxoSelectModal from '@/components/modals/UtxoSelect/UtxoSelect.vue'
import { AmountOutput, UTXO, UTXOSet } from '@/avalanche/apis/platformvm'
import { WalletType } from '@/js/wallets/types'

import { CurrencyType } from '@/components/misc/CurrencySelect/types'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import { UnixNow } from '@/avalanche/utils'

export default defineComponent({
    name: 'UtxoSelectForm',
    components: {
        UtxoSelectModal,
    },
    props: {
        utxos: {
            type: Array as () => UTXO[],
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()
        
        const customUtxos = ref<UTXO[]>([])
        const formType = ref('all')
        const modal = ref<InstanceType<typeof UtxoSelectModal>>()

        const platformUtxos = computed((): UTXO[] => {
            let wallet: WalletType | null = store.state.activeWallet
            if (!wallet) return []
            const utxos = wallet.getPlatformUTXOSet().getAllUTXOs()
            const now = UnixNow()
            return utxos.filter((utxo) => {
                // Filter out locked and multisig utxos
                const locktime = utxo.getOutput().getLocktime()
                const threshold = utxo.getOutput().getThreshold()
                if (locktime.gt(now)) return false
                if (threshold > 1) return false
                return true
            })
        })

        const selectedBalance = computed((): BN => {
            if (formType.value === 'all') {
                return platformUtxos.value.reduce((acc, val: UTXO) => {
                    let out = val.getOutput() as AmountOutput
                    return acc.add(out.getAmount())
                }, new BN(0))
            } else {
                return customUtxos.value.reduce((acc, val: UTXO) => {
                    let out = val.getOutput() as AmountOutput
                    return acc.add(out.getAmount())
                }, new BN(0))
            }
        })

        const selectedBalanceText = computed(() => {
            return bnToBig(selectedBalance.value, 9).toLocaleString()
        })

        const onTypeChange = (val: string) => {
            if (val === 'all') {
                selectAll()
            } else {
                selectCustom()
            }
        }

        const openModal = () => {
            if (modal.value) {
                modal.value.open()
            }
        }

        const selectCustom = () => {
            emit('change', customUtxos.value)
        }

        const selectAll = () => {
            emit('change', platformUtxos.value)
        }

        const clear = () => {
            selectAll()
        }

        // Watch for custom utxos changes
        watch(customUtxos, (utxos: UTXO[]) => {
            if (formType.value === 'custom') {
                emit('change', utxos)
            }
        })

        // Watch for platform utxos changes
        watch(platformUtxos, (utxos: UTXO[]) => {
            if (formType.value === 'all') {
                selectAll()
            }
        })

        onMounted(() => {
            selectAll()
        })

        return {
            customUtxos,
            formType,
            modal,
            platformUtxos,
            selectedBalance,
            selectedBalanceText,
            onTypeChange,
            openModal,
            selectCustom,
            selectAll,
            clear
        }
    }
})
</script>
<style scoped lang="scss">
.available {
    max-width: 100%;
    padding: 6px 14px;
    background-color: var(--bg-light);
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
}

label {
    margin-top: 6px;
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 3px;
}
.select_but {
    font-size: 12px;
    color: var(--secondary-color);
    opacity: 0.7;
    &:hover {
        opacity: 1;
    }
}

.desc {
    font-size: 13px;
    margin-bottom: 8px !important;
    color: var(--primary-color-light);
}
</style>
