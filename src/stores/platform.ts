import { defineStore } from 'pinia'
import { ref } from 'vue'
import { BN } from '@/avalanche'
import { pChain } from '@/AVA'
import { ONEAVAX } from '@/avalanche/utils'

export const usePlatformStore = defineStore('platform', () => {
    // Mainnet defaults (2000 AVAX validator, 25 AVAX delegator)
    const minStake = ref<BN>(ONEAVAX.mul(new BN(2000)))
    const minStakeDelegation = ref<BN>(ONEAVAX.mul(new BN(25)))

    const updateMinStakeAmount = async () => {
        try {
            const res = await pChain.getMinStake()
            if (res.minValidatorStake) minStake.value = res.minValidatorStake
            if (res.minDelegatorStake) minStakeDelegation.value = res.minDelegatorStake
        } catch (e) {
            console.warn('Could not fetch min stake amounts:', e)
        }
    }

    return {
        minStake,
        minStakeDelegation,
        updateMinStakeAmount,
    }
})