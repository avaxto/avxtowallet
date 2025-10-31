<template>
    <div class="chain_select">
        <button @click="setChain('X')" :active="chain === 'X'">X</button>
        <button @click="setChain('P')" :active="chain === 'P'">P</button>
        <button @click="setChain('C')" :active="chain === 'C'" v-if="isEVMSupported">C</button>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { ChainAlias, WalletType } from '@/js/wallets/types'

export default defineComponent({
    name: 'ChainSelect',
    props: {
        chain: {
            type: String as () => ChainAlias,
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()

        const isEVMSupported = computed(() => {
            let wallet: WalletType | null = store.state.activeWallet
            if (!wallet) return false
            return wallet.ethAddress
        })

        const setChain = (val: ChainAlias) => {
            emit('change', val)
        }

        return {
            isEVMSupported,
            setChain
        }
    }
})
</script>
<style scoped lang="scss">
.chain_select {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    font-size: 13px;
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
