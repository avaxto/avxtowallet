<template>
    <div class="swap_form">
        <div>
            <label>{{ $t('cross_chain.form.source') }}</label>
            <select @input="onChangeSource" class="hover_border" v-model="sourceChain">
                <option
                    v-for="option in sourceOptions"
                    :value="option"
                    :key="option"
                    :disabled="isConfirm"
                >
                    {{ chainNames[option] }}
                </option>
            </select>
        </div>
        <div>
            <label>{{ $t('cross_chain.form.destination') }}</label>
            <p class="ledger_warn" v-if="!isEVMSupported">
                C Chain is currently not supported on Ledger devices.
            </p>
            <select @input="onChangeDestination" class="hover_border" v-model="targetChain">
                <option
                    v-for="option in destinationOptions"
                    :value="option"
                    :key="option"
                    :disabled="isConfirm"
                >
                    {{ chainNames[option] }}
                </option>
            </select>
        </div>

        <div v-if="!isConfirm">
            <label>{{ $t('earn.transfer.amount') }}</label>

            <AvaxInput
                :max="maxAmt"
                v-model="amt"
                @change="onAmtChange"
                :balance="balance"
            ></AvaxInput>
        </div>
        <div class="confirmation_val" v-else>
            <label>{{ $t('earn.transfer.amount') }}</label>
            <p>{{ formAmtText }} AVAX</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useMainStore } from '@/stores'
import AvaxInput from '@/components/misc/AvaxInput.vue'
import { BN } from '@/avalanche'
import Big from 'big.js'
import { bnToBig } from '@/helpers/helper'
import { ChainIdType } from '@/constants'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { ChainSwapFormData } from '@/components/wallet/earn/ChainTransfer/types'

const chainTypes: ChainIdType[] = ['X', 'P', 'C']
const chainNames = {
    X: 'X Chain',
    C: 'C Chain',
    P: 'P Chain',
}

export default defineComponent({
    name: 'Form',
    components: {
        AvaxInput,
    },
    props: {
        balance: {
            type: Big,
            required: true
        },
        maxAmt: {
            type: BN,
            required: true
        },
        isConfirm: {
            type: Boolean,
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const sourceChain = ref<ChainIdType>('X')
        const targetChain = ref<ChainIdType>('P')
        const amt = ref(new BN(0))

        const clear = () => {
            amt.value = new BN(0)
            onChange()
        }

        const formAmtText = computed(() => {
            return bnToBig(amt.value, 9).toLocaleString()
        })

        const wallet = computed(() => {
            const currentWallet: MnemonicWallet = mainStore.activeWallet
            return currentWallet
        })

        const isEVMSupported = computed(() => {
            return wallet.value.ethAddress
        })

        const sourceOptions = computed((): ChainIdType[] => {
            if (!isEVMSupported.value) {
                return ['X', 'P']
            }

            const all = [...chainTypes]
            return all
        })

        const destinationOptions = computed((): ChainIdType[] => {
            return {
                X: ['P', 'C'],
                P: ['X', 'C'],
                C: ['X', 'P'],
            }[sourceChain.value] as ChainIdType[]
        })

        const onChangeSource = (ev: any) => {
            const val: ChainIdType = ev.target.value
            sourceChain.value = val
            onChange()
        }

        const onChangeDestination = (ev: any) => {
            const val: ChainIdType = ev.target.value
            targetChain.value = val
            onChange()
        }

        const onAmtChange = () => {
            onChange()
        }

        const onChange = () => {
            const data: ChainSwapFormData = {
                sourceChain: sourceChain.value,
                destinationChain: targetChain.value,
                amount: amt.value,
            }
            emit('change', data)
        }

        // Watch destinationOptions for changes
        watch(destinationOptions, () => {
            targetChain.value = destinationOptions.value[0]
            onChange()
        })

        onMounted(() => {
            onChange()
        })

        return {
            sourceChain,
            targetChain,
            amt,
            clear,
            chainNames,
            formAmtText,
            sourceOptions,
            destinationOptions,
            isEVMSupported,
            onChangeSource,
            onChangeDestination,
            onAmtChange
        }
    }
})
</script>
<style scoped lang="scss">
.swap_form {
    > div {
        flex-direction: column;
        display: flex;
        margin: 13px 0;
    }

    padding-bottom: 14px;
}
label {
    color: var(--primary-color);
    font-size: 15px;
    font-weight: bold;
    font-family: Roboto, sans-serif;
    margin-bottom: 4px !important;
}

select {
    width: 100%;
    color: var(--primary-color);
    background-color: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 16px 12px;
    font-size: 14px;
    outline: none;
    transition-duration: 0.1s;
    cursor: pointer;

    //&:hover {
    //    border-color: var(--primary-color-light);
    //}
    //
    //&:focus {
    //    border-color: var(--secondary-color);
    //}
}

.balance {
    font-size: 13px;
    color: var(--primary-color-light);
    span {
        float: right;
    }
    margin-top: 4px !important;
}

.confirmation_val {
    p {
        padding: 6px 12px;
        text-align: right;
        background-color: var(--bg-light);
    }
}

.ledger_warn {
    color: var(--info);
    font-size: 13px;
    margin-bottom: 4px !important;
}
</style>
