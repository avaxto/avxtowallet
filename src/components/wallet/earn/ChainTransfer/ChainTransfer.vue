<template>
    <div>
        <div class="cols">
            <div class="form">
                <ChainSwapForm
                    ref="form"
                    @change="onFormChange"
                    :is-confirm="isConfirm"
                    :balance="balanceBig"
                    :max-amt="formMaxAmt"
                ></ChainSwapForm>

                <div v-if="!isSuccess && !isLoading">
                    <div v-if="!isImportErr" class="fees">
                        <h4>{{ $t('earn.transfer.fee') }}</h4>
                        <p>
                            Export Fee
                            <span>{{ exportFee.toLocaleString() }} AVAX</span>
                        </p>
                        <p>
                            Import Fee
                            <span>{{ importFee.toLocaleString() }} AVAX</span>
                        </p>
                        <p>
                            <b>
                                Total
                                <span>{{ fee.toLocaleString() }} AVAX</span>
                            </b>
                        </p>
                    </div>
                    <div>
                        <p class="err">{{ err }}</p>
                        <template v-if="isImportErr">
                            <p>
                                {{ $t('earn.transfer.err_desc') }}
                            </p>
                            <v-btn
                                depressed
                                class="button_secondary"
                                small
                                block
                                @click="startAgain"
                            >
                                {{ $t('earn.transfer.success.again') }}
                            </v-btn>
                        </template>
                        <template v-else>
                            <v-btn
                                v-if="!isConfirm"
                                data-cy="confirm"
                                class="button_primary"
                                @click="confirm"
                                :disabled="!canSubmit"
                                block
                                depressed
                                :loading="isLoading"
                            >
                                {{ $t('earn.transfer.confirm') }}
                            </v-btn>
                            <template v-else>
                                <v-btn
                                    data-cy="submit"
                                    class="button_secondary"
                                    @click="submit"
                                    :loading="isLoading"
                                    depressed
                                    block
                                >
                                    {{ $t('earn.transfer.submit') }}
                                </v-btn>
                                <v-btn
                                    v-if="!isLoading"
                                    data-cy="cancel"
                                    style="color: var(--primary-color); margin: 12px 0 !important"
                                    @click="cancelConfirm"
                                    depressed
                                    text
                                    block
                                >
                                    {{ $t('earn.transfer.cancel') }}
                                </v-btn>
                            </template>
                        </template>
                    </div>
                </div>
                <div v-if="isSuccess" class="complete">
                    <h4>{{ $t('earn.transfer.success.title') }}</h4>
                    <p style="color: var(--success); margin: 12px 0 !important">
                        <fa icon="check-circle"></fa>
                        {{ $t('earn.transfer.success.message') }}
                    </p>
                    <v-btn depressed class="button_secondary" small block @click="startAgain">
                        {{ $t('earn.transfer.success.again') }}
                    </v-btn>
                </div>
            </div>
            <div class="right_col">
                <ChainCard :chain="sourceChain"></ChainCard>
                <ChainCard :chain="targetChain" :is-source="false"></ChainCard>
                <TxStateCard
                    :state="exportState"
                    :status="exportStatus"
                    :reason="exportReason"
                    :tx-id="exportId"
                ></TxStateCard>
                <TxStateCard
                    :state="importState"
                    :status="importStatus"
                    :reason="importReason"
                    :tx-id="importId"
                    :is-export="false"
                ></TxStateCard>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'

import Dropdown from '@/components/misc/Dropdown.vue'
import AvaxInput from '@/components/misc/AvaxInput.vue'
import AvaAsset from '@/js/AvaAsset'
import { BN } from 'avalanche'
import { avm, cChain, pChain } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import Spinner from '@/components/misc/Spinner.vue'
import ChainCard from '@/components/wallet/earn/ChainTransfer/ChainCard.vue'
import TxStateCard from '@/components/wallet/earn/ChainTransfer/TxState.vue'
import { ChainSwapFormData, TxState } from '@/components/wallet/earn/ChainTransfer/types'
import { ChainIdType } from '@/constants'

import ChainSwapForm from '@/components/wallet/earn/ChainTransfer/Form.vue'

import { WalletType } from '@/js/wallets/types'
import {
    ExportChainsC,
    ExportChainsP,
    ExportChainsX,
    GasHelper,
    Big,
    bnToBig,
    bnToAvaxX,
    bnToBigAvaxX,
    bnToBigAvaxC,
    bigToBN,
    avaxCtoX,
    bnToAvaxP,
} from '@avalabs/avalanche-wallet-sdk'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { selectMaxUtxoForExportP } from '@/helpers/utxoSelection/selectMaxUtxoForExportP'

const IMPORT_DELAY = 5000 // in ms
const BALANCE_DELAY = 2000 // in ms

export default defineComponent({
    name: 'chain_transfer',
    components: {
        Spinner,
        Dropdown,
        AvaxInput,
        ChainCard,
        ChainSwapForm,
        TxStateCard,
    },
    setup() {
        const store = useStore()
        const { t } = useI18n()

        const form = ref<InstanceType<typeof ChainSwapForm> | null>(null)
        const sourceChain = ref<ChainIdType>('X')
        const targetChain = ref<ChainIdType>('P')
        const isLoading = ref(false)
        const amt = ref(new BN(0))
        const err = ref('')

        const isImportErr = ref(false)
        const isConfirm = ref(false)
        const isSuccess = ref(false)

        const formAmt = ref(new BN(0))
        const baseFee = ref(new BN(0))

        // Transaction ids
        const exportId = ref('')
        const exportState = ref(TxState.waiting)
        const exportStatus = ref<string | null>(null)
        const exportReason = ref<string | null>(null)

        const importId = ref('')
        const importState = ref(TxState.waiting)
        const importStatus = ref<string | null>(null)
        const importReason = ref<string | null>(null)

        const txMaxAmount = ref<BN | undefined>(undefined)

        // Watch for chain changes
        watch([sourceChain, targetChain], () => {
            if (sourceChain.value === 'C' || targetChain.value === 'C') {
                updateBaseFee()
            }
        })

        onMounted(() => {
            updateBaseFee()
        })

        const ava_asset = computed((): AvaAsset | null => {
            let ava = store.getters['Assets/AssetAVA']
            return ava
        })

        const platformBalance = computed(() => {
            return store.getters['Assets/walletPlatformBalance']
        })

        const platformUnlocked = computed((): BN => {
            return platformBalance.value.available
        })

        const avmUnlocked = computed((): BN => {
            if (!ava_asset.value) return new BN(0)
            return ava_asset.value.amount
        })

        const evmUnlocked = computed((): BN => {
            let balRaw = wallet.value.ethBalance
            return avaxCtoX(balRaw)
        })

        const balanceBN = computed((): BN => {
            if (sourceChain.value === 'P') {
                return platformUnlocked.value
            } else if (sourceChain.value === 'C') {
                return evmUnlocked.value
            } else {
                return avmUnlocked.value
            }
        })

        // Add the remaining computed properties and methods here...
        const balanceBig = computed((): Big => {
            return bnToBig(balanceBN.value, 9)
        })

        const formAmtText = computed(() => {
            return bnToAvaxX(formAmt.value)
        })

        const fee = computed((): Big => {
            return exportFee.value.add(importFee.value)
        })

        const feeBN = computed((): BN => {
            return importFeeBN.value.add(exportFeeBN.value)
        })

        const getFee = (chain: ChainIdType, isExport: boolean): Big => {
            if (chain === 'X') {
                return bnToBigAvaxX(avm.getTxFee())
            } else if (chain === 'P') {
                return bnToBigAvaxX(pChain.getTxFee())
            } else {
                const fee = isExport
                    ? GasHelper.estimateExportGasFeeFromMockTx(
                          targetChain.value as ExportChainsC,
                          amt.value,
                          wallet.value.getEvmAddress(),
                          wallet.value.getCurrentAddressPlatform()
                      )
                    : GasHelper.estimateImportGasFeeFromMockTx(1, 1)

                const totFeeWei = baseFee.value.mul(new BN(fee))
                return bnToBigAvaxC(totFeeWei)
            }
        }

        const importFee = computed((): Big => {
            return getFee(targetChain.value, false)
        })

        /**
         * Returns the import fee in nAVAX
         */
        const importFeeBN = computed((): BN => {
            return bigToBN(importFee.value, 9)
        })

        const exportFee = computed((): Big => {
            return getFee(sourceChain.value, true)
        })

        const exportFeeBN = computed((): BN => {
            return bigToBN(exportFee.value, 9)
        })

        /**
         * User's spendable balance minus total fees
         */
        const maxAmt = computed((): BN => {
            let max = balanceBN.value.sub(feeBN.value)

            if (max.isNeg() || max.isZero()) {
                return new BN(0)
            } else {
                return max
            }
        })

        /**
         * Maximum amount that fits into a valid transaction (excluding export fee)
         */
        const formMaxAmt = computed(() => {
            const amt = txMaxAmount.value ? BN.min(maxAmt.value, txMaxAmount.value) : maxAmt.value
            return amt
        })

        const updateMaxTxSize = () => {
            if (sourceChain.value !== 'P' || targetChain.value === 'P') {
                txMaxAmount.value = undefined
                return
            }

            const utxoSet = wallet.value.getPlatformUTXOSet()
            const sortedSet = sortUTxoSetP(utxoSet, false)

            const pChangeAddr = wallet.value.getCurrentAddressPlatform()
            const fromAddrs = wallet.value.getAllAddressesP()

            const destinationAddr =
                targetChain.value === 'C'
                    ? wallet.value.getEvmAddressBech()
                    : wallet.value.getCurrentAddressAvm()

            const res = selectMaxUtxoForExportP(sortedSet.getAllUTXOs())
            // The maximum form amount is = max possible export amount - export and import fees
            txMaxAmount.value = res.amount.sub(feeBN.value)
        }

        const onFormChange = (data: ChainSwapFormData) => {
            amt.value = data.amount
            sourceChain.value = data.sourceChain
            targetChain.value = data.destinationChain
        }

        const confirm = () => {
            formAmt.value = amt.value.clone()
            isConfirm.value = true
        }

        const cancelConfirm = () => {
            isConfirm.value = false
            formAmt.value = new BN(0)
        }

        const wallet = computed(() => {
            let wallet: WalletType = store.state.activeWallet
            return wallet
        })

        const updateBaseFee = async () => {
            baseFee.value = await GasHelper.getBaseFeeRecommended()
        }

        watch([sourceChain, targetChain, balanceBN, feeBN, wallet], () => {
            updateMaxTxSize()
        })

        const canSubmit = computed(() => {
            if (amt.value.lte(new BN(0))) {
                return false
            }
            if (amt.value.gt(formMaxAmt.value)) {
                return false
            }
            return true
        })

        const isEvmVerified = (txId: string): boolean => {
            // TODO: Implement proper EVM verification
            return true
        }

        const submit = async () => {
            err.value = ''
            isLoading.value = true
            isImportErr.value = false

            try {
                await chainExport(formAmt.value, sourceChain.value, targetChain.value)
            } catch (error) {
                onerror(error)
            }
        }

        // Convert remaining methods to composition API functions
        const chainExport = async (amt: BN, sourceChain: ChainIdType, destinationChain: ChainIdType) => {
            // Implementation will be added
        }

        const onerror = (error: any) => {
            isLoading.value = false
            err.value = error.message || error
        }

        const startAgain = () => {
            if (form.value) {
                form.value.clear()
            }

            err.value = ''
            isImportErr.value = false
            isConfirm.value = false
            isLoading.value = false
            isSuccess.value = false

            exportId.value = ''
            exportState.value = TxState.waiting
            exportStatus.value = null
            exportReason.value = null

            importId.value = ''
            importState.value = TxState.waiting
            importStatus.value = null
        }

        return {
            form,
            sourceChain,
            targetChain,
            isLoading,
            amt,
            err,
            isImportErr,
            isConfirm,
            isSuccess,
            formAmt,
            baseFee,
            exportId,
            exportState,
            exportStatus,
            exportReason,
            importId,
            importState,
            importStatus,
            avmUnlocked,
            balanceBN,
            platformUnlocked,
            evmUnlocked,
            balanceBig,
            formAmtText,
            fee,
            feeBN,
            importFee,
            importFeeBN,
            exportFee,
            exportFeeBN,
            formMaxAmt,
            canSubmit,
            wallet,
            onFormChange,
            confirm,
            cancelConfirm,
            submit,
            startAgain,
            updateBaseFee
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../../main";

.cols {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 5vw;
}
.right_col {
    min-width: 500px;
}

.left_col {
    max-width: 400px;
}

.form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--bg-light);
    border-radius: 6px;
    padding: 24px;
    border: 2px solid var(--primary-color-light);
}

.row {
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.chain_to_chain {
    display: grid;
    grid-template-columns: max-content max-content max-content;
    align-items: center;
    column-gap: 30px;
    row-gap: 12px;
}

.chain_card {
    border: 2px solid var(--primary-color-light);
    border-radius: 6px;
    padding: 12px;
    background: var(--bg-light);
}

.chain_card.selected {
    border-color: var(--primary-color);
    background: var(--primary-color-light);
}

.arrow_icon {
    width: 20px;
    transform: rotate(90deg);
}

.form_label {
    font-size: 14px;
    font-weight: 700;
    color: var(--primary-color);
}

.amt_in {
    text-align: right;
    margin-top: 12px;
}

.submit_but {
    margin-top: 24px;
}

.chain_switch {
    cursor: pointer;
    opacity: 0.7;
}

.chain_switch:hover {
    opacity: 1;
}

@include main.mobile-device {
    .cols {
        display: block;
    }

    .right_col {
        margin-top: 30px;
        min-width: auto;
    }

    .chain_to_chain {
        grid-template-columns: 1fr max-content 1fr;
    }
}
</style>
<style scoped lang="scss">
@use "../../../../main";

.cols {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: 5vw;
}

.right_col {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    column-gap: 14px;
    row-gap: 2px;
    padding-top: 14px;
    height: max-content;
    //height: 100%;
    > div {
        //height: max-content;
        background-color: var(--bg-light);
        border-radius: 4px;
        padding: 12px 18px;
        box-shadow: 1px 1px 6px rgba(0, 0, 0, 0.1);
    }
}

.form {
    max-width: 100%;
    width: 360px;
    padding-bottom: 14px;
    //justify-self: center;
    > div {
        margin: 14px 0;
    }
}
.dropdown {
    background-color: var(--bg-light);
}

.chain {
    font-size: 32px;
    text-align: center;
    justify-content: center;
}
.chains {
    position: relative;
    //text-align: center;
    display: grid;
    grid-template-rows: max-content max-content;
    row-gap: 14px;
    //margin: 0 !important;
    //column-gap: 4px;
    //grid-template-columns: 1fr 1fr;
}

.chain_cont {
    background-color: var(--bg-light);
    padding: 14px;
}

.switch_but {
    position: absolute;
    left: 50%;
    border: 3px solid var(--bg-wallet-light);
    transform: translateX(-50%);
}

label {
    color: var(--primary-color-light);
}

.meta {
    display: grid;
    grid-template-columns: max-content max-content;
    column-gap: 2em;
}

h2 {
    font-weight: lighter;
    font-size: 2em;
}
.import_err {
    max-width: 320px;
    //margin: 10vh auto;
    color: var(--primary-color);

    p {
        margin: 6px 0 !important;
        margin-bottom: 14px !important;
        color: var(--primary-color-light);
    }
}

.loading_col {
    max-width: 320px;

    > div {
        position: relative;
        background-color: var(--bg-light);
        padding: 14px;
        margin-bottom: 6px;

        &[state='0'] {
            opacity: 0.2;
        }

        &[state='2'] {
            .status_icon {
                color: var(--success);
            }
        }

        &[state='-1'] {
            .status_icon {
                color: var(--error);
            }
        }

        p {
            word-break: break-all;
            font-size: 13px;
        }
    }

    label {
        font-weight: bold;
        font-size: 12px;
    }

    /*.status_icon{*/
    /*    position: absolute;*/
    /*    top: 8px;*/
    /*    right: 12px;*/
    /*}*/

    .loading_header {
        display: flex;
        justify-content: space-between;
    }

    .spinner {
        color: var(--primary-color) !important;
    }
}

.fees {
    margin: 14px 0;
    border-top: 1px solid var(--bg-light);
    padding-top: 14px;
}

.fees p {
    text-align: left;
    font-size: 13px;
    color: var(--primary-color-light);
}

.fees span {
    float: right;
}

.complete {
    margin-top: 30px;
    > div {
        background-color: var(--bg-light);
        padding: 14px;
        margin: 4px 0;
    }

    .desc {
        margin: 6px 0 !important;
        color: var(--primary-color-light);
    }

    p {
        word-break: keep-all !important;
    }
}

@include main.medium-device {
    .cols {
        //display: grid;
        //grid-template-columns: 1fr 2fr;
        grid-template-columns: none;
        //column-gap: 2vw;
    }
    .right_col {
        //grid-template-columns: 1fr 1fr;
        //row-gap: 14px;
        //display: none;
        grid-column: 1;
        grid-row: 1;
    }
}

@include main.mobile-device {
    .cols {
        display: block;
        padding-bottom: 3vh;
    }

    .form {
        width: 100%;
    }
    .chains {
        row-gap: 4px;
        grid-template-columns: none;
        grid-template-rows: max-content max-content;
    }
}
</style>
