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

        <template v-if="!matched">
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
                    Between 48 hours and 365 days from now. The chosen validator must
                    stay active at least until this date.
                </p>
                <DateForm @change_end="setEnd" :min-duration-ms="MIN_DELEGATION_DURATION_MS"></DateForm>
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
                @click="findValidator"
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
                <p class="match_note">
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
                    reward-destination="local"
                    :reward-address="rewardAddress"
                ></ConfirmPage>

                <div v-if="err" class="error">{{ err }}</div>

                <SignOnlyToggle :disabled="isLoading"></SignOnlyToggle>

                <v-btn class="button_primary submit" depressed block :loading="isLoading" @click="submit">
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
import { defineComponent, ref, computed, onMounted } from 'vue'
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
import { pChain } from '@/AVA'
import { DAY_MS, MINUTE_MS, MIN_DELEGATION_DURATION_MS } from '@/constants'
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
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()
        const platformStore = usePlatformStore()
        const offline = useOfflineSigningStore()

        const stakeAmt = ref(new BN(0))
        const endDate = ref('')
        const minUptime = ref(90)
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
        const minStakeText = computed(() => bnToBig(minStake.value, 9).toLocaleString())

        const platformBalance = computed((): BN => assetsStore.walletPlatformBalance.available)
        const platformBalanceBig = computed(() => bnToBig(platformBalance.value, 9))

        const rewardAddress = computed(() => wallet.value.getPlatformRewardAddress())

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
            if (endTime - now < MIN_DELEGATION_DURATION_MS) {
                err.value = 'End date must be at least 48 hours from now.'
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
                    v.numDelegators >= minDelegations.value &&
                    v.endTime.getTime() >= endTime
                )
            })

            matchCount.value = candidates.length

            if (candidates.length === 0) {
                err.value =
                    'No validator currently matches these requirements. Try lowering the minimum ' +
                    'uptime or delegator count, reducing the amount, or choosing an earlier end date.'
                return
            }

            matched.value = candidates[0]
        }

        const changeFilters = () => {
            matched.value = null
            err.value = ''
        }

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

            try {
                const resultTxId = await authorizeSingle(wallet.value, 'Delegate stake', () =>
                    wallet.value.delegate(matched.value!.nodeID, stakeAmt.value, startDate, endDateObj.value)
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
                const msg = e instanceof Error ? e.message : String(e)
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
            matched.value = null
            isSuccess.value = false
            txId.value = ''
            txStatus.value = ''
            txReason.value = null
            stakeAmt.value = new BN(0)
        }

        onMounted(() => {
            platformStore.fetchValidatorListEarn()
            platformStore.updateMinStakeAmount()
            platformStore.updateCurrentSupply()
        })

        return {
            offline,
            platformStore,
            MIN_DELEGATION_DURATION_MS,
            stakeAmt,
            endDate,
            minUptime,
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
