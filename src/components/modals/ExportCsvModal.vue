<template>
    <modal ref="modal" title="Export Rewards CSV" class="modal_main">
        <div class="csv_modal_body">
            <p>Only rewarded transactions will be shown.</p>
            <div>
                <v-checkbox
                    label="Validation Rewards"
                    dense
                    hide-details
                    v-model="showValidation"
                ></v-checkbox>
                <v-checkbox
                    label="Delegation Rewards"
                    dense
                    hide-details
                    v-model="showDelegation"
                ></v-checkbox>
                <v-checkbox
                    label="Delegation Fees Received"
                    dense
                    hide-details
                    v-model="showFees"
                ></v-checkbox>
            </div>
            <p class="err" v-if="error">{{ error }}</p>
            <v-btn
                class="button_secondary"
                small
                @click="submit"
                :disabled="!canSubmit"
                depressed
                block
                style="margin-top: 12px"
            >
                Download CSV File
            </v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import {
    CsvRowStakingData,
    CsvRowStakingTxType,
    ITransactionData,
    UTXO,
} from '@/store/modules/history/types'
import { bnToBig } from '@/helpers/helper'
import { getPriceAtUnixTime } from '@/helpers/price_helper'
import { generate } from 'csv-generate'
import moment from 'moment'
import {
    stakingDataToCsvRow,
    downloadCSVFile,
    getOutputTotals,
    getOwnedOutputs,
    getRewardOuts,
    getStakeAmount,
    createCSVContent,
} from '@/utils/history-utils'

export default defineComponent({
    name: 'ExportCsvModal',
    components: {
        Modal,
    },
    setup() {
        const store = useStore()
        
        const modal = ref<InstanceType<typeof Modal>>()
        const showValidation = ref(true)
        const showDelegation = ref(true)
        const showFees = ref(true)
        const error = ref<Error | null>(null)

        const open = (): void => {
            error.value = null
            if (modal.value) {
                modal.value.open()
            }
        }

        const canSubmit = computed(() => {
            return showDelegation.value || showValidation.value || showFees.value
        })

        const transactions = computed(() => {
            return store.state.History.allTransactions
        })

        const stakingTxs = computed((): ITransactionData[] => {
            return store.getters['History/stakingTxs']
        })

        const wallet = computed(() => {
            return store.state.activeWallet
        })

        const pAddresses = computed((): string[] => {
            return wallet.value.getAllAddressesP()
        })

        const pAddressesStripped = computed((): string[] => {
            return pAddresses.value.map((addr: string) => addr.split('-')[1])
        })

        const generateCSVData = () => {
            let myAddresses = pAddressesStripped.value

            // Sort tx by stake end time
            const txsSorted = stakingTxs.value.sort((a, b) => {
                return b.validatorEnd - a.validatorEnd
            })

            let rows: CsvRowStakingData[] = []
            for (var i = 0; i < txsSorted.length; i++) {
                let tx = txsSorted[i]

                let type = tx.type
                let isRewarded = tx.rewarded
                let txId = tx.id

                // We dont care about txs not rewarded
                // TODO: we might care later
                if (!isRewarded) continue

                let stakeAmount = getStakeAmount(tx)
                // Use validator end time for both delegation and validations as reward date
                let rewardMoment = moment(tx.validatorEnd * 1000)
                let startMoment = moment(tx.validatorStart * 1000)
                let durationMoment = moment.duration(rewardMoment.diff(startMoment))

                let nodeID = tx.validatorNodeID

                let avaxPrice = getPriceAtUnixTime(rewardMoment.unix() * 1000)

                let myOuts = getOwnedOutputs(tx.outputs, myAddresses)
                let rewardOuts = getRewardOuts(myOuts)
                let rewardAmt = getOutputTotals(rewardOuts)
                let rewardAmtBig = bnToBig(rewardAmt, 9)
                let rewardAmtUsd = avaxPrice ? rewardAmtBig.mul(avaxPrice) : undefined

                // Did this wallet receive any rewards?
                let isRewardOwner = rewardOuts.length > 0

                // Did we send this staking transaction
                let ins = tx.inputs || []
                let inputOuts = ins.map((input) => input.output)
                let myInputs = getOwnedOutputs(inputOuts, myAddresses)
                let isInputOwner = myInputs.length > 0

                if (type === 'add_delegator') {
                    // Skip if user did not want delegation / fee rewards
                    if (!showDelegation.value && !showFees.value) continue

                    // If user does not want delegation fees received, continue
                    if (!isInputOwner && !showFees.value) continue
                    // If user does not want delegation rewards, continue
                    if (isInputOwner && !showDelegation.value) continue

                    let type: CsvRowStakingTxType = isInputOwner ? 'add_delegator' : 'fee_received'

                    //TODO: What if reward went to another wallet?
                    // if (rewardOuts.length === 0) {
                    // }

                    rows.push({
                        txId: txId,
                        txType: type,
                        stakeDate: startMoment,
                        stakeDuration: durationMoment,
                        stakeAmount: bnToBig(stakeAmount, 9),
                        rewardDate: rewardMoment,
                        rewardAmtAvax: rewardAmtBig,
                        rewardAmtUsd: rewardAmtUsd,
                        avaxPrice: avaxPrice,
                        nodeID: nodeID,
                        isRewardOwner: isRewardOwner,
                        isInputOwner: isInputOwner,
                        rewardDateUnix: tx.validatorEnd,
                    })
                } else {
                    // Skip if user did not want validation rewards
                    if (!showValidation.value) continue

                    rows.push({
                        txId: txId,
                        txType: 'add_validator',
                        stakeDate: startMoment,
                        stakeDuration: durationMoment,
                        stakeAmount: bnToBig(stakeAmount, 9),
                        rewardDate: rewardMoment,
                        rewardAmtAvax: rewardAmtBig,
                        rewardAmtUsd: rewardAmtUsd,
                        avaxPrice: avaxPrice,
                        nodeID: nodeID,
                        isRewardOwner: isRewardOwner,
                        isInputOwner: isInputOwner,
                        rewardDateUnix: tx.validatorEnd,
                    })
                }
            }

            let headers = [
                'Tx ID',
                'Type',
                'Node ID',
                'Stake Amount',
                'Stake Start Date',
                'Stake Duration',
                'Reward Date',
                'Reward Timestamp (UNIX)',
                'AVAX Price at Reward Date',
                'Reward Received (AVAX)',
                'Reward Received (USD)',
            ]

            // Convert data to valid CSV row string
            let rowArrays = rows.map((rowData) => stakingDataToCsvRow(rowData))

            let allRows = [headers, ...rowArrays]
            let csvContent = createCSVContent(allRows)

            downloadCSVFile(csvContent, 'staking_rewards')
        }

        const submit = () => {
            try {
                error.value = null
                generateCSVData()
            } catch (e) {
                error.value = e as Error
            }
        }

        return {
            modal,
            showValidation,
            showDelegation,
            showFees,
            error,
            open,
            canSubmit,
            transactions,
            stakingTxs,
            wallet,
            pAddresses,
            pAddressesStripped,
            generateCSVData,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
.csv_modal_body {
    width: 420px;
    max-width: 100%;
    padding: 10px 20px;
}
</style>
