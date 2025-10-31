<template>
    <div>
        <div class="cols">
            <form @submit.prevent="">
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
                            <DateForm @change_end="setEnd"></DateForm>
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
                                v-model="stakeAmt"
                                :max="maxFormAmount"
                                class="amt_in"
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
                            <h4>{{ $t('earn.validate.bls.label') || 'BLS Signature (ACP-62)' }}</h4>
                            <p class="desc">
                                {{ $t('earn.validate.bls.desc') || 'BLS public key and signature are required for validator registration.' }}
                            </p>
                            <div class="bls_section">
                                <div style="margin: 15px 0">
                                    <label>BLS Public Key (48 bytes)</label>
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
                                    <label>BLS Signature (96 bytes)</label>
                                    <input
                                        type="text"
                                        v-model="blsSignature"
                                        style="width: 100%; font-family: monospace; font-size: 12px"
                                        placeholder="0x..."
                                        maxlength="194"
                                    />
                                    <p v-if="blsSignatureError" class="err_msg">{{ blsSignatureError }}</p>
                                </div>
                                <div style="margin: 10px 0">
                                    <button 
                                        type="button" 
                                        @click="generateBlsKeys" 
                                        class="button_secondary"
                                        style="font-size: 12px; padding: 8px 16px"
                                    >
                                        {{ $t('earn.validate.bls.generate') || 'Generate BLS Keys' }}
                                    </button>
                                    <p class="desc" style="font-size: 11px; margin-top: 5px">
                                        {{ $t('earn.validate.bls.generate_desc') || 'Generate BLS keys deterministically from your wallet seed.' }}
                                    </p>
                                </div>
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
                        :delegation-fee="delegationFee"
                        :reward-address="rewardIn"
                        :reward-destination="rewardDestination"
                        :bls-public-key="formBlsPublicKey"
                        :bls-signature="formBlsSignature"
                    ></ConfirmPage>
                </transition-group>
                <div>
                    <div class="summary" v-if="!isSuccess">
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
                                {{ $t('earn.validate.errs.duration_warn') }}
                            </p>
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
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'
//@ts-ignore
import AvaxInput from '@/components/misc/AvaxInput.vue'
import { BN } from 'avalanche'
import Big from 'big.js'
//@ts-ignore
import { QrInput } from '@avalabs/vue_components'
import { bintools, pChain } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import ConfirmPage from '@/components/wallet/earn/Validate/ConfirmPage.vue'
import moment from 'moment'
import { bnToBig, calculateStakingReward } from '@/helpers/helper'
import { ONEAVAX } from 'avalanche/dist/utils'
import Tooltip from '@/components/misc/Tooltip.vue'
import CurrencySelect from '@/components/misc/CurrencySelect/CurrencySelect.vue'
import Spinner from '@/components/misc/Spinner.vue'
import DateForm from '@/components/wallet/earn/DateForm.vue'
import UtxoSelectForm from '@/components/wallet/earn/UtxoSelectForm.vue'
import Expandable from '@/components/misc/Expandable.vue'
import { AmountOutput, UTXO, UTXOSet } from 'avalanche/dist/apis/platformvm'
import { WalletType } from '@/js/wallets/types'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { selectMaxUtxoForStaking } from '@/helpers/utxoSelection/selectMaxUtxoForStaking'
import { bnToAvaxP } from '@avalabs/avalanche-wallet-sdk'
import { generateBlsKeyPair, signBlsMessage, generateProofOfPossessionMessage } from '@/helpers/bls_utils'

const MIN_MS = 60000
const HOUR_MS = MIN_MS * 60
const DAY_MS = HOUR_MS * 24

const MIN_STAKE_DURATION = DAY_MS * 14
const MAX_STAKE_DURATION = DAY_MS * 365

export default defineComponent({
    name: 'add_validator',
    components: {
        Tooltip,
        AvaxInput,
        QrInput,
        ConfirmPage,
        CurrencySelect,
        Spinner,
        DateForm,
        Expandable,
        UtxoSelectForm,
    },
    emits: ['cancel'],
    setup(props, { emit }) {
        const store = useStore()
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
        const wallet = computed((): WalletType => {
            return store.state.activeWallet
        })

        const rewardAddressLocal = computed(() => {
            const w: MnemonicWallet = store.state.activeWallet
            return w.getPlatformRewardAddress()
        })

        const platformUnlocked = computed((): BN => {
            return store.getters['Assets/walletPlatformBalance'].available
        })

        const platformLockedStakeable = computed((): BN => {
            return store.getters['Assets/walletPlatformBalanceLockedStakeable']
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

        const warnShortDuration = computed((): boolean => {
            const dur = stakeDuration.value

            // If duration is less than 16 days give a warning
            if (dur <= DAY_MS * 16) {
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
            return Big(store.state.prices.usd)
        })

        const estimatedReward = computed((): Big => {
            const start = new Date(startDate.value)
            const end = new Date(endDate.value)
            const duration = end.getTime() - start.getTime() // in ms

            const currentSupply = store.state.Platform.currentSupply
            const estimation = calculateStakingReward(stakeAmt.value, duration / 1000, currentSupply)
            const res = bnToBig(estimation, 9)

            return res
        })

        const estimatedRewardUSD = computed(() => {
            return estimatedReward.value.times(avaxPrice.value)
        })

        const minStakeAmt = computed((): BN => {
            return store.state.Platform.minStake
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
            if (!blsPublicKey.value) {
                blsPublicKeyError.value = 'BLS public key is required for validator registration.'
                return false
            }
            
            const clean = blsPublicKey.value.startsWith('0x') ? blsPublicKey.value.slice(2) : blsPublicKey.value
            if (clean.length !== 96 || !/^[0-9a-fA-F]+$/.test(clean)) {
                blsPublicKeyError.value = 'Invalid BLS public key format. Must be 48 bytes (96 hex characters).'
                return false
            }
            return true
        }

        const validateBlsSignature = () => {
            blsSignatureError.value = ''
            if (!blsSignature.value) {
                blsSignatureError.value = 'BLS signature is required for validator registration.'
                return false
            }
            
            const clean = blsSignature.value.startsWith('0x') ? blsSignature.value.slice(2) : blsSignature.value
            if (clean.length !== 192 || !/^[0-9a-fA-F]+$/.test(clean)) {
                blsSignatureError.value = 'Invalid BLS signature format. Must be 96 bytes (192 hex characters).'
                return false
            }
            return true
        }

        const generateBlsKeys = async () => {
            try {
                // Generate keys deterministically from wallet
                const w: WalletType = store.state.activeWallet
                const seed = w.getCurrentAddressPlatform() + nodeId.value
                const keyPair = generateBlsKeyPair(seed)
                
                // Generate proof of possession
                const message = generateProofOfPossessionMessage(nodeId.value, keyPair.publicKey)
                const signature = signBlsMessage(keyPair.privateKey, message)
                
                blsPublicKey.value = '0x' + keyPair.publicKey
                blsSignature.value = '0x' + signature.signature
                
                // Validate the generated keys
                validateBlsPublicKey()
                validateBlsSignature()
                
                store.dispatch('Notifications/add', {
                    type: 'info',
                    title: 'BLS Keys Generated',
                    message: 'BLS public key and signature have been generated for your validator.'
                })
            } catch (error) {
                console.error('Failed to generate BLS keys:', error)
                store.dispatch('Notifications/add', {
                    type: 'error',
                    title: 'BLS Generation Failed',
                    message: 'Failed to generate BLS keys. Please enter them manually.'
                })
            }
        }

        const updateFormData = () => {
            formNodeId.value = nodeId.value.trim()
            formAmt.value = stakeAmt.value
            formEnd.value = new Date(endDate.value)
            formRewardAddr.value = rewardIn.value
            formFee.value = parseFloat(delegationFee.value)
            formBlsPublicKey.value = blsPublicKey.value.trim()
            formBlsSignature.value = blsSignature.value.trim()
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
            store.dispatch('Notifications/add', {
                type: 'success',
                title: 'Validator Added',
                message: 'Your tokens are now locked to stake.',
            })

            // Update History
            setTimeout(() => {
                store.dispatch('Assets/updateUTXOs')
                store.dispatch('History/updateTransactionHistory')
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
            txId.value = txIdVal
            isSuccess.value = true
            updateTxStatus(txIdVal)
        }

        const onerror = (error: any) => {
            const msg: string = error.message
            console.error(error)

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
                err.value = error.message
            }

            store.dispatch('Notifications/add', {
                type: 'error',
                title: 'Validation Failed',
                message: 'Failed to add validator.',
            })
        }

        const submit = async () => {
            if (!formCheck()) return
            const w: WalletType = store.state.activeWallet

            // Start delegation in 5 minutes
            let startDateVal = new Date(Date.now() + 5 * MIN_MS)
            const endMs = formEnd.value.getTime()
            const startMs = startDateVal.getTime()

            // If End date - start date is greater than max stake duration, adjust start date
            if (endMs - startMs > MAX_STAKE_DURATION) {
                startDateVal = new Date(endMs - MAX_STAKE_DURATION)
            }

            try {
                isLoading.value = true
                err.value = ''
                const txIdVal = await w.validate(
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
            generateBlsKeys,
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
            opacity: 0.3;
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

.bls_section {
    background-color: var(--bg-light);
    padding: 15px;
    border-radius: 4px;
    border: 1px solid var(--bg-light-2);

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
        border: 1px solid var(--bg-light-2);
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
