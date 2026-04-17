<template>
    <div v-if="isEVMSupported">
        <label>{{ $t('transfer.source_chain.title') }}</label>
        <div class="chain_select">
            <button type="button" :active="modelValue === 'X'" @click="set('X')">X</button>
            <button type="button" :active="modelValue === 'C'" @click="set('C')">C</button>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useMainStore } from '@/stores'
import { ChainIdType } from '@/constants'
import { CurrencyType } from '@/components/misc/CurrencySelect/types'

interface Props {
    modelValue: CurrencyType
    disabled: boolean
}

export default defineComponent({
    name: 'ChainInput',
    props: {
        modelValue: {
            type: String as () => CurrencyType,
            required: true
        },
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['update:modelValue'],
    setup(props: Props, { emit }) {
        const mainStore = useMainStore()
        const wallet = computed(() => {
            return mainStore.activeWallet
        })

        const isEVMSupported = computed(() => {
            return wallet.value.ethAddress
        })

        const set = (val: ChainIdType) => {
            if (props.disabled) return
            emit('update:modelValue', val)
        }

        return {
            wallet,
            isEVMSupported,
            set
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';
label {
    color: var(--primary-color-light);
}
.chain_select {
    display: flex;
    width: max-content;
    > button {
        //border: 1px solid var(--primary-color);
        //margin-right: 14px;
        padding-right: 14px;
        opacity: 0.2;
        transition-duration: 0.1s;
        cursor: pointer;
        color: var(--primary-color);
        //background-color: var(--bg-light);
        display: flex;
        align-items: center;
        font-size: 28px;

        &:hover {
            opacity: 1;
        }
        &[active="true"] {
            //background-color: var(--secondary-color);
            color: var(--secondary-color);
            //border-color: var(--primary-color-light);
            opacity: 1;
        }
    }
}

@include main.mobile-device {
    .chain_select {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: 14px;
        > button {
            margin: 0;
            justify-content: center;
            text-align: center;
            background-color: var(--bg-light);
            color: var(--primary-color-light);

            &[active="true"] {
                //background-color: var(--secondary-color);
                color: var(--primary-color);
                //color: #fff;
            }
        }
    }
}
</style>
