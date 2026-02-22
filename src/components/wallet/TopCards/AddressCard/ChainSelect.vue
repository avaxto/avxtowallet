<template>
    <div class="chain_select" :class="{ 'c_only': isInjected }">
        <button v-if="!isInjected" @click="setChain('X')" :active="modelValue === 'X' ? true : undefined">X</button>
        <button v-if="!isInjected" @click="setChain('P')" :active="modelValue === 'P' ? true : undefined">P</button>
        <button @click="setChain('C')" :active="modelValue === 'C' ? true : undefined" v-if="isEVMSupported">C</button>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed, toRefs } from 'vue'
import { useStore } from '@/stores'
import { useMainStore } from '@/stores/main'
import { WalletType } from '@/js/wallets/types'
import { ChainIdType } from '@/constants'


export default defineComponent({
    name: 'ChainSelect',
    props: {
        modelValue: {
            type: String as () => ChainIdType,
            required: true
        }
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const store = useStore()
        const mainStore = useMainStore()
        const { modelValue } = toRefs(props)

        const isEVMSupported = computed(() => {
            const wallet: WalletType | null = mainStore.activeWallet as WalletType | null
            if (!wallet) return false
            return wallet.ethAddress
        })

        const isInjected = computed(() => {
            const wallet: WalletType | null = mainStore.activeWallet as WalletType | null
            if (!wallet) return false
            return wallet.type === 'injected'
        })

        const setChain = (val: ChainIdType) => {
            emit('update:modelValue', val)
        }

        return {
            isEVMSupported,
            isInjected,
            setChain,
            modelValue
        }
    }
})
</script>
<style scoped lang="scss">
.chain_select {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    font-size: 13px;

    &.c_only {
        grid-template-columns: 1fr;
    }
    color: var(--primary-color-light);
    background-color: var(--bg-wallet);
}
button {
    padding: 8px 5px;
    opacity: 0.8;
    outline: none !important;
    font-weight: bold;
    background-color: rgba(var(--bg-1), 0.5);
    &:hover {
        opacity: 1;
        color: var(--secondary-color);
    }
    &[active] {
        opacity: 1;
        background-color: var(--bg);
        color: var(--primary-color);
    }
}
</style>
