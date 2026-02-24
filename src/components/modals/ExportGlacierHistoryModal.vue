<template>
    <modal ref="modal" title="Export Transaction History" class="modal_main">
        <div class="csv_modal_body">
            <div>
                <label>Include Chains</label>
                <MultiSelect
                    style="margin: 0px auto"
                    :labels="['X-Chain', 'P-Chain', 'C-Chain']"
                    :keys="initialSelection"
                    v-model="includeChains"
                    :disabled="operationID"
                ></MultiSelect>
                <label>Date Range</label>
                <RadioButtons
                    :labels="timeframeOptions"
                    :keys="timeframeOptions"
                    :disabled="operationID"
                    v-model="timeframe"
                ></RadioButtons>
                <div>
                    <div>
                        <label>From</label>
                        <datetime
                            v-model="formStartISO"
                            type="datetime"
                            class="date"
                            :min-datetime="startDateMin"
                            :max-datetime="startDateMax"
                            :disabled="operationID || timeframe !== 'Custom'"
                        ></datetime>
                    </div>
                    <div>
                        <label>Until</label>
                        <datetime
                            v-model="formEndISO"
                            type="datetime"
                            class="date"
                            :min-datetime="endDateMin"
                            :max-datetime="endDateMax"
                            :disabled="operationID || timeframe !== 'Custom'"
                        ></datetime>
                    </div>
                </div>
            </div>
            <v-btn
                class="button_secondary"
                @click="submit"
                :disabled="!canSubmit"
                depressed
                block
                style="margin-top: 12px"
                v-if="!operationID"
            >
                Generate
            </v-btn>
            <div style="justify-content: center; display: flex; padding: 1em">
                <Spinner v-if="loading"></Spinner>
                <p class="err" v-if="error">{{ error }}</p>
                <p v-if="downloadURL">Your file is ready to download.</p>
            </div>
            <template v-if="downloadURL || error">
                <v-btn
                    :href="downloadURL"
                    download
                    depressed
                    block
                    :disabled="!downloadURL"
                    class="button_primary"
                    v-if="downloadURL"
                >
                    Download
                </v-btn>
                <v-btn variant="text" @click="reset" depressed block class="restart_button">
                    Start Over
                </v-btn>
            </template>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { useMainStore } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import { BlockchainId, Glacier, OperationStatus } from '@avalabs/glacier-sdk'
import { WalletType } from '@/js/wallets/types'
import MultiSelect from '../misc/MultiSelect.vue'
import glacier from '@/js/Glacier/Glacier'
import Spinner from '@/components/misc/Spinner.vue'
import RadioButtons from '../misc/RadioButtons.vue'
import { setTimeoutInterval } from '@/helpers/setTimeoutInterval'

const DAY = 24 * 60 * 60 * 1000
const MONTH = 30 * DAY

const TIMEOUT_SECONDS = 15

type Timeframe = 'Last 3 Months' | 'Last 6 Months' | 'This Year' | 'Last Year' | 'All' | 'Custom'

export default defineComponent({
    name: 'ExportGlacierHistoryModal',
    components: {
        Modal,
        MultiSelect,
        Spinner,
        RadioButtons,
    },
    setup() {
        const mainStore = useMainStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const operationID = ref<string | null>(null)
        const downloadURL = ref<string | null>(null)
        const loading = ref(false)
        const error = ref<Error | null>(null)
        const endDate = ref(new Date())
        const startDate = ref(new Date(endDate.value.getTime() - DAY))

        const timeframeOptions: Timeframe[] = [
            'Last 3 Months',
            'Last 6 Months',
            'This Year',
            'Last Year',
            'All',
            'Custom',
        ]
        const timeframe = ref<Timeframe>('Last 3 Months')

        const includeChains = ref<BlockchainId[]>([
            BlockchainId.X_CHAIN,
            BlockchainId.P_CHAIN,
            BlockchainId.C_CHAIN,
        ])

        const formEndISO = ref(endDate.value.toISOString())
        const formStartISO = ref(startDate.value.toISOString())

        const intervalPromise = ref<Promise<void> | undefined>(undefined)

        const open = (): void => {
            reset()
            modal.value?.open()
        }

        const checkStatus = async (): Promise<boolean> => {
            if (!operationID.value || downloadURL.value) return true

            const res = await glacier.operations.getOperationResult({ operationId: operationID.value })

            if (res.operationStatus == OperationStatus.COMPLETED) {
                downloadURL.value = res.metadata.downloadUrl || null
                loading.value = false
                return true
            } else if (res.operationStatus == OperationStatus.FAILED) {
                onError(new Error(res.message))
                return true
            } else if (res.operationStatus !== OperationStatus.RUNNING) {
                loading.value = false
                return true
            }
            return false
        }

        const onError = (err: any) => {
            loading.value = false
            error.value = err
        }

        const initialSelection = computed(() => {
            return [BlockchainId.X_CHAIN, BlockchainId.P_CHAIN, BlockchainId.C_CHAIN]
        })

        const canSubmit = computed(() => {
            return includeChains.value.length
        })

        const wallet = computed(() => {
            return mainStore.activeWallet
        })

        const formStartDate = computed(() => {
            return new Date(formStartISO.value)
        })

        const formEndDate = computed(() => {
            return new Date(formEndISO.value)
        })

        const startDateMax = computed(() => {
            return new Date(formEndDate.value.getTime() - DAY).toISOString()
        })

        const startDateMin = computed(() => {
            return new Date(1591236400).toISOString()
        })

        const endDateMax = computed(() => {
            return new Date().toISOString()
        })

        const endDateMin = computed(() => {
            return new Date(1591236400).toISOString()
        })

        const dateNow = computed(() => {
            return new Date()
        })

        const last3Months = computed(() => {
            const date = new Date(dateNow.value.getTime() - 3 * MONTH)
            return date
        })

        const last6Months = computed(() => {
            const date = new Date(dateNow.value.getTime() - 6 * MONTH)
            return date
        })

        const thisYear = computed(() => {
            const date = new Date(`${dateNow.value.getFullYear()}-01-01`)
            return date
        })

        const lastYear = computed(() => {
            const date = new Date(`${thisYear.value.getFullYear() - 1}-01-01`)
            return date
        })

        const dateAll = computed(() => {
            const date = new Date(`2020-09-01`)
            return date
        })

        watch(timeframe, (val: Timeframe) => {
            switch (val) {
                case 'Last 3 Months':
                    formStartISO.value = last3Months.value.toISOString()
                    formEndISO.value = dateNow.value.toISOString()
                    break
                case 'Last 6 Months':
                    formStartISO.value = last6Months.value.toISOString()
                    formEndISO.value = dateNow.value.toISOString()
                    break
                case 'This Year':
                    formStartISO.value = thisYear.value.toISOString()
                    formEndISO.value = dateNow.value.toISOString()
                    break
                case 'Last Year':
                    formStartISO.value = lastYear.value.toISOString()
                    formEndISO.value = thisYear.value.toISOString()
                    break
                case 'All':
                    formStartISO.value = dateAll.value.toISOString()
                    formEndISO.value = dateNow.value.toISOString()
                    break
            }
        }, { immediate: true })

        const generateCSVData = () => {
            const w = mainStore.activeWallet as WalletType
            if (!w) return
            w.startTxExportJob(formStartDate.value, formEndDate.value, includeChains.value).then((res) => {
                operationID.value = res.operationId
                loading.value = true

                intervalPromise.value = setTimeoutInterval(
                    checkStatus,
                    2000,
                    TIMEOUT_SECONDS * 1000
                ).catch((e) => {
                    onError(e)
                })
            })
        }

        const submit = () => {
            try {
                error.value = null
                generateCSVData()
            } catch (e: any) {
                error.value = e
            }
        }

        const reset = () => {
            error.value = null
            operationID.value = null
            downloadURL.value = null
            loading.value = false
        }

        return {
            modal,
            operationID,
            downloadURL,
            loading,
            error,
            endDate,
            startDate,
            timeframeOptions,
            timeframe,
            includeChains,
            formEndISO,
            formStartISO,
            intervalPromise,
            open,
            checkStatus,
            onError,
            initialSelection,
            canSubmit,
            wallet,
            formStartDate,
            formEndDate,
            startDateMax,
            startDateMin,
            endDateMax,
            endDateMin,
            dateNow,
            last3Months,
            last6Months,
            thisYear,
            lastYear,
            dateAll,
            generateCSVData,
            submit,
            reset
        }
    }
})
</script>
<style scoped lang="scss">
.csv_modal_body {
    width: 480px;
    max-width: 100%;
    padding: 10px 20px;

    label {
        font-size: 0.7em;
        font-weight: bold;
    }
}

.restart_button {
    margin-top: 0.5em;
    background-color: transparent !important;
    color: var(--primary-color);
}
</style>
