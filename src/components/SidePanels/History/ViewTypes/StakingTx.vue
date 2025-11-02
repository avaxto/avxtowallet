<template>
    <div class="staking_tx">
        <div class="data_row">
            <p>{{ actionText }}</p>
            <p class="amt">{{ amtText }} AVAX</p>
        </div>
        <!--If received validator reward and validator tx-->
        <div class="data_row" v-if="isValidator && receivedValidatorReward">
            <p>
                <span class="rewarded"><fa icon="check-square"></fa></span>
                {{ $t('transactions.reward_amount') }}
            </p>
            <p class="amt">{{ formatRewardAmount(validatorRewardAmount) }} AVAX</p>
        </div>
        <!--If received validator reward and delegator tx-->
        <div class="data_row" v-if="!isValidator && receivedValidatorReward">
            <p>
                <span class="rewarded"><fa icon="check-square"></fa></span>
                {{ $t('transactions.fee_amount') }}
            </p>
            <p class="amt">{{ formatRewardAmount(validatorRewardAmount) }} AVAX</p>
        </div>
        <!--If received delegator reward and delegator tx-->
        <div class="data_row" v-if="!isValidator && receivedDelegatorReward">
            <p>
                <span class="rewarded"><fa icon="check-square"></fa></span>
                {{ $t('transactions.reward_amount') }}
            </p>
            <p class="amt">{{ formatRewardAmount(delegatorRewardAmount) }} AVAX</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import { UnixNow } from '@/avalanche/utils'
import { ValidatorRaw } from '@/components/misc/ValidatorList/types'
import { WalletType } from '@/js/wallets/types'
import { getPriceAtUnixTime } from '@/helpers/price_helper'
import Big from 'big.js'
import { PChainTransaction, PChainUtxo, RewardType } from '@avalabs/glacier-sdk'
import { filterOwnedAddresses } from './filterOwnedAddresses'

export default defineComponent({
    name: 'StakingTx',
    props: {
        transaction: {
            type: Object as () => PChainTransaction,
            required: true
        }
    },
    setup(props) {
        const store = useStore()
        
        const isValidator = computed(() => {
            return props.transaction.txType === 'AddValidatorTx'
        })

        const actionText = computed(() => {
            if (isValidator.value) {
                return 'Add Validator'
            } else {
                return 'Add Delegator'
            }
        })

        const stakeAmt = computed((): BN => {
            let tot = (props.transaction.emittedUtxos ?? []).reduce((acc, out) => {
                return out.staked ? acc.add(new BN(out.amount)) : acc
            }, new BN(0))
            return tot
        })

        const wallet = computed((): WalletType => {
            return store.state.activeWallet
        })

        const pAddrsClean = computed((): string[] => {
            let pAddrs = wallet.value.getAllAddressesP()
            return pAddrs.map((addr) => addr.split('-')[1])
        })

        const formatRewardAmount = (amount: BN) => {
            return bnToBig(amount, 9)
        }

        const amtText = computed(() => {
            let big = bnToBig(stakeAmt.value, 9)
            return big.toLocaleString()
        })

        /**
         * The validator reward UTXO of this tx
         */
        const validatorReward = computed((): PChainUtxo | undefined => {
            return (props.transaction.emittedUtxos || []).filter((utxo) => {
                return utxo.rewardType === RewardType.VALIDATOR
            })[0]
        })

        /**
         * The delegator reward UTXO of this tx
         */
        const delegatorReward = computed((): PChainUtxo | undefined => {
            return (props.transaction.emittedUtxos || []).filter((utxo) => {
                return utxo.rewardType === RewardType.DELEGATOR
            })[0]
        })

        const validatorRewardAmount = computed(() => {
            return validatorReward.value?.amount
        })

        const delegatorRewardAmount = computed(() => {
            return validatorReward.value?.amount
        })

        /**
         * Returns true if this wallet received delegator reward
         */
        const receivedDelegatorReward = computed(() => {
            if (isValidator.value || !delegatorReward.value) return false

            const addrs = filterOwnedAddresses(pAddrsClean.value, delegatorReward.value.addresses)
            return addrs.length
        })

        /**
         * Returns true if this wallet received validator reward
         */
        const receivedValidatorReward = computed(() => {
            if (isValidator.value || !validatorReward.value) return false

            const addrs = filterOwnedAddresses(pAddrsClean.value, validatorReward.value.addresses)
            return addrs.length
        })

        return {
            isValidator,
            actionText,
            stakeAmt,
            wallet,
            pAddrsClean,
            formatRewardAmount,
            amtText,
            validatorReward,
            delegatorReward,
            validatorRewardAmount,
            delegatorRewardAmount,
            receivedDelegatorReward,
            receivedValidatorReward
        }
    }
})
</script>
<style scoped lang="scss">
.data_row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    column-gap: 1em;
    color: var(--primary-color-light);
}

.bar_row {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 24px;
}
.amt {
    text-align: right;
    white-space: nowrap;
    font-size: 15px;
    color: var(--info);
}

.time_bar {
    background-color: var(--bg-wallet);
    border-radius: 8px;
    height: 4px;
    margin: 4px 0;
    width: 100%;
    overflow: hidden;
    position: relative;
    align-self: center;

    > div {
        position: absolute;
        left: 0;
        top: 0;
        height: 100%;
        background-color: rgba(var(--info-1), 0.6);
    }

    p {
        width: 100%;
        text-align: center;
        position: relative;
        z-index: 2;
        font-size: 12px;
        line-height: 14px;
        color: var(--primary-color);
    }
}
span.rewarded {
    color: var(--success);
}
.not_rewarded span {
    color: var(--error);
}
</style>
