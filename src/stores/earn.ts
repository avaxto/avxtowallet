import { defineStore } from 'pinia'
import { ref } from 'vue'
import { PChainTransaction } from '@avalabs/glacier-sdk'
import { listStakingForAddresses } from '@/js/Glacier/listStakingForAddresses'
import { useMainStore } from './main'

export const useEarnStore = defineStore('earn', () => {
    const stakingTxs = ref<PChainTransaction[]>([])

    async function refreshRewards() {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet
        if (!wallet) {
            stakingTxs.value = []
            return
        }
        const addrs = wallet.getAllAddressesP()
        stakingTxs.value = await listStakingForAddresses(addrs)
    }

    return {
        stakingTxs,
        refreshRewards,
    }
})