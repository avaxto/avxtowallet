<template>
    <input 
        type="number" 
        inputmode="decimal" 
        :placeholder="placeholder" 
        v-model="val" 
        :min="min" 
        :max="maxNumString" 
        :step="stepNum" 
        @change="onChange"
    >
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { bnToBig, stringToBN, bigToBN, BN, Big } from '@/avalanche-wallet-sdk'

const BigNumInput = defineComponent({
    name: 'BigNumInput',
    props: {
        denomination: {
            type: Number,
            default: 0
        },
        max: {
            default: null,
            type: [BN, Object] as any,
        },
        min: {
            type: Number,
            default: 0,
        },
        step: {
            type: [BN, Object] as any,
            default: null,
        },
        placeholder: {
            type: String,
            default: ''
        },
        modelValue: {
            type: [BN, Object] as any,
            default: () => new BN(0)
        }
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        // Val is a string
        const val = ref<string | null>(null)

        const maxNumBN = computed(() => props.max)

        const maxNumString = computed(() => {
            return bnToString(maxNumBN.value)
        })

        const stepNum = computed(() => {
            if (!props.step) {
                if (props.denomination >= 2) {
                    return 0.01
                } else {
                    return Math.pow(10, -props.denomination)
                }
            }
            try {
                return bnToString(props.step)
            } catch (e) {
                console.error(e)
                return '0.01'
            }
        })

        const bnToString = (bnVal: BN) => {
            if (!bnVal) return '0'
            return bnToBig(bnVal, props.denomination).toString()
        }

        const stringToBn = (strVal: string) => {
            return stringToBN(strVal, props.denomination)
        }

        const maxout = () => {
            if (maxNumBN.value != null) {
                val.value = bnToString(maxNumBN.value)
            }
        }

        const clear = () => {
            val.value = null
        }

        const onChange = () => {
            // If number is above max amount, correct it
            const valBig = Big(val.value || '0')
            const valBN = bigToBN(valBig, props.denomination)
            
            if (maxNumBN.value != null) {
                if (valBN.gt(maxNumBN.value)) {
                    val.value = bnToString(maxNumBN.value)
                }
            }
        }

        // Watch val changes and emit
        watch(val, (newVal) => {
            if (!newVal) {
                emit('update:modelValue', new BN(0))
                return
            }

            try {
                let splitVal = newVal.toString().split('.')
                let wholeVal = splitVal[0]
                let denomVal = splitVal[1]
                
                if (denomVal) {
                    if (denomVal.length > props.denomination) {
                        let newDenom = denomVal.substring(0, props.denomination)
                        val.value = `${wholeVal}.${newDenom}`
                        return
                    }
                }
            } catch (e) {
                console.log(e)
            }

            if (parseFloat(newVal) < props.min) {
                val.value = props.min.toString()
                return
            }

            let valBn = stringToBn(newVal)
            emit('update:modelValue', valBn)
        })

        // Watch modelValue prop changes
        watch(() => props.modelValue, (valBn) => {
            val.value = bnToString(valBn)
        })

        return {
            val,
            maxNumString,
            stepNum,
            onChange,
            maxout,
            clear
        }
    }
})

export { BigNumInput }
export default BigNumInput
</script>
<style scoped>
    input{
        text-align: right;
        outline: none;
    }
    /* Chrome, Safari, Edge, Opera */
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
    }

    /* Firefox */
    input[type=number] {
        -moz-appearance: textfield;
        appearance: textfield;
    }
</style>
