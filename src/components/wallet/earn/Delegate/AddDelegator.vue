<template>
    <div class="add_delegator">
        <NodeSelection v-if="!selected" @select="onselect" class="node_selection"></NodeSelection>
        <div class="cols" v-else>
            <div class="node_col">
                <button @click="selected = null" class="close_but button_secondary">
                    <fa icon="sync"></fa>
                    Change Node
                </button>
                <NodeCard :node="selected"></NodeCard>
            </div>
            <transition-group name="fade" mode="out-in" tag="div">
                <div class="ins_col" key="form">
                    <div style="margin-bottom: 30px">
                        <h4>{{ $t('earn.delegate.form.period.label') }}</h4>
                        <p class="desc">
                            {{ $t('earn.delegate.form.period.desc') }}
                        </p>
                        <DateForm @change_end="setEnd" :max-end-date="endMaxDate"></DateForm>
                    </div>
                    <div style="margin: 30px 0; margin-bottom: 50px">
                        <h4>{{ $t('earn.delegate.form.amount.label') }}</h4>
                        <p class="desc">
                            {{ $t('earn.delegate.form.amount.desc') }}
                        </p>
                        <p v-if="showMaxTxSizeWarning" class="desc amount_warning">
                            The maximum amount that fits into this transaction is
                            <b>{{ maxTxSizeString }} AVAX</b>
                        </p>
                        <AvaxInput
                            v-model="stakeAmt"
                            :max="maxFormAmount"
                            class="amt_in"
                            :balance="utxosBalanceBig"
                        ></AvaxInput>
                    </div>
                    <div class="reward_in" style="margin: 30px 0" :type="rewardDestination">
                        <h4>{{ $t('earn.delegate.form.reward.label') }}</h4>
                        <p class="desc">
                            {{ $t('earn.delegate.form.reward.desc') }}
                        </p>
                        <div class="reward_tabs">
                            <button
                                @click="rewardSelect('local')"
                                :selected="rewardDestination === 'local'"
                            >
                                {{ $t('earn.delegate.form.reward.chip_1') }}
                            </button>
                            <span>or</span>
                            <button
                                @click="rewardSelect('custom')"
                                :selected="rewardDestination === 'custom'"
                            >
                                {{ $t('earn.delegate.form.reward.chip_2') }}
                            </button>
                        </div>
                        <QrInput
                            v-model="rewardIn"
                            placeholder="Reward Address"
                            class="reward_addr_in"
                        ></QrInput>
                    </div>
                    <Expandable>
                        <template v-slot:triggerOn>
                            <p>
                                {{ $t('earn.shared.advanced.toggle_on') }}
                            </p>
                        </template>
                        <template v-slot:triggerOff>
                            <p>
                                {{ $t('earn.shared.advanced.toggle_off') }}
                            </p>
                        </template>
                        <template v-slot:content>
                            <UtxoSelectForm
                                style="margin: 10px 0"
                                v-model="formUtxos"
                            ></UtxoSelectForm>
                        </template>
                    </Expandable>
                </div>
                <ConfirmPage
                    v-show="isConfirm"
                    key="confirm"
                    :end="formEnd"
                    :amount="formAmt"
                    :reward-destination="rewardDestination"
                    :reward-address="formRewardAddr"
                    :node-i-d="formNodeID"
                ></ConfirmPage>
            </transition-group>
            <div>
                <div v-if="!isSuccess" class="summary">
                    <CurrencySelect
                        v-model="currency_type"
                        currency="currency_sel"
                    ></CurrencySelect>
                    <div>
                        <label>{{ $t('earn.delegate.summary.duration') }} *</label>
                        <p>{{ stakingDurationText }}</p>
                    </div>
                    <div>
                        <label>{{ $t('earn.delegate.summary.reward') }}</label>
                        <p v-if="currency_type === 'AVAX'">
                            {{ estimatedReward.toLocaleString(2) }} AVAX
                        </p>
                        <p v-if="currency_type === 'USD'">
                            ${{ estimatedRewardUSD.toLocaleString(2) }} USD
                        </p>
                    </div>
                    <div>
                        <label>{{ $t('earn.delegate.summary.fee') }}</label>
                        <p v-if="currency_type === 'AVAX'">
                            {{ totalFeeBig.toLocaleString(2) }} AVAX
                        </p>
                        <p v-if="currency_type === 'USD'">
                            ${{ totalFeeUsdBig.toLocaleString(2) }} USD
                        </p>
                    </div>

                    <div>
                        <label style="margin: 8px 0 !important">
                            * {{ $t('earn.delegate.summary.warn') }}
                        </label>
                        <p class="err">{{ err }}</p>
                        <v-btn
                            v-if="!isConfirm"
                            @click="confirm"
                            class="button_secondary"
                            depressed
                            :loading="isLoading"
                            :disabled="!canSubmit"
                            block
                        >
                            {{ $t('earn.delegate.confirm') }}
                        </v-btn>
                        <template v-else>
                            <v-btn
                                @click="submit"
                                class="button_secondary"
                                depressed
                                :loading="isLoading"
                                block
                            >
                                {{ $t('earn.delegate.submit') }}
                            </v-btn>
                            <v-btn
                                text
                                @click="cancelConfirm"
                                block
                                style="color: var(--primary-color); margin-top: 20px"
                            >
                                {{ $t('earn.delegate.cancel') }}
                            </v-btn>
                        </template>
                    </div>
                </div>
                <div v-else class="success_cont">
                    <h2>{{ $t('earn.delegate.success.title') }}</h2>
                    <p>{{ $t('earn.delegate.success.desc') }}</p>
                    <p class="tx_id">Tx ID: {{ txId }}</p>
                    <div class="tx_status">
                        <div>
                            <label>{{ $t('earn.delegate.success.status') }}</label>
                            <p v-if="!txStatus">Waiting..</p>
                            <p v-else>{{ txStatus }}</p>
                        </div>
                        <div class="status_icon">
                            <Spinner v-if="!txStatus"></Spinner>
                            <p style="color: var(--success)" v-if="txStatus === 'Committed'">
                                <fa icon="check-circle"></fa>
                            </p>
                            <p style="color: var(--error)" v-if="txStatus === 'Dropped'">
                                <fa icon="times-circle"></fa>
                            </p>
                        </div>
                    </div>
                    <div class="reason_cont" v-if="txReason">
                        <label>{{ $t('earn.delegate.success.reason') }}</label>
                        <p>{{ txReason }}</p>
                    </div>
                    <v-btn @click="cancel" block class="button_secondary" depressed v-if="txStatus">
                        Back to Earn
                    </v-btn>
                </div>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import AvaxInput from '@/components/misc/AvaxInput.vue'
//@ts-ignore
import VueComponents from '@avalabs/vue_components'
//@ts-ignore
const { QrInput } = VueComponents
import ValidatorsList from '@/components/misc/ValidatorList/ValidatorsList.vue'
import { ValidatorRaw } from '@/components/misc/ValidatorList/types'
import StakingCalculator from '@/components/wallet/earn/StakingCalculator.vue'
import ConfirmPage from '@/components/wallet/earn/Delegate/ConfirmPage.vue'
import Big from 'big.js'
import moment from 'moment'

import { BN } from '@/avalanche'
import { AmountOutput, PlatformVMConstants, UTXO, UTXOSet } from '@/avalanche/apis/platformvm'
import { ava, avm, bintools, infoApi, pChain } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { bnToBig, calculateStakingReward } from '@/helpers/helper'
import { Defaults, ONEAVAX } from '@/avalanche/utils'
import { ValidatorListItem } from '@/store/modules/platform/types'
import NodeSelection from '@/components/wallet/earn/Delegate/NodeSelection.vue'
import CurrencySelect from '@/components/misc/CurrencySelect/CurrencySelect.vue'
import Spinner from '@/components/misc/Spinner.vue'
import DateForm from '@/components/wallet/earn/DateForm.vue'
import { WalletType } from '@/js/wallets/types'

import UtxoSelectForm from '@/components/wallet/earn/UtxoSelectForm.vue'
import Expandable from '@/components/misc/Expandable.vue'
import NodeCard from '@/components/wallet/earn/Delegate/NodeCard.vue'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { selectMaxUtxoForStaking } from '@/helpers/utxoSelection/selectMaxUtxoForStaking'
import Tooltip from '@/components/misc/Tooltip.vue'
import { bnToAvaxP } from '@/avalanche-wallet-sdk'

const MIN_MS = 60000
const HOUR_MS = MIN_MS * 60
const DAY_MS = HOUR_MS * 24

export default defineComponent({
    name: 'AddDelegator',
    components: {
        Tooltip,
        NodeCard,
        UtxoSelectForm,
        DateForm,
        Spinner,
        CurrencySelect,
        NodeSelection,
        AvaxInput,
        ValidatorsList,
        StakingCalculator,
        QrInput,
        ConfirmPage,
        Expandable,
    },
    setup(_, { emit }) {
        const store = useStore()
        const { t } = useI18n()

        const search = ref('')
        const selected = ref<ValidatorListItem | null>(null)
        const stakeAmt = ref(new BN(0))
        const startDate = ref(new Date(Date.now() + MIN_MS * 15).toISOString())
        const endDate = ref(new Date().toISOString())
        const rewardIn = ref('')
        const rewardDestination = ref('local')
        const err = ref('')
        const isLoading = ref(false)
        const isConfirm = ref(false)
        const isSuccess = ref(false)
        const txId = ref('')
        const txStatus = ref('')
        const txReason = ref<null | string>(null)

        const formNodeID = ref('')
        const formUtxos = ref<UTXO[]>([])
        const formAmt = ref(new BN(0))
        const formEnd = ref(new Date())
        const formRewardAddr = ref('')

        const currency_type = ref('AVAX')
        const maxTxSizeAmount = ref<BN | null>(null)

        const wallet = computed(() => {
            return store.state.activeWallet as WalletType
        })

        const setEnd = (val: string) => {
            endDate.value = val
        }

        const setStart = (val: string) => {
            startDate.value = val
        }

        const onselect = (val: ValidatorListItem) => {
            search.value = ''
            selected.value = val
        }

        const submit = async () => {
            if (!formCheck()) {
                return
            }
            isLoading.value = true
            err.value = ''

            let wallet: WalletType = store.state.activeWallet

            // Start delegation in 5 minutes
            let startDate = new Date(Date.now() + 5 * MIN_MS)

            try {
                isLoading.value = false
                let delegationTxId = await wallet.delegate(
                    formNodeID.value,
                    formAmt.value,
                    startDate,
                    formEnd.value,
                    formRewardAddr.value,
                    formUtxos.value
                )
                isSuccess.value = true
                txId.value = delegationTxId
                updateTxStatus(delegationTxId)
            } catch (e) {
                onerror(e)
                isLoading.value = false
            }
        }

        const onsuccess = (txId: string) => {
            store.dispatch('Notifications/add', {
                type: 'success',
                title: 'Delegator Added',
                message: 'Your tokens are now locked for staking.',
            })

            // Update History
            setTimeout(() => {
                store.dispatch('Assets/updateUTXOs')
                store.dispatch('History/updateTransactionHistory')
            }, 3000)
        }

        const updateTxStatus = async (txId: string) => {
            let res = await pChain.getTxStatus(txId)
            let status
            let reason = null
            if (typeof res === 'string') {
                status = res
            } else {
                status = res.status
                reason = res.reason
            }

            if (!status || status === 'Processing' || status === 'Unknown') {
                setTimeout(() => {
                    updateTxStatus(txId)
                }, 5000)
            } else {
                txStatus.value = status
                txReason.value = reason

                if (status === 'Committed') {
                    onsuccess(txId)
                }
            }
        }

        const onerror = (e: any) => {
            console.error(e)
            let msg: string = e.message

            if (msg.includes('startTime')) {
                err.value = t('earn.delegate.errs.start_end') as string
            } else if (msg.includes('address format')) {
                err.value = t('earn.delegate.errs.invalid_addr') as string
            } else {
                err.value = e.message
            }
            store.dispatch('Notifications/add', {
                type: 'error',
                title: 'Delegation Failed',
                message: 'Failed to delegate tokens.',
            })
        }

        const estimatedReward = computed((): Big => {
            let start = new Date(startDate.value)
            let end = new Date(endDate.value)
            let duration = end.getTime() - start.getTime() // in ms

            let currentSupply = store.state.Platform.currentSupply

            let estimation = calculateStakingReward(stakeAmt.value, duration / 1000, currentSupply)
            let res = Big(estimation.toString()).div(Math.pow(10, 9))
            return res
        })

        const estimatedRewardUSD = computed(() => {
            return estimatedReward.value.times(avaxPrice.value)
        })

        const avaxPrice = computed((): Big => {
            return Big(store.state.prices.usd)
        })

        const rewardAddressLocal = computed(() => {
            let wallet: MnemonicWallet = store.state.activeWallet
            return wallet.getPlatformRewardAddress()
        })

        const rewardSelect = (val: 'local' | 'custom') => {
            if (val === 'local') {
                rewardIn.value = rewardAddressLocal.value
            } else {
                rewardIn.value = ''
            }
            rewardDestination.value = val
        }

        const formCheck = (): boolean => {
            err.value = ''

            if (!selected.value) {
                err.value = t('earn.delegate.errs.no_node') as string
                return false
            }

            let startTime = new Date(startDate.value).getTime()
            let endTime = new Date(endDate.value).getTime()
            let now = Date.now()
            let diffTime = endTime - startTime

            if (startTime <= now) {
                err.value = t('earn.delegate.errs.start_now') as string
                return false
            }

            // TODO: UPDATE THIS WITH REAL VALUE
            if (diffTime < DAY_MS * 14) {
                err.value = t('earn.delegate.errs.min_dur') as string
                return false
            }

            if (diffTime > DAY_MS * 365) {
                err.value = t('earn.delegate.errs.max_dur') as string
                return false
            }

            let validatorEndtime = selected.value.endTime.getTime()

            if (endTime > validatorEndtime) {
                err.value = t('earn.delegate.errs.val_end') as string
                return false
            }

            // Reward address check
            if (rewardDestination.value != 'local' && !rewardIn.value) {
                err.value = t('earn.delegate.errs.no_addr') as string
                return false
            }

            // Validate reward address only when using custom address
            if (rewardDestination.value != 'local' && rewardIn.value) {
                try {
                    bintools.stringToAddress(rewardIn.value)
                } catch (e) {
                    err.value = t('earn.delegate.errs.invalid_addr') as string
                    return false
                }
            }

            // Stake amount check
            if (stakeAmt.value.lt(minStake.value)) {
                let big = bnToBig(minStake.value, 9)
                err.value = t('earn.delegate.errs.amt', [big.toLocaleString()]) as string
                return false
            }

            return true
        }

        const updateFormData = () => {
            formNodeID.value = selected.value!.nodeID
            formAmt.value = stakeAmt.value
            formEnd.value = new Date(endDate.value)
            formRewardAddr.value = rewardIn.value
        }

        const confirm = () => {
            if (!formCheck()) return
            updateFormData()
            isConfirm.value = true
        }

        const cancelConfirm = () => {
            isConfirm.value = false
        }

        const canSubmit = computed((): boolean => {
            if (stakeAmt.value.isZero()) {
                return false
            }
            return true
        })

        // Maximum end date is end of validator's staking duration
        const endMaxDate = computed((): string | undefined => {
            if (!selected.value) return undefined
            return selected.value.endTime.toISOString()
        })

        const stakingDuration = computed((): number => {
            let start = new Date(startDate.value)
            let end = new Date(endDate.value)
            let dur = end.getTime() - start.getTime()
            return dur
        })

        const stakingDurationText = computed((): string => {
            let dur = stakingDuration.value
            let d = moment.duration(dur, 'milliseconds')
            let days = Math.floor(d.asDays())
            return `${days} days ${d.hours()} hours ${d.minutes()} minutes`
        })

        const minStake = computed((): BN => {
            return store.state.Platform.minStakeDelegation
        })

        const delegationFee = computed((): number => {
            if (!selected.value) return 0
            return selected.value.fee
        })

        const totalFee = computed((): BN => {
            let feePct = Big(delegationFee.value).div(Big(100))
            let cut = estimatedReward.value.times(feePct)

            let txFee: BN = pChain.getTxFee()
            let cutBN = new BN(cut.times(Math.pow(10, 9)).toFixed(0))
            let totFee = txFee.add(cutBN)
            return totFee
        })

        const totalFeeBig = computed(() => {
            return bnToBig(totalFee.value, 9)
        })

        const totalFeeUsdBig = computed(() => {
            return totalFeeBig.value.times(avaxPrice.value)
        })

        const txFee = computed((): BN => {
            return pChain.getTxFee()
        })

        const txFeeBig = computed((): Big => {
            return bnToBig(txFee.value, 9)
        })

        const feeText = computed((): string => {
            let big = totalFeeBig.value
            return big.toLocaleString(0)
        })

        const minAmt = computed((): BN => {
            return minStake.value.add(txFee.value)
        })

        const remainingAmt = computed((): BN => {
            if (!selected.value) return new BN(0)
            let nodeMaxStake: BN = store.getters['Platform/validatorMaxStake'](selected.value)

            let totDel = selected.value.delegatedStake
            let valAmt = selected.value.validatorStake
            return nodeMaxStake.sub(totDel).sub(valAmt)
        })

        const remainingAmtText = computed(() => {
            let bn = remainingAmt.value
            return bnToBig(bn, 9).toLocaleString()
        })

        const utxosBalance = computed((): BN => {
            return formUtxos.value.reduce((acc, val: UTXO) => {
                let out = val.getOutput() as AmountOutput
                return acc.add(out.getAmount())
            }, new BN(0))
        })

        const utxosBalanceBig = computed((): Big => {
            return bnToBig(utxosBalance.value, 9)
        })

        watch([formUtxos, maxAmt], () => {
            // Amount of the biggest transaction that can be created with the selected UTXOs
            const set = new UTXOSet()
            set.addArray(formUtxos.value)

            const fromAddresses = wallet.value.getAllAddressesP()
            const changeAddress = wallet.value.getChangeAddressPlatform()
            const sorted = sortUTxoSetP(set, false)
            selectMaxUtxoForStaking(
                sorted,
                maxAmt.value,
                fromAddresses,
                changeAddress,
                changeAddress,
                changeAddress,
                false
            )
                .then((res) => {
                    maxTxSizeAmount.value = res.amount
                })
                .catch((e) => {
                    maxTxSizeAmount.value = null
                })
        })

        const maxTxSizeString = computed(() => {
            return maxTxSizeAmount.value ? bnToAvaxP(maxTxSizeAmount.value) : false
        })

        const maxAmt = computed((): BN => {
            let zero = new BN(0)

            let totAvailable = utxosBalance.value

            if (zero.gt(totAvailable)) return zero

            if (totAvailable.gt(remainingAmt.value)) return remainingAmt.value

            return totAvailable
        })

        const showMaxTxSizeWarning = computed(() => {
            return maxTxSizeAmount.value && maxTxSizeAmount.value.lt(maxAmt.value)
        })

        const maxFormAmount = computed(() => {
            return showMaxTxSizeWarning.value ? maxTxSizeAmount.value : maxAmt.value
        })

        // Go Back to earn
        const cancel = () => {
            emit('cancel')
        }

        return {
            startDate,
            endDate,
            stakeAmt,
            search,
            selected,
            isLoading,
            err,
            isSuccess,
            txId,
            isConfirm,
            txStatus,
            txReason,
            rewardIn,
            rewardDestination,
            formNodeID,
            formAmt,
            formEnd,
            formRewardAddr,
            formUtxos,
            maxTxSizeAmount,
            setStart,
            setEnd,
            onselect,
            wallet,
            submit,
            onsuccess,
            updateTxStatus,
            onerror,
            estimatedReward,
            estimatedRewardUSD,
            avaxPrice,
            rewardSelect,
            rewardAddressLocal,
            formCheck,
            updateFormData,
            confirm,
            cancelConfirm,
            canSubmit,
            endMaxDate,
            stakingDuration,
            stakingDurationText,
            minStake,
            delegationFee,
            totalFee,
            totalFeeBig,
            totalFeeUsdBig,
            txFee,
            txFeeBig,
            feeText,
            minAmt,
            remainingAmt,
            remainingAmtText,
            utxosBalance,
            utxosBalanceBig,
            maxTxSizeString,
            maxAmt,
            showMaxTxSizeWarning,
            maxFormAmount,
            cancel
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../../main";

.add_delegator {
    height: 100%;
    padding-bottom: 5vh;
}

.node_selection {
    height: 100%;
}

.cols {
    display: grid;
    grid-template-columns: max-content 1fr 340px;
    column-gap: 2vw;
}

.ins_col {
    margin: 0px auto;
    align-self: flex-end;
    justify-self: flex-end;
    max-width: 490px;
    padding-bottom: 8vh;
}

form {
    width: 100%;
}

h4 {
    font-weight: bold;
}

label {
    margin-top: 6px;
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 3px;
}

.close_but {
    padding: 2px 14px;
    font-size: 13px;
    border-radius: 6px;
    margin-bottom: 14px;
}

.node_col {
    max-width: 390px;
}
.selected {
    display: flex;
    flex-wrap: wrap;
    //width: max-content;
    //display: grid;
    position: relative;
    grid-template-columns: max-content max-content max-content;
    column-gap: 14px;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 4px 0;
    padding-left: 34px;
    padding-right: 14px;

    button {
        opacity: 0.4;
        &:hover {
            opacity: 1;
        }
    }
}

.amt_in {
    width: 100%;
}

.dates {
    display: flex;
    > div {
        flex-grow: 1;
        margin-right: 15px;
    }

    label > span {
        float: right;
        opacity: 0.4;
        cursor: pointer;
        &:hover {
            opacity: 1;
        }
    }
}

.reward_in {
    width: 100%;
    transition-duration: 0.2s;
    &[type='local'] {
        .reward_addr_in {
            opacity: 0.3;
            user-select: none;
            cursor: not-allowed;
            pointer-events: none;
            width: 100%;
            height: 40px;
            border-radius: 2px;
        }
    }
}

.reward_tabs {
    margin-bottom: 8px;
    font-size: 13px;
    button {
        color: var(--primary-color-light);

        &:hover {
            color: var(--primary-color);
        }

        &[selected] {
            color: var(--secondary-color);
        }
    }

    span {
        margin: 0px 12px;
    }
}

.desc {
    font-size: 13px;
    margin-bottom: 8px !important;
    color: var(--primary-color-light);
}

.amount_warning {
    color: var(--warning);
}

.summary {
    border-left: 2px solid var(--bg-light);
    padding-left: 30px;
    > div {
        margin-bottom: 14px;
        p {
            font-size: 24px;
        }
    }

    .err {
        margin: 14px 0 !important;
        font-size: 14px;
    }

    .v-btn {
        margin-top: 14px;
    }
}

.tx_status {
    display: flex;
    justify-content: space-between;

    .status_icon {
        align-items: center;
        display: flex;
        font-size: 24px;
    }
}

.tx_status,
.reason_cont {
    background-color: var(--bg-light);
    padding: 4px 12px;
    margin-bottom: 6px;
}

.success_cont {
    .check {
        font-size: 4em;
        color: var(--success);
    }

    .tx_id {
        font-size: 13px;
        color: var(--primary-color-light);
        word-break: break-all;
        margin: 14px 0 !important;
        font-weight: bold;
    }
}

@include main.medium-device {
    .summary {
        > div {
            margin-bottom: 10px;
            p {
                font-size: 18px;
            }
        }
    }

    .cols {
        grid-template-columns: 220px 2fr 240px;
    }
}

@include main.mobile-device {
    .cols {
        grid-template-columns: 1fr;
    }

    .dates {
        grid-template-columns: 1fr;
    }

    .amt_in {
        width: 100%;
    }

    .summary {
        border-left: none;
        border-top: 2px solid var(--bg-light);
        padding-left: 0;
        padding-top: 30px;
    }

    .ins_col {
        width: 100%;
        max-width: 100%;
    }

    .close_but {
        width: 100%;
        padding: 12px;
    }

    .node_col {
        margin-bottom: 24px;
    }
}
</style>
