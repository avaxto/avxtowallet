<template>
    <div class="earn_page">
        <div class="header">
            <h1>{{ $t('earn.title') }}</h1>
            <h1 class="subtitle" v-if="pageNow">
                / {{ subtitle }}
                <span @click="cancel"><fa icon="times"></fa></span>
            </h1>
        </div>
        <transition name="fade" mode="out-in">
            <div v-if="!pageNow">
                <p>{{ $t('earn.desc') }}</p>
                <div class="options">
                    <div>
                        <h4 class="title">
                            {{ $t('earn.validate_card.title') }}
                        </h4>
                        <p style="flex-grow: 1">
                            {{ $t('earn.validate_card.desc') }}
                        </p>
                        <p v-if="!canValidate" class="no_balance">
                            {{ $t('earn.warning_1', [minStakeAmt.toLocaleString()]) }}
                        </p>
                        <v-btn
                            class="button_secondary"
                            data-cy="validate"
                            @click="addValidator"
                            depressed
                            small
                            :disabled="!canValidate"
                        >
                            {{ $t('earn.validate_card.submit') }}
                        </v-btn>
                    </div>
                    <div>
                        <h4 class="title">
                            {{ $t('earn.delegate_card.title') }}
                        </h4>
                        <p style="flex-grow: 1">
                            {{ $t('earn.delegate_card.desc') }}
                        </p>
                        <p v-if="!canDelegate" class="no_balance">
                            {{ $t('earn.warning_2', [minDelegationAmt.toLocaleString()]) }}
                        </p>
                        <v-btn
                            class="button_secondary"
                            data-cy="delegate"
                            @click="addDelegator"
                            depressed
                            small
                            :disabled="!canDelegate"
                        >
                            {{ $t('earn.delegate_card.submit') }}
                        </v-btn>
                    </div>
                    <div>
                        <h4 class="title">
                            {{ $t('earn.transfer_card.title') }}
                        </h4>
                        <p style="flex-grow: 1">
                            {{ $t('earn.transfer_card.desc') }}
                        </p>
                        <v-btn
                            class="button_secondary"
                            data-cy="swap"
                            @click="transfer"
                            depressed
                            small
                        >
                            {{ $t('earn.transfer_card.submit') }}
                        </v-btn>
                    </div>
                    <div>
                        <h4 class="title">
                            {{ $t('earn.rewards_card.title') }}
                        </h4>
                        <p style="flex-grow: 1">
                            {{ $t('earn.rewards_card.desc') }}
                        </p>
                        <v-btn
                            class="button_secondary"
                            data-cy="rewards"
                            @click="viewRewards"
                            depressed
                            small
                        >
                            {{ $t('earn.rewards_card.submit') }}
                        </v-btn>
                    </div>
                </div>
                <!--                <v-btn @click="viewRewards" depressed small>View Estimated Rewards</v-btn>-->
            </div>
            <div v-else>
                <component :is="pageNow" class="comp" @cancel="cancel"></component>
            </div>
        </transition>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onDeactivated, onUnmounted } from 'vue'
import { useStore } from 'vuex'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import AddValidator from '@/components/wallet/earn/Validate/AddValidator.vue'
import AddDelegator from '@/components/wallet/earn/Delegate/AddDelegator.vue'
import { BN } from 'avalanche/dist'
import UserRewards from '@/components/wallet/earn/UserRewards.vue'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'

export default defineComponent({
    name: 'earn',
    components: {
        UserRewards,
        AddValidator,
        AddDelegator,
    },
    setup() {
        const store = useStore()
        const router = useRouter()
        const { t } = useI18n()

        const pageNow = ref<any>(null)
        const subtitle = ref('')
        const intervalID = ref<any>(null)

        const addValidator = () => {
            pageNow.value = AddValidator
            subtitle.value = t('earn.subtitle1') as string
        }

        const addDelegator = () => {
            pageNow.value = AddDelegator
            subtitle.value = t('earn.subtitle2') as string
        }

        const transfer = () => {
            router.replace('/wallet/cross_chain')
        }

        const viewRewards = () => {
            pageNow.value = UserRewards
            subtitle.value = t('earn.subtitle4') as string
        }

        const cancel = () => {
            pageNow.value = null
            subtitle.value = ''
        }

        const platformUnlocked = computed((): BN => {
            return store.getters['Assets/walletPlatformBalance'].available
        })

        const platformLockedStakeable = computed((): BN => {
            return store.getters['Assets/walletPlatformBalanceLockedStakeable']
        })

        const totBal = computed((): BN => {
            return platformUnlocked.value.add(platformLockedStakeable.value)
        })

        const pNoBalance = computed(() => {
            return platformUnlocked.value.add(platformLockedStakeable.value).isZero()
        })

        const canDelegate = computed((): boolean => {
            let bn = store.state.Platform.minStakeDelegation
            if (totBal.value.lt(bn)) {
                return false
            }
            return true
        })

        const canValidate = computed((): boolean => {
            let bn = store.state.Platform.minStake
            if (totBal.value.lt(bn)) {
                return false
            }
            return true
        })

        const minStakeAmt = computed((): Big => {
            let bn = store.state.Platform.minStake
            return bnToBig(bn, 9)
        })

        const minDelegationAmt = computed((): Big => {
            let bn = store.state.Platform.minStakeDelegation
            return bnToBig(bn, 9)
        })

        onDeactivated(() => {
            cancel()
        })

        onUnmounted(() => {
            clearInterval(intervalID.value)
        })

        return {
            pageNow,
            subtitle,
            intervalID,
            addValidator,
            addDelegator,
            transfer,
            viewRewards,
            cancel,
            platformUnlocked,
            platformLockedStakeable,
            totBal,
            pNoBalance,
            canDelegate,
            canValidate,
            minStakeAmt,
            minDelegationAmt,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.earn_page {
    display: grid;
    grid-template-rows: max-content 1fr;
}
.header {
    h1 {
        font-weight: normal;
    }
    display: flex;
    /*justify-content: space-between;*/
    /*align-items: center;*/
    align-items: center;

    .subtitle {
        margin-left: 0.5em;
        /*font-size: 20px;*/
        color: var(--primary-color-light);
        font-weight: lighter;
    }

    span {
        margin-left: 1em;

        &:hover {
            color: var(--primary-color);
            cursor: pointer;
        }
    }
}
.options {
    margin: 30px 0;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    grid-gap: 14px;
    //display: flex;
    //justify-content: space-evenly;
    //padding: 60px;

    > div {
        width: 100%;
        justify-self: center;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        //max-width: 260px;
        padding: 30px;
        border-radius: 4px;
        background-color: var(--bg-light);
    }

    h4 {
        font-size: 32px !important;
        font-weight: lighter;
        color: var(--primary-color-light);
    }

    p {
        /*color: var(--primary-color-light);*/
        margin: 14px 0 !important;
    }

    .no_balance {
        color: var(--secondary-color);
    }

    .v-btn {
        margin-top: 14px;
    }
}

span {
    color: var(--primary-color-light);
    opacity: 0.5;
    float: right;
    font-weight: lighter;
}

.cancel {
    font-size: 13px;
    color: var(--secondary-color);
    justify-self: flex-end;
}

.comp {
    margin-top: 14px;
}

@include main.medium-device {
    .options {
        grid-template-columns: 1fr 1fr;
    }
}

@include main.mobile-device {
    .options {
        grid-template-columns: none;
        grid-row-gap: 15px;
    }
}
</style>
