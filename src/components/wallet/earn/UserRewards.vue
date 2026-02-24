<template>
    <div>
        <template v-if="totLength > 0">
            <div>
                <label>{{ $t('earn.rewards.total') }}</label>
                <p class="amt">{{ totalRewardBig.toLocaleString(9) }} AVAX</p>
            </div>
            <div v-if="validatorTxs.length > 0">
                <h3>{{ $t('earn.rewards.validation') }}</h3>
                <UserRewardRow
                    v-for="v in validatorTxs"
                    :key="v.txHash"
                    :tx="v"
                    class="reward_row"
                ></UserRewardRow>
            </div>

            <div v-if="delegatorTxs.length > 0">
                <h3>{{ $t('earn.rewards.delegation') }}</h3>
                <UserRewardRow
                    v-for="v in delegatorTxs"
                    :key="v.txHash"
                    :tx="v"
                    class="reward_row"
                ></UserRewardRow>
            </div>
        </template>
        <template v-else>
            <p style="text-align: center">{{ $t('earn.rewards.empty') }}</p>
        </template>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useEarnStore, useMainStore } from '@/stores'
import { AvaWalletCore } from '../../../js/wallets/types'
import UserRewardRow from '@/components/wallet/earn/UserRewardRow.vue'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'
import { BN } from '@/avalanche'
import { EarnState } from '@/types'

export default defineComponent({
    name: 'UserRewards',
    components: {
        UserRewardRow,
    },
    setup() {
        const mainStore = useMainStore()
        const earnStore = useEarnStore()
        const updateInterval = ref<ReturnType<typeof setInterval> | undefined>(undefined)

        const userAddresses = computed(() => {
            let wallet: AvaWalletCore = mainStore.activeWallet
            if (!wallet) return []

            return wallet.getAllAddressesP()
        })

        const stakingTxs = computed(() => {
            return earnStore.stakingTxs as EarnState['stakingTxs']
        })

        const validatorTxs = computed(() => {
            return stakingTxs.value.filter((tx) => tx.txType === 'AddValidatorTx')
        })

        const delegatorTxs = computed(() => {
            return stakingTxs.value.filter((tx) => tx.txType === 'AddDelegatorTx')
        })

        const totLength = computed(() => {
            return validatorTxs.value.length + delegatorTxs.value.length
        })

        const totalReward = computed(() => {
            let tot = stakingTxs.value.reduce((acc, val) => {
                return acc.add(new BN(val.estimatedReward ?? 0))
            }, new BN(0))
            return tot
        })

        const totalRewardBig = computed((): Big => {
            return bnToBig(totalReward.value, 9)
        })

        onMounted(() => {
            earnStore.refreshRewards()

            // Update every 5 minutes
            updateInterval.value = setInterval(() => {
                earnStore.refreshRewards()
            }, 5 * 60 * 1000)
        })

        onBeforeUnmount(() => {
            // Clear interval if exists
            updateInterval.value && clearInterval(updateInterval.value)
        })

        return {
            updateInterval,
            userAddresses,
            stakingTxs,
            validatorTxs,
            delegatorTxs,
            totLength,
            totalReward,
            totalRewardBig
        }
    }
})
</script>
<style scoped lang="scss">
.user_rewards {
    padding-bottom: 5vh;
}

.reward_row {
    margin-bottom: 12px;
}

h3 {
    margin-top: 0.3em;
    font-size: 2em;
    color: var(--primary-color-light);
    font-weight: lighter;
}

label {
    margin-top: 6px;
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 3px;
}

.amt {
    font-size: 2em;
}
</style>
