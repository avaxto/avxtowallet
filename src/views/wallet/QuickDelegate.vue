<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="quick_delegate_page">
        <div class="head">
            <h1>Quick Delegate</h1>
            <p class="desc">
                Set your requirements and AVXTO Wallet will automatically find an
                Avalanche validator that matches all of them, so you don't have to
                browse the validator list yourself.
            </p>
        </div>

        <div v-if="restake && !matched" class="restake_loading">
            <Spinner class="restake_spinner"></Spinner>
            Loading the validator for your restake…
        </div>

        <template v-else-if="!matched">
            <div class="field amount_field">
                <h4>Amount to delegate</h4>
                <p class="hint">Minimum {{ minStakeText }} AVAX.</p>
                <AvaxInput
                    :amount="stakeAmt"
                    :max="platformBalance"
                    :balance="platformBalanceBig"
                    class="amt_in"
                    @change="stakeAmt = $event"
                ></AvaxInput>
            </div>

            <div class="field">
                <h4>Delegation end date</h4>
                <p class="hint">
                    Between {{ minDelegationLabel }} and 365 days from now. The chosen validator must
                    stay active at least until this date.
                </p>
                <DateForm
                    @change_end="setEnd"
                    :min-duration-ms="minDelegationDuration"
                    :initial-end="endDate || undefined"
                ></DateForm>
            </div>

            <div class="field">
                <h4>Minimum uptime</h4>
                <p class="hint">Only consider validators with at least this much observed uptime.</p>
                <div class="hover_border num_in">
                    <input type="number" v-model.number="minUptime" min="0" max="100" step="0.1" />
                    <span class="suffix">%</span>
                </div>
            </div>

            <div class="field">
                <h4>Maximum fee</h4>
                <p class="hint">Only consider validators charging no more than this delegation fee.</p>
                <div class="hover_border num_in">
                    <input type="number" v-model.number="maxFee" min="0" max="100" step="0.1" />
                    <span class="suffix">%</span>
                </div>
            </div>

            <div class="field">
                <h4>Minimum current delegations</h4>
                <p class="hint">
                    Only consider validators already trusted by at least this many other delegators.
                </p>
                <div class="hover_border num_in">
                    <input type="number" v-model.number="minDelegations" min="0" step="1" />
                </div>
            </div>

            <div v-if="err" class="error">{{ err }}</div>

            <v-btn
                class="button_primary submit"
                depressed
                block
                :loading="platformStore.isFetchingValidators"
                :disabled="isBlocked"
                @click="gatedAction(findValidator)"
            >
                Find Validator
            </v-btn>
        </template>

        <template v-else>
            <SignedTxExport
                v-if="offline.hasRecords"
                :records="offline.records"
                @done="offline.clearRecords()"
            ></SignedTxExport>

            <template v-else-if="!isSuccess">
                <div v-if="restakePlan" class="restake_note">
                    <p class="match_note">
                        Restaking your {{ restakeFromText }} delegation: same validator, amount, period and
                        reward address. Check the details below, then press Delegate.
                    </p>
                    <ul v-if="restakePlan.notices.length" class="notices">
                        <li v-for="n in restakePlan.notices" :key="n">{{ n }}</li>
                    </ul>
                </div>
                <p v-else class="match_note">
                    {{
                        matchCount === 1
                            ? 'Found 1 matching validator.'
                            : `Found ${matchCount} matching validators — showing the one with the highest uptime.`
                    }}
                </p>

                <NodeCard :node="matched" class="node_card"></NodeCard>

                <div class="field reward_est">
                    <h4>Estimated reward</h4>
                    <p>{{ estimatedRewardText }} AVAX</p>
                </div>

                <ConfirmPage
                    :node-i-d="matched.nodeID"
                    :end="endDateObj"
                    :amount="stakeAmt"
                    :reward-destination="rewardIsOwn ? 'local' : 'custom'"
                    :reward-address="rewardAddress"
                ></ConfirmPage>

                <div v-if="restakePlan" class="field reward_est">
                    <h4>Validator fee</h4>
                    <p>{{ maxFee }}%</p>
                </div>

                <div v-if="err" class="error">{{ err }}</div>

                <SignOnlyToggle :disabled="isLoading"></SignOnlyToggle>

                <v-btn
                    class="button_primary submit"
                    depressed
                    block
                    :loading="isLoading"
                    :disabled="restakeBlocked"
                    @click="submit"
                >
                    Delegate
                </v-btn>
                <v-btn
                    text
                    block
                    :disabled="isLoading"
                    style="color: var(--primary-color); margin-top: 10px"
                    @click="changeFilters"
                >
                    Search Again
                </v-btn>
            </template>

            <div v-else class="success_cont">
                <h2>Delegation Started</h2>
                <p>Your tokens are now locked for staking with <span class="mono">{{ matched.nodeID }}</span>.</p>
                <p class="tx_id">Tx ID: {{ txId }}</p>
                <div class="tx_status">
                    <div>
                        <label>Status</label>
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
                    <label>Reason</label>
                    <p>{{ txReason }}</p>
                </div>
                <v-btn @click="startOver" block class="button_secondary" depressed v-if="txStatus">
                    Start Another
                </v-btn>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, onMounted, watch } from 'vue'
import Big from 'big.js'

import {
    useMainStore,
    useNotificationsStore,
    useAssetsStore,
    useHistoryStore,
    usePlatformStore,
    useOfflineSigningStore,
    isOfflineTxId,
} from '@/stores'
import { BN } from '@/avalanche'
import { ava, pChain } from '@/AVA'
import { DAY_MS, MINUTE_MS, durationLabel, minDelegationDurationMs } from '@/constants'
import { ValidatorListItem } from '@/types'
import { bnToBig, calculateStakingReward, errorToString } from '@/helpers/helper'
import { Wallet } from '@/js/wallets/AbstractWallet'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'

import AvaxInput from '@/components/misc/AvaxInput.vue'
import DateForm from '@/components/wallet/earn/DateForm.vue'
import NodeCard from '@/components/wallet/earn/Delegate/NodeCard.vue'
import ConfirmPage from '@/components/wallet/earn/Delegate/ConfirmPage.vue'
import Spinner from '@/components/misc/Spinner.vue'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import { planRestake, takeRestakeSelection, type PastDelegation, type RestakePlan } from '@/js/restake'

export default defineComponent({
    name: 'QuickDelegate',
    components: {
        AvaxInput,
        DateForm,
        NodeCard,
        ConfirmPage,
        Spinner,
        SignOnlyToggle,
        SignedTxExport,
    },
    setup() {
        // The AVXTO holding requirement, asked at the moment of the
        // action rather than at the door — see useBaseAssetGate. The
        // page itself stays usable either way; only this one button
        // defers to it.
        const { isBlocked, gatedAction } = useBaseAssetGate()

        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()
        const platformStore = usePlatformStore()
        const offline = useOfflineSigningStore()

        const stakeAmt = ref(new BN(0))
        const endDate = ref('')
        const minUptime = ref(90)
        const maxFee = ref(2)
        const minDelegations = ref(10)

        const matched = ref<ValidatorListItem | null>(null)
        const matchCount = ref(0)
        const err = ref('')
        const isLoading = ref(false)
        const isSuccess = ref(false)
        const txId = ref('')
        const txStatus = ref('')
        const txReason = ref<string | null>(null)

        const wallet = computed(() => mainStore.activeWallet as Wallet)

        const minStake = computed((): BN => platformStore.minStakeDelegation)
        const minDelegationDuration = computed(() => minDelegationDurationMs(ava.getNetworkID()))
        const minDelegationLabel = computed(() => durationLabel(minDelegationDuration.value))
        const minStakeText = computed(() => bnToBig(minStake.value, 9).toLocaleString())

        const platformBalance = computed((): BN => assetsStore.walletPlatformBalance.available)
        const platformBalanceBig = computed(() => bnToBig(platformBalance.value, 9))

        /**
         * Restake mode: a past delegation chosen on the Restake page (handed
         * over in memory — see js/restake.ts). The form is skipped: the
         * validator is the one from last time, and amount, period, fee and
         * reward address are filled in from it, re-planned against today's
         * balance and the validator's current state.
         */
        const restake = ref<PastDelegation | null>(takeRestakeSelection())
        const restakePlan = ref<RestakePlan | null>(null)

        const buildRestakePlan = (past: PastDelegation): RestakePlan =>
            planRestake(past, {
                now: Date.now(),
                available: platformBalance.value,
                minStake: minStake.value,
                minDurationMs: minDelegationDuration.value,
                validators: platformStore.validatorListEarn,
                fallbackRewardAddress: wallet.value.getPlatformRewardAddress(),
            })

        const rewardAddress = computed(
            () => restakePlan.value?.rewardAddress ?? wallet.value.getPlatformRewardAddress()
        )
        const rewardIsOwn = computed(() => {
            if (!restakePlan.value) return true
            const bare = (a: string) => (a.split('-')[1] || a).toLowerCase()
            const target = bare(restakePlan.value.rewardAddress)
            return wallet.value.getAllAddressesP().some((a) => bare(a) === target)
        })
        const restakeBlocked = computed(() => !!restakePlan.value?.blockers.length)
        const restakeFromText = computed(() =>
            restake.value
                ? new Date(restake.value.start).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                  })
                : ''
        )

        const endDateObj = computed(() => new Date(endDate.value))

        const setEnd = (val: string) => {
            endDate.value = val
        }

        const estimatedReward = computed((): Big => {
            if (!matched.value) return Big(0)
            const start = Date.now()
            const end = endDateObj.value.getTime()
            const duration = (end - start) / 1000 // seconds
            const estimation = calculateStakingReward(stakeAmt.value, duration, platformStore.currentSupply)
            return Big(estimation.toString()).div(Math.pow(10, 9))
        })

        const estimatedRewardText = computed(() => estimatedReward.value.toLocaleString(4))

        /**
         * Validates the form, then picks the best validator matching every
         * requirement. platformStore.validatorListEarn is already sorted by
         * highest uptime first (see stores/platform.ts), so the first entry
         * that survives the filter is automatically the highest-uptime
         * candidate — no separate sort needed here.
         */
        const findValidator = () => {
            err.value = ''
            matched.value = null

            if (stakeAmt.value.isZero()) {
                err.value = 'Enter an amount to delegate.'
                return
            }
            if (stakeAmt.value.lt(minStake.value)) {
                err.value = `Amount must be at least ${minStakeText.value} AVAX.`
                return
            }
            if (stakeAmt.value.gt(platformBalance.value)) {
                err.value = 'Amount exceeds your available P-Chain balance.'
                return
            }

            const now = Date.now()
            const endTime = new Date(endDate.value).getTime()

            if (!endDate.value || isNaN(endTime)) {
                err.value = 'Choose an end date.'
                return
            }
            if (endTime - now < minDelegationDuration.value) {
                err.value = `End date must be at least ${minDelegationLabel.value} from now.`
                return
            }
            if (endTime - now > DAY_MS * 365) {
                err.value = 'End date must be within 365 days from now.'
                return
            }
            if (minUptime.value < 0 || minUptime.value > 100) {
                err.value = 'Minimum uptime must be between 0 and 100.'
                return
            }
            if (maxFee.value < 0 || maxFee.value > 100) {
                err.value = 'Maximum fee must be between 0 and 100.'
                return
            }
            if (minDelegations.value < 0) {
                err.value = 'Minimum number of delegations cannot be negative.'
                return
            }

            const list = platformStore.validatorListEarn
            if (list.length === 0) {
                err.value = platformStore.isFetchingValidators
                    ? 'Still loading the validator list — try again in a moment.'
                    : 'No validator data available. Try again later.'
                return
            }

            const candidates = list.filter((v) => {
                return (
                    v.remainingStake.gte(stakeAmt.value) &&
                    v.uptime >= minUptime.value / 100 &&
                    v.fee <= maxFee.value &&
                    v.numDelegators >= minDelegations.value &&
                    v.endTime.getTime() >= endTime
                )
            })

            matchCount.value = candidates.length

            if (candidates.length === 0) {
                err.value =
                    'No validator currently matches these requirements. Try lowering the minimum ' +
                    'uptime or delegator count, raising the maximum fee, reducing the amount, or ' +
                    'choosing an earlier end date.'
                return
            }

            matched.value = candidates[0]
        }

        const changeFilters = () => {
            matched.value = null
            err.value = ''
            // Back to the ordinary search, keeping the prefilled amount,
            // period and fee as its starting point.
            restake.value = null
            restakePlan.value = null
        }

        let validatorsRequested = false

        /**
         * (Re)plans the restake whenever what it depends on arrives or changes:
         * the validator list and the balance both load after the page opens.
         */
        const applyRestake = () => {
            const past = restake.value
            if (!past || isSuccess.value) return
            if (!platformStore.validatorListEarn.length) {
                // Still loading, or not asked for yet (this first runs before
                // onMounted starts the fetch).
                if (platformStore.isFetchingValidators || !validatorsRequested) return
                // The fetch finished empty: fall back to the form, prefilled.
                stakeAmt.value = past.amount
                restake.value = null
                err.value = 'Could not load the validator list, so the restake cannot be prepared. Try again later.'
                return
            }
            const plan = buildRestakePlan(past)
            restakePlan.value = plan
            stakeAmt.value = plan.amount
            endDate.value = plan.end.toISOString()
            maxFee.value = plan.fee
            err.value = plan.blockers.join(' ')
            if (plan.validator) {
                matched.value = plan.validator
                matchCount.value = 1
            } else {
                // Nothing to restake with; fall back to the form, prefilled.
                matched.value = null
                restake.value = null
                restakePlan.value = null
            }
        }
        watch(
            () => [platformStore.validatorListEarn, platformStore.isFetchingValidators, platformBalance.value, minStake.value],
            applyRestake,
            { immediate: true }
        )

        const updateTxStatus = async (id: string) => {
            const res = await pChain.getTxStatus(id)
            let status
            let reason = null
            if (typeof res === 'string') {
                status = res
            } else {
                status = res.status
                reason = res.reason
            }

            if (!status || status === 'Processing' || status === 'Unknown') {
                setTimeout(() => updateTxStatus(id), 5000)
            } else {
                txStatus.value = status
                txReason.value = reason

                if (status === 'Committed') {
                    notificationsStore.add({
                        type: 'success',
                        title: 'Delegator Added',
                        message: 'Your tokens are now locked for staking.',
                    })
                    setTimeout(() => {
                        assetsStore.updateUTXOs()
                        historyStore.updateTransactionHistory()
                    }, 3000)
                }
            }
        }

        const submit = async () => {
            if (!matched.value) return
            isLoading.value = true
            err.value = ''

            // Start delegation in 5 minutes, matching the manual Delegate flow.
            const startDate = new Date(Date.now() + 5 * MINUTE_MS)

            // A restake is planned again at the moment of submitting, so the end
            // date is measured from now rather than from when the page opened.
            let plan: RestakePlan | null = null
            if (restake.value) {
                plan = buildRestakePlan(restake.value)
                restakePlan.value = plan
                if (plan.blockers.length) {
                    err.value = plan.blockers.join(' ')
                    isLoading.value = false
                    return
                }
                stakeAmt.value = plan.amount
                endDate.value = plan.end.toISOString()
            }

            try {
                const resultTxId = await authorizeSingle(wallet.value, 'Delegate stake', () =>
                    plan
                        ? wallet.value.delegate(plan.nodeID, plan.amount, startDate, plan.end, plan.rewardAddress)
                        : wallet.value.delegate(matched.value!.nodeID, stakeAmt.value, startDate, endDateObj.value)
                )
                // A captured (offline-signed) transaction has a sentinel id — there
                // is nothing on chain to poll a status for; the export panel above
                // renders instead.
                if (!isOfflineTxId(resultTxId)) {
                    isSuccess.value = true
                    txId.value = resultTxId
                    updateTxStatus(resultTxId)
                }
            } catch (e) {
                // A cancelled session-password prompt isn't a failure worth
                // surfacing — the user simply backed out.
                if (e instanceof SessionAuthCancelled) return
                // e instanceof Error isn't reliable here — provider/RPC errors
                // (e.g. from the injected wallet or a viem call) often come back
                // as plain objects, which `String(e)` renders as "[object
                // Object]". errorToString() unwraps a .message when present and
                // falls back to JSON.stringify for anything else.
                const msg = errorToString(e)
                err.value = msg
                notificationsStore.add({
                    type: 'error',
                    title: 'Delegation Failed',
                    message: msg,
                })
            } finally {
                isLoading.value = false
            }
        }

        const startOver = () => {
            restake.value = null
            restakePlan.value = null
            matched.value = null
            isSuccess.value = false
            txId.value = ''
            txStatus.value = ''
            txReason.value = null
            stakeAmt.value = new BN(0)
        }

        onMounted(() => {
            platformStore.fetchValidatorListEarn()
            validatorsRequested = true
            applyRestake()
            platformStore.updateMinStakeAmount()
            platformStore.updateCurrentSupply()
        })

        return {
            isBlocked,
            gatedAction,
            offline,
            platformStore,
            minDelegationDuration,
            minDelegationLabel,
            stakeAmt,
            endDate,
            minUptime,
            maxFee,
            minDelegations,
            matched,
            matchCount,
            err,
            isLoading,
            isSuccess,
            txId,
            txStatus,
            txReason,
            minStakeText,
            platformBalance,
            platformBalanceBig,
            rewardAddress,
            rewardIsOwn,
            restake,
            restakePlan,
            restakeBlocked,
            restakeFromText,
            endDateObj,
            estimatedRewardText,
            setEnd,
            findValidator,
            changeFilters,
            submit,
            startOver,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.quick_delegate_page {
    max-width: 560px;
    margin: 0 auto;
}

h1 {
    font-weight: normal;
}

.head {
    margin-bottom: 24px;
    text-align: center;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.field {
    margin-bottom: 20px;
}

// AvaxInput renders an extra "balance" row under the input itself (see
// AvaxInput.vue) — a bit more room here keeps that row from crowding the
// next field's heading.
.amount_field {
    margin-bottom: 28px;
}

h4 {
    font-weight: bold;
    margin-bottom: 2px;
}

label {
    display: block;
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin-bottom: 6px;
}

.hint {
    font-size: 0.8em;
    color: var(--primary-color-light);
    margin: 4px 0 10px;
}

.amt_in {
    width: 100%;
}

.hover_border {
    background-color: var(--bg-light);
    border-radius: 2px;
}

.num_in {
    display: flex;
    align-items: center;
    padding: 0 12px;

    input {
        width: 100%;
        padding: 10px 0;
        background: transparent;
        color: var(--primary-color);
        font-size: 1em;
    }

    .suffix {
        color: var(--primary-color-light);
        font-size: 0.9em;
        padding-left: 8px;
    }
}

.error {
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.85em;
    margin-bottom: 20px;
    word-break: break-word;
}

.submit {
    margin-top: 4px;
}

.match_note {
    font-size: 0.85em;
    color: var(--primary-color-light);
    margin-bottom: 12px;
}

.node_card {
    margin-bottom: 20px;
}

.restake_loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--primary-color-light);
    padding: 24px 0;

    .restake_spinner {
        width: 18px !important;
        height: 18px !important;
    }
}

.restake_note .notices {
    font-size: 0.85em;
    color: var(--primary-color-light);
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 8px 16px 8px 30px;
    margin-bottom: 12px;

    li {
        margin: 2px 0;
    }
}

.reward_est {
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 10px 16px;

    h4 {
        margin-bottom: 2px;
    }

    p {
        font-size: 18px;
    }
}

.mono {
    font-family: monospace;
    word-break: break-all;
}

.success_cont {
    text-align: center;

    .tx_id {
        font-size: 13px;
        color: var(--primary-color-light);
        word-break: break-all;
        margin: 14px 0 !important;
        font-weight: bold;
    }
}

.tx_status {
    display: flex;
    justify-content: space-between;
    text-align: left;

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
</style>
