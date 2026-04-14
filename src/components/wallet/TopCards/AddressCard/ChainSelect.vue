<template>
    <div class="chain_select">
        <button @click="setChain('C')" :active="modelValue === 'C' ? true : undefined" v-if="isEVMSupported">C</button>
        <button @click="setChain('X')" :active="modelValue === 'X' ? true : undefined" v-if="isXSupported">X</button>
        <button @click="setChain('P')" :active="modelValue === 'P' ? true : undefined" v-if="isPSupported">P</button>        
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed, toRefs } from 'vue'
import { useMainStore } from '@/stores'
import { AvalancheAccount } from '@avalanche-sdk/client/accounts'
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
        const mainStore = useMainStore()
        const { modelValue } = toRefs(props)

        const isEVMSupported = computed(() => {
            const wallet: AvalancheAccount | null = mainStore.activeWallet as AvalancheAccount | null
            if (!wallet) return false
            return !!wallet.ethAddress
        })

        const isXSupported = computed(() => {
            const wallet: AvalancheAccount | null = mainStore.activeWallet as AvalancheAccount | null
            if (!wallet) return false

            const xAddress = wallet.getCurrentAddressAvm()
            const xpAddress = wallet.getXPAddress()
            console.log('X Address: ' + xAddress)
            console.log('XP Address: ' + xpAddress)
            return !!xAddress
        })

        const isPSupported = computed(() => {
            const wallet: AvalancheAccount | null = mainStore.activeWallet as AvalancheAccount | null
            if (!wallet) return false
            const pAddress = wallet.getCurrentAddressPlatform()
            console.log('P Address: ' + pAddress)
            return !!pAddress
        })

        const setChain = (val: ChainIdType) => {
            emit('update:modelValue', val)
        }

        return {
            isEVMSupported,
            isXSupported,
            isPSupported,
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
