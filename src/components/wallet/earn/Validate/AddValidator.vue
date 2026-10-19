<template>
    <div>
        <div class="cols">
            <form @submit.prevent="" autocomplete="off">
                <transition-group name="fade" mode="out-in" tag="div">
                    <div v-show="!isConfirm" key="form" class="ins_col">
                        <div style="margin-bottom: 30px">
                            <h4>{{ $t('earn.validate.label_1') }}</h4>
                            <input
                                type="text"
                                v-model="nodeId"
                                style="width: 100%"
                                placeholder="NodeID-"
                            />
                        </div>
                        <div style="margin: 30px 0">
                            <h4>{{ $t('earn.validate.duration.label') }}</h4>
                            <p class="desc">
                                {{ $t('earn.validate.duration.desc') }}
                            </p>
                            <DateForm @change_end="setEnd" :min-duration-ms="minValidationDuration"></DateForm>
                            <p class="desc duration_rules">
                                At least {{ minValidationLabel }} and at most a year, counted from when the network
                                accepts the transaction. Rewards need at least 90% uptime over the period.
                            </p>
                        </div>
                        <div style="margin: 30px 0">
                            <h4>{{ $t('earn.validate.amount.label') }}</h4>
                            <p class="desc">
                                {{ $t('earn.validate.amount.desc') }}
                            </p>
                            <p v-if="showMaxTxSizeWarning" class="desc amount_warning">
                                The maximum amount that fits into this transaction is
                                <b>{{ bnToAvaxP(maxTxSizeAmount) }} AVAX</b>
                            </p>
                            <AvaxInput
                                :amount="stakeAmt"
                                :max="maxFormAmount"
                                class="amt_in"
                                @change="stakeAmt = $event"
                            ></AvaxInput>
                        </div>
                        <div style="margin: 30px 0">
                            <h4>{{ $t('earn.validate.fee.label') }}</h4>
                            <p class="desc">
                                {{ $t('earn.validate.fee.desc') }}
                            </p>
                            <input
                                type="number"
                                :min="minFee"
                                max="100"
                                step="0.01"
                                v-model="delegationFee"
                                @change="onFeeChange"
                            />
                        </div>
                        <div style="margin: 30px 0">
                            <h4>Node BLS key (ACP-62)</h4>
                            <p class="desc">
                                Every validator registers its node's BLS public key and proof of possession. They
                                come from your node — the wallet can't make them. On the node, run:
                            </p>
                            <pre class="node_cmd">curl -s -X POST -H 'content-type:application/json' --data '{"jsonrpc":"2.0","id":1,"method":"info.getNodeID"}' 127.0.0.1:9650/ext/info</pre>
                            <div class="bls_section">
                                <label>Paste the response here to fill in the fields</label>
                                <textarea
                                    v-model="nodeInfoIn"
                                    class="node_info_in"
                                    rows="3"
                                    spellcheck="false"
                                    placeholder='{"jsonrpc":"2.0","result":{"nodeID":"NodeID-…","nodePOP":{"publicKey":"0x…","proofOfPossession":"0x…"}},"id":1}'
                                ></textarea>
                                <p v-if="nodeInfoError" class="err_msg">{{ nodeInfoError }}</p>
                                <div style="margin: 15px 0">
                                    <label>BLS public key (48 bytes)</label>
                                    <input
                                        type="text"
                                        v-model="blsPublicKey"
                                        style="width: 100%; font-family: monospace; font-size: 12px"
                                        placeholder="0x..."
                                        maxlength="98"
                                    />
                                    <p v-if="blsPublicKeyError" class="err_msg">{{ blsPublicKeyError }}</p>
                                </div>
                                <div style="margin: 15px 0">
                                    <label>Proof of possession (96 bytes)</label>
                                    <input
                                        type="text"
                                        v-model="blsSignature"
                                        style="width: 100%; font-family: monospace; font-size: 12px"
                                        placeholder="0x..."
                                        maxlength="194"
                                    />
                                    <p v-if="blsSignatureError" class="err_msg">{{ blsSignatureError }}</p>
                                </div>
                                <p v-if="popStatus === 'ok'" class="pop_ok"><fa icon="check-circle"></fa> Proof of possession verified for this key.</p>
                                <p v-else-if="popStatus === 'bad'" class="err_msg">{{ popMismatch }}</p>
                            </div>
                        </div>
                        <div class="reward_in" style="margin: 30px 0" :type="rewardDestination">
                            <h4>{{ $t('earn.validate.reward.label') }}</h4>
                            <p class="desc">
                                {{ $t('earn.validate.reward.desc') }}
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
                                style="height: 40px; border-radius: 2px"
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
                        key="confirm"
                        v-show="isConfirm"
                        :node-i-d="nodeId"
                        :end="formEnd"
                        :amount="formAmt"
                        :delegation-fee="parseFloat(delegationFee)"
                        :reward-address="rewardIn"
                        :reward-destination="rewardDestination"
                        :bls-public-key="formBlsPublicKey"
                        :bls-signature="formBlsSignature"
                    ></ConfirmPage>
                </transition-group>
                <div>
                    <SignedTxExport
                        v-if="offline.hasRecords"
                        :records="offline.records"
                        @done="offline.clearRecords()"
                    ></SignedTxExport>
                    <div class="summary" v-else-if="!isSuccess">
                        <CurrencySelect v-model="currency_type"></CurrencySelect>
                        <div>
                            <label>
                                {{ $t('earn.validate.summary.max_del') }}
                                <Tooltip
                                    style="display: inline-block"
                                    :text="$t('earn.validate.summary.max_del_tooltip')"
                                >
                                    <fa icon="question-circle"></fa>
                                </Tooltip>
                            </label>
                            <p v-if="currency_type === 'AVAX'">{{ maxDelegationText }} AVAX</p>
                            <p v-if="currency_type === 'USD'">${{ maxDelegationUsdText }} USD</p>
                        </div>
                        <div>
                            <label>{{ $t('earn.validate.summary.duration') }} *</label>
                            <p>{{ durationText }}</p>
                        </div>
                        <div>
                            <label>{{ $t('earn.validate.summary.rewards') }}</label>
                            <p v-if="currency_type === 'AVAX'">
                                {{ estimatedReward.toLocaleString(2) }} AVAX
                            </p>
                            <p v-if="currency_type === 'USD'">
                                ${{ estimatedRewardUSD.toLocaleString(2) }} USD
                            </p>
                        </div>
                        <div class="submit_box">
                            <label style="margin: 8px 0 !important">
                                * {{ $t('earn.validate.summary.warn') }}
                            </label>
                            <p v-if="warnShortDuration" class="err">
                                WARNING: You must have at least {{ minDelegationLabel }} remaining on your
                                validation period to accept delegations.
                            </p>
                            <p class="err">{{ err }}</p>
                            <SignOnlyToggle :disabled="isLoading"></SignOnlyToggle>
                            <v-btn
                                v-if="!isConfirm"
                                @click="confirm"
                                class="button_secondary"
                                depressed
                                :loading="isLoading"
                                :disabled="!canSubmit"
                                block
                            >
                                {{ $t('earn.validate.confirm') }}
                            </v-btn>
                            <template v-else>
                                <v-btn
                                    @click="submit"
                                    class="button_secondary"
                                    depressed
                                    :loading="isLoading"
                                    block
                                >
                                    {{ $t('earn.validate.submit') }}
                                </v-btn>
                                <v-btn
                                    text
                                    @click="cancelConfirm"
                                    block
                                    style="color: var(--primary-color); margin-top: 20px"
                                >
                                    {{ $t('earn.validate.cancel') }}
                                </v-btn>
                            </template>
                        </div>
                    </div>
                    <div class="success_cont" v-else>
                        <h2>{{ $t('earn.validate.success.title') }}</h2>
                        <p>{{ $t('earn.validate.success.desc') }}</p>
                        <p class="tx_id">Tx ID: {{ txId }}</p>
                        <div class="tx_status">
                            <div>
                                <label>{{ $t('earn.validate.success.status') }}</label>
                                <p v-if="!txStatus">Waiting..</p>
                                <p v-else>{{ txStatus }}</p>
                            </div>
                            <div class="status_icon">
                                <Spinner
                                    v-if="!txStatus"
                                    style="color: var(--primary-color)"
                                ></Spinner>
                                <p style="color: var(--success)" v-if="txStatus === 'Committed'">
                                    <fa icon="check-circle"></fa>
                                </p>
                                <p style="color: var(--error)" v-if="txStatus === 'Dropped'">
                                    <fa icon="times-circle"></fa>
                                </p>
                            </div>
                        </div>
                        <div class="reason_cont" v-if="txReason">
                            <label>{{ $t('earn.validate.success.reason') }}</label>
                            <p>{{ txReason }}</p>
                        </div>
                        <v-btn
                            @click="cancel"
                            block
                            class="button_secondary"
                            depressed
                            v-if="txStatus"
                        >
                            Back to Earn
                        </v-btn>
                    </div>
                </div>
            </form>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useAssetsStore, useHistoryStore, useMainStore, useNotificationsStore, usePlatformStore } from '@/stores'
import { useI18n } from 'vue-i18n'
//@ts-ignore
import AvaxInput from '@/components/misc/AvaxInput.vue'
import { BN } from '@/avalanche'
import Big from 'big.js'
import Modal from '@/components/modals/Modal.vue'
import { QrReader, QrInput } from '@/vue_components'
import { ava, bintools, pChain } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import ConfirmPage from '@/components/wallet/earn/Validate/ConfirmPage.vue'
import moment from 'moment'
import { bnToBig, calculateStakingReward, errorToString } from '@/helpers/helper'
import { ONEAVAX } from '@/avalanche/utils'
import Tooltip from '@/components/misc/Tooltip.vue'
import CurrencySelect from '@/components/misc/CurrencySelect/CurrencySelect.vue'
import Spinner from '@/components/misc/Spinner.vue'
import DateForm from '@/components/wallet/earn/DateForm.vue'
import UtxoSelectForm from '@/components/wallet/earn/UtxoSelectForm.vue'
import Expandable from '@/components/misc/Expandable.vue'
import { AmountOutput, UTXO, UTXOSet } from '@/avalanche/apis/platformvm'
import { Wallet } from '@/js/wallets/AbstractWallet'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { selectMaxUtxoForStaking } from '@/helpers/utxoSelection/selectMaxUtxoForStaking'
import { bnToAvaxP } from '@/avalanche-wallet-sdk'
import { BLS_ERRORS, parseNodeInfo, toHex0x, validateBlsPublicKey as isBlsPublicKey, validateBlsSignature as isBlsSignature, verifyProofOfPossession } from '@/helpers/bls_utils'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { useOfflineSigningStore, isOfflineTxId } from '@/stores'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'
import { durationLabel, maxStakeEnd, MAX_STAKE_DURATION_MS, minDelegationDurationMs, minStakeEnd, minValidationDurationMs } from '@/constants'

const MIN_MS = 60000


export default defineComponent({
    name: 'add_validator',
    components: {
        SignOnlyToggle,
        SignedTxExport,
        Modal,
        QrReader,
        QrInput,
        DateForm,
        AvaxInput,
        ConfirmPage,
        Tooltip,
        CurrencySelect,
        Spinner,
        UtxoSelectForm,
        Expandable,
    },
    emits: ['cancel'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const offline = useOfflineSigningStore()
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const historyStore = useHistoryStore()
        const platformStore = usePlatformStore()
        const { t } = useI18n()

        // Reactive state
        const startDate = ref(new Date(Date.now() + MIN_MS * 15).toISOString())
        const endDate = ref(new Date().toISOString())
        const delegationFee = ref('2.0')
        const nodeId = ref('')
        const rewardIn = ref('')
        const rewardDestination = ref('local') // local || custom
        const isLoading = ref(false)
        const isConfirm = ref(false)
        const err = ref('')
        const stakeAmt = ref(new BN(0))

        // BLS fields for ACP-62 compliance
        const blsPublicKey = ref('')
        const blsSignature = ref('')
        const blsPublicKeyError = ref('')
        const blsSignatureError = ref('')

        const minFee = ref(2)

        const formNodeId = ref('')
        const formAmt = ref(new BN(0))
        const formEnd = ref(new Date())
        const formFee = ref(0)
        const formRewardAddr = ref('')
        const formUtxos = ref<UTXO[]>([])
        const formBlsPublicKey = ref('')
        const formBlsSignature = ref('')

        const txId = ref('')
        const txStatus = ref<string | null>(null)
        const txReason = ref<null | string>(null)

        const isSuccess = ref(false)
        const currency_type = ref('AVAX')
        const maxTxSizeAmount = ref(new BN(0))

        // Computed properties
        const wallet = computed((): Wallet => {
            return mainStore.activeWallet
        })

        const rewardAddressLocal = computed(() => {
            const w: MnemonicWallet = mainStore.activeWallet
            return w.getPlatformRewardAddress()
        })

        const platformUnlocked = computed((): BN => {
            return assetsStore.walletPlatformBalance.available
        })

        const platformLockedStakeable = computed((): BN => {
            return assetsStore.walletPlatformBalanceLockedStakeable
        })

        const feeAmt = computed((): BN => {
            return pChain.getTxFee()
        })

        const utxosBalance = computed((): BN => {
            return formUtxos.value.reduce((acc, val: UTXO) => {
                const out = val.getOutput() as AmountOutput
                return acc.add(out.getAmount())
            }, new BN(0))
        })

        const maxAmt = computed((): BN => {
            const pAmt = utxosBalance.value

            // absolute max stake
            const mult = new BN(10).pow(new BN(6 + 9))
            const absMaxStake = new BN(3).mul(mult)

            // If above stake limit
            if (pAmt.gt(absMaxStake)) {
                return absMaxStake
            }

            const ZERO = new BN('0')
            if (pAmt.gt(ZERO)) {
                return pAmt
            } else {
                return ZERO
            }
        })

        const showMaxTxSizeWarning = computed(() => {
            return maxTxSizeAmount.value.lt(maxAmt.value)
        })

        const maxFormAmount = computed(() => {
            return showMaxTxSizeWarning.value ? maxTxSizeAmount.value : maxAmt.value
        })

        const stakeDuration = computed((): number => {
            const start = new Date(startDate.value)
            let end = new Date(endDate.value)

            if (isConfirm.value) {
                end = formEnd.value
            }

            const diff = end.getTime() - start.getTime()
            return diff
        })

        const minDelegationDuration = computed(() => minDelegationDurationMs(ava.getNetworkID()))
        const minDelegationLabel = computed(() => durationLabel(minDelegationDuration.value))

        const warnShortDuration = computed((): boolean => {
            const dur = stakeDuration.value

            // Delegators need the network's minimum delegation period (14 days
            // on mainnet — see constants.ts) left on the validator's period to
            // delegate to it; warn if less than that remains.
            if (dur <= minDelegationDuration.value) {
                return true
            }
            return false
        })

        const durationText = computed(() => {
            const d = moment.duration(stakeDuration.value, 'milliseconds')
            const days = Math.floor(d.asDays())
            return `${days} days ${d.hours()} hours ${d.minutes()} minutes`
        })

        const denomination = computed(() => {
            return 9
        })

        const maxDelegationAmt = computed((): BN => {
            const stakeAmtVal = stakeAmt.value
            const maxRelative = stakeAmtVal.mul(new BN(5))

            // absolute max stake
            const mult = new BN(10).pow(new BN(6 + 9))
            const absMaxStake = new BN(3).mul(mult)

            let res
            if (maxRelative.lt(absMaxStake)) {
                res = maxRelative.sub(stakeAmtVal)
            } else {
                res = absMaxStake.sub(stakeAmtVal)
            }

            return BN.max(res, new BN(0))
        })

        const maxDelegationText = computed(() => {
            return bnToBig(maxDelegationAmt.value, 9).toLocaleString(9)
        })

        const maxDelegationUsdText = computed(() => {
            const big = bnToBig(maxDelegationAmt.value, 9)
            const res = big.times(avaxPrice.value)
            return res.toLocaleString(2)
        })

        const avaxPrice = computed((): Big => {
            const usdPrice = mainStore.prices.usd
            if (typeof usdPrice !== 'number' || isNaN(usdPrice)) {
                return Big(0)
            }
            return Big(usdPrice)
        })

        const estimatedReward = computed((): Big => {
            const currentSupply = platformStore.currentSupply
            if (!currentSupply) return Big(0)

            const start = new Date(startDate.value)
            const end = new Date(endDate.value)
            const duration = end.getTime() - start.getTime() // in ms

            const estimation = calculateStakingReward(stakeAmt.value, duration / 1000, currentSupply)
            const res = bnToBig(estimation, 9)

            return res
        })

        const estimatedRewardUSD = computed(() => {
            return estimatedReward.value.times(avaxPrice.value)
        })

        const minStakeAmt = computed((): BN => {
            return platformStore.minStake
        })

        const canSubmit = computed(() => {
            if (!nodeId.value) {
                return false
            }

            if (stakeAmt.value.isZero()) {
                return false
            }

            if (!rewardIn.value) {
                return false
            }

            return true
        })

        // Methods
        const onFeeChange = () => {
            let num = parseFloat(delegationFee.value)
            if (num < minFee.value) {
                delegationFee.value = minFee.value.toString()
            } else if (num > 100) {
                delegationFee.value = '100'
            }
        }

        const setEnd = (val: string) => {
            endDate.value = val
        }

        const rewardSelect = (val: 'local' | 'custom') => {
            if (val === 'local') {
                rewardIn.value = rewardAddressLocal.value
            } else {
                rewardIn.value = ''
            }
            rewardDestination.value = val
        }

        // BLS key validation and generation methods
        const validateBlsPublicKey = () => {
            blsPublicKeyError.value = ''
            if (!blsPublicKey.value.trim()) {
                blsPublicKeyError.value = BLS_ERRORS.MISSING_BLS_DATA
                return false
            }
            if (!isBlsPublicKey(blsPublicKey.value)) {
                blsPublicKeyError.value = BLS_ERRORS.INVALID_PUBLIC_KEY
                return false
            }
            return true
        }

        const validateBlsSignature = () => {
            blsSignatureError.value = ''
            if (!blsSignature.value.trim()) {
                blsSignatureError.value = BLS_ERRORS.MISSING_BLS_DATA
                return false
            }
            if (!isBlsSignature(blsSignature.value)) {
                blsSignatureError.value = BLS_ERRORS.INVALID_SIGNATURE
                return false
            }
            return true
        }

        /**
         * The P-Chain's own check, run before anything is spent: the proof of
         * possession must be a valid BLS signature over this public key
         * (helpers/bls_utils.ts). '' while either field is incomplete.
         */
        const popStatus = computed((): '' | 'ok' | 'bad' => {
            if (!isBlsPublicKey(blsPublicKey.value) || !isBlsSignature(blsSignature.value)) return ''
            return verifyProofOfPossession(blsPublicKey.value, blsSignature.value) ? 'ok' : 'bad'
        })
        const popMismatch = BLS_ERRORS.POP_MISMATCH

        // A pasted info.getNodeID response fills the node ID, key and proof.
        const nodeInfoIn = ref('')
        const nodeInfoError = ref('')
        watch(nodeInfoIn, (text) => {
            nodeInfoError.value = ''
            if (!text.trim()) return
            const info = parseNodeInfo(text)
            if (!info) {
                nodeInfoError.value = 'That isn’t an info.getNodeID response (it needs nodePOP.publicKey and nodePOP.proofOfPossession).'
                return
            }
            if (info.nodeID) nodeId.value = info.nodeID
            blsPublicKey.value = info.publicKey
            blsSignature.value = info.proofOfPossession
            validateBlsPublicKey()
            validateBlsSignature()
        })

        const minValidationDuration = computed(() => minValidationDurationMs(ava.getNetworkID()))
        const minValidationLabel = computed(() => durationLabel(minValidationDuration.value))

        const updateFormData = () => {
            formNodeId.value = nodeId.value.trim()
            formAmt.value = stakeAmt.value
            formEnd.value = new Date(endDate.value)
            formRewardAddr.value = rewardIn.value
            formFee.value = parseFloat(delegationFee.value)
            formBlsPublicKey.value = toHex0x(blsPublicKey.value)
            formBlsSignature.value = toHex0x(blsSignature.value)
        }

        const formCheck = (): boolean => {
            err.value = ''

            // BLS validation for ACP-62 compliance
            if (!validateBlsPublicKey()) {
                err.value = blsPublicKeyError.value
                return false
            }

            if (!validateBlsSignature()) {
                err.value = blsSignatureError.value
                return false
            }

            if (!verifyProofOfPossession(blsPublicKey.value, blsSignature.value)) {
                err.value = BLS_ERRORS.POP_MISMATCH
                return false
            }

            // Staking period, counted from acceptance (Durango): Helicon minimum to a year.
            const endMs = new Date(endDate.value).getTime()
            if (!(endMs >= minStakeEnd(minValidationDuration.value) - 60_000)) {
                err.value = `The staking period must be at least ${minValidationLabel.value}. Pick a later end date.`
                return false
            }
            if (endMs > maxStakeEnd()) {
                err.value = 'The staking period can be at most one year. Pick an earlier end date.'
                return false
            }

            // Reward Address
            if (rewardDestination.value !== 'local') {
                const rewardAddr = rewardIn.value

                // If it doesnt start with P
                if (rewardAddr[0] !== 'P') {
                    err.value = t('earn.validate.errs.address') as string
                    return false
                }

                // not a valid address
                try {
                    bintools.stringToAddress(rewardAddr)
                } catch (e) {
                    err.value = t('earn.validate.errs.address') as string
                    return false
                }
            }

            // Not a valid Node ID
            if (!nodeId.value.includes('NodeID-')) {
                err.value = t('earn.validate.errs.id') as string
                return false
            }

            // Delegation Fee
            if (parseFloat(delegationFee.value) < minFee.value) {
                err.value = t('earn.validate.errs.fee', [minFee.value]) as string
                return false
            }

            // Stake amount
            if (stakeAmt.value.lt(minStakeAmt.value)) {
                const big = Big(minStakeAmt.value.toString()).div(Math.pow(10, 9))
                err.value = t('earn.validate.errs.amount', [big.toLocaleString()]) as string
                return false
            }

            return true
        }

        const confirm = () => {
            if (!formCheck()) return
            updateFormData()
            isConfirm.value = true
        }

        const cancelConfirm = () => {
            isConfirm.value = false
        }

        const cancel = () => {
            emit('cancel')
        }

        const onsuccess = () => {
            notificationsStore.add({
                type: 'success',
                title: 'Validator Added',
                message: 'Your tokens are now locked to stake.',
            })

            // Update History
            setTimeout(() => {
                assetsStore.updateUTXOs()
                historyStore.updateTransactionHistory()
            }, 3000)
        }

        const updateTxStatus = async (txIdVal: string) => {
            const res = await pChain.getTxStatus(txIdVal)

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
                    updateTxStatus(txIdVal)
                }, 5000)
            } else {
                txStatus.value = status
                txReason.value = reason

                if (status === 'Committed') {
                    onsuccess()
                }
            }
        }

        const onTxSubmit = (txIdVal: string) => {
            // A captured transaction has a sentinel id — nothing exists on
            // chain to poll, so the export panel renders instead of success.
            if (isOfflineTxId(txIdVal)) return
            txId.value = txIdVal
            isSuccess.value = true
            updateTxStatus(txIdVal)
        }

        const onerror = (error: any) => {
            console.error(error)
            // error.message assumes error is always an Error with a string
            // message — provider/RPC errors are often plain objects instead,
            // which made this throw (msg undefined, .includes() on it) rather
            // than show anything. errorToString() handles both, plus the
            // "[object Object]" case for whatever's left over.
            const msg = errorToString(error)

            if (msg.includes('startTime')) {
                err.value = t('earn.validate.errs.date') as string
            } else if (msg.includes('must be at least')) {
                const minAmt = minStakeAmt.value
                const big = Big(minAmt.toString()).div(Math.pow(10, 9))
                err.value = t('earn.validate.errs.amount', [big.toLocaleString()]) as string
            } else if (msg.includes('nodeID')) {
                err.value = t('earn.validate.errs.id') as string
            } else if (msg.includes('address format')) {
                err.value = t('earn.validate.errs.address') as string
            } else {
                err.value = msg
            }

            notificationsStore.add({
                type: 'error',
                title: 'Validation Failed',
                message: 'Failed to add validator.',
            })
        }

        const submit = async () => {
            if (!formCheck()) return
            const w: Wallet = mainStore.activeWallet

            // Start delegation in 5 minutes
            let startDateVal = new Date(Date.now() + 5 * MIN_MS)
            const endMs = formEnd.value.getTime()
            const startMs = startDateVal.getTime()

            // If End date - start date is greater than max stake duration, adjust start date
            if (endMs - startMs > MAX_STAKE_DURATION_MS) {
                startDateVal = new Date(endMs - MAX_STAKE_DURATION_MS)
            }

            try {
                isLoading.value = true
                err.value = ''
                const txIdVal = await authorizeSingle(w, 'Add a validator', () =>
                    w.validate(
                        formNodeId.value,
                        formAmt.value,
                        startDateVal,
                        formEnd.value,
                        formFee.value,
                        formRewardAddr.value,
                        formUtxos.value,
                        formBlsPublicKey.value,
                        formBlsSignature.value
                    )
                )
                isLoading.value = false
                onTxSubmit(txIdVal)
            } catch (error) {
                isLoading.value = false
                onerror(error)
            }
        }

        // Watchers
        const onFormUtxosChange = () => {
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
                true
            ).then((res) => {
                maxTxSizeAmount.value = res.amount
            })
        }

        watch([formUtxos, maxAmt], onFormUtxosChange)

        // Lifecycle
        onMounted(() => {
            rewardSelect('local')
        })

        return {

            offline,
            // State
            startDate,
            endDate,
            delegationFee,
            nodeId,
            rewardIn,
            rewardDestination,
            isLoading,
            isConfirm,
            err,
            stakeAmt,
            blsPublicKey,
            blsSignature,
            blsPublicKeyError,
            blsSignatureError,
            minFee,
            formNodeId,
            formAmt,
            formEnd,
            formFee,
            formRewardAddr,
            formUtxos,
            formBlsPublicKey,
            formBlsSignature,
            txId,
            txStatus,
            txReason,
            isSuccess,
            currency_type,
            maxTxSizeAmount,
            // Computed
            wallet,
            rewardAddressLocal,
            platformUnlocked,
            platformLockedStakeable,
            feeAmt,
            utxosBalance,
            maxAmt,
            showMaxTxSizeWarning,
            maxFormAmount,
            stakeDuration,
            warnShortDuration,
            minDelegationLabel,
            durationText,
            denomination,
            maxDelegationAmt,
            maxDelegationText,
            maxDelegationUsdText,
            avaxPrice,
            estimatedReward,
            estimatedRewardUSD,
            minStakeAmt,
            canSubmit,
            // Methods
            onFeeChange,
            setEnd,
            rewardSelect,
            validateBlsPublicKey,
            validateBlsSignature,
            popStatus,
            popMismatch,
            nodeInfoIn,
            nodeInfoError,
            minValidationDuration,
            minValidationLabel,
            updateFormData,
            formCheck,
            confirm,
            cancelConfirm,
            cancel,
            submit,
            onsuccess,
            updateTxStatus,
            onTxSubmit,
            onerror,
            // External functions for template
            bnToAvaxP,
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../../main";

form {
    display: grid;
    grid-template-columns: 1fr 340px;
    column-gap: 90px;
}
.ins_col {
    max-width: 490px;
    padding-bottom: 8vh;
}
.amt {
    width: 100%;
    display: flex;
    flex-direction: row;
    align-items: center;
    border: 1px solid #999;
    padding: 4px 14px;
}
.bigIn {
    flex-grow: 1;
}

input {
    color: var(--primary-color);
    background-color: var(--bg-light);
    padding: 6px 14px;
}

.desc {
    font-size: 13px;
    margin-bottom: 8px !important;
    color: var(--primary-color-light);
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

.dates {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-gap: 15px;

    label > span {
        float: right;
        opacity: 0.4;
        cursor: pointer;
        &:hover {
            opacity: 1;
        }
    }
}

.submit_box {
    .v-btn {
        margin-top: 14px;
    }
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

.reward_in {
    transition-duration: 0.2s;
    &[type='local'] {
        .reward_addr_in {
            // Not editable here, but the address shown is where rewards go: keep it readable.
            opacity: 0.6;
            user-select: none;
            pointer-events: none;
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

.amount_warning {
    color: var(--warning);
}

.node_cmd {
    margin: 8px 0 12px;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--bg);
    color: var(--primary-color);
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.duration_rules {
    margin-top: 8px;
}

.bls_section {
    background-color: var(--bg-light);
    padding: 15px;
    border-radius: 4px;
    border: 1px solid var(--bg);

    label {
        font-size: 13px;
        font-weight: 500;
        color: var(--primary-color-light);
        display: block;
        margin-bottom: 5px;
    }

    input {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--bg-light);
        border-radius: 3px;
        background-color: var(--bg);
        color: var(--primary-color);
        
        &:focus {
            outline: none;
            border-color: var(--secondary-color);
        }
    }

    .err_msg {
        color: var(--error);
        font-size: 12px;
        margin-top: 5px;
    }

    .node_info_in {
        width: 100%;
        padding: 8px;
        border-radius: 3px;
        background-color: var(--bg);
        color: var(--primary-color);
        font-family: monospace;
        font-size: 12px;
        resize: vertical;
    }

    .pop_ok {
        color: var(--success);
        font-size: 13px;
        margin: 4px 0 0;
    }

    .desc {
        color: var(--primary-color-light);
        margin: 0;
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

@include main.mobile-device {
    form {
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
}
</style>
