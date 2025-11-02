<template>
    <div class="transfer_card">
        <!--        <h1>{{ $t('transfer.title') }}</h1>-->
        <div v-if="networkStatus !== 'connected'" class="disconnected">
            <p>{{ $t('transfer.disconnected') }}</p>
        </div>
        <div class="card_body" v-else>
            <FormC v-show="formType === 'C'">
                <ChainInput v-model="formType" :disabled="isConfirm"></ChainInput>
            </FormC>
            <div class="new_order_Form" v-show="formType === 'X'">
                <div class="lists">
                    <ChainInput v-model="formType" :disabled="isConfirm"></ChainInput>
                    <div>
                        <tx-list
                            class="tx_list"
                            ref="txList"
                            @change="updateTxList"
                            :disabled="isConfirm"
                        ></tx-list>
                        <template v-if="hasNFT">
                            <NftList
                                @change="updateNftList"
                                ref="nftList"
                                :disabled="isConfirm"
                            ></NftList>
                        </template>
                    </div>
                </div>
                <div>
                    <div class="to_address">
                        <h4>{{ $t('transfer.to') }}</h4>
                        <qr-input
                            v-model="addressIn"
                            class="qrIn hover_border"
                            placeholder="xxx"
                            :disabled="isConfirm"
                        ></qr-input>
                    </div>
                    <div>
                        <!--                        <template v-if="isConfirm && formMemo.length > 0">-->
                        <!--                            <h4>Memo (Optional)</h4>-->
                        <!--                            <p class="confirm_val">{{ formMemo }}</p>-->
                        <!--                        </template>-->
                        <h4 v-if="memo || !isConfirm">{{ $t('transfer.memo') }}</h4>
                        <textarea
                            class="memo"
                            maxlength="256"
                            placeholder="Memo"
                            autocomplete="off"
                            v-model="memo"
                            v-if="memo || !isConfirm"
                            :disabled="isConfirm"
                        ></textarea>
                    </div>
                    <div class="fees">
                        <p>
                            {{ $t('transfer.fee_tx') }}
                            <span>{{ txFee.toLocaleString(9) }} AVAX</span>
                        </p>
                        <p>
                            {{ $t('transfer.total_avax') }}
                            <span>{{ totalUSD.toLocaleString(2) }} USD</span>
                        </p>
                    </div>
                    <div class="checkout">
                        <ul class="err_list" v-if="formErrors.length > 0">
                            <li v-for="err in formErrors" :key="err">
                                {{ err }}
                            </li>
                        </ul>
                        <template v-if="!isConfirm">
                            <v-btn
                                depressed
                                class="button_primary"
                                :ripple="false"
                                @click="confirm"
                                :disabled="!canSend"
                                block
                            >
                                Confirm
                            </v-btn>
                        </template>
                        <template v-else-if="isConfirm && !isSuccess">
                            <p class="err">{{ err }}</p>
                            <v-btn
                                depressed
                                class="button_primary"
                                :loading="isAjax"
                                :ripple="false"
                                @click="submit"
                                :disabled="!canSend"
                                block
                            >
                                {{ $t('transfer.send') }}
                            </v-btn>
                            <v-btn
                                text
                                block
                                small
                                style="margin-top: 20px !important; color: var(--primary-color)"
                                @click="cancelConfirm"
                            >
                                Cancel
                            </v-btn>
                        </template>
                        <template v-else-if="isSuccess">
                            <p style="color: var(--success)">
                                <fa icon="check-circle"></fa>
                                Transaction Sent
                            </p>
                            <label style="word-break: break-all">
                                <b>ID:</b>
                                {{ txId }}
                            </label>
                            <v-btn
                                depressed
                                style="margin-top: 14px"
                                class="button_primary"
                                :ripple="false"
                                @click="startAgain"
                                block
                                :disabled="!canSendAgain"
                            >
                                Start Again
                            </v-btn>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onActivated, onDeactivated } from 'vue'
import { useStore } from '@/stores'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'

import TxList from '@/components/wallet/transfer/TxList.vue'
import Big from 'big.js'

import NftList from '@/components/wallet/transfer/NftList.vue'

//@ts-ignore
import { QrInput } from '@avalabs/vue_components'
import { ava, avm, isValidAddress } from '../../AVA'
import FaucetLink from '@/components/misc/FaucetLink.vue'
import { ITransaction } from '@/components/wallet/transfer/types'
import { UTXO } from '@/avalanche/apis/avm'
import { Buffer, BN } from '@/avalanche'
import TxSummary from '@/components/wallet/transfer/TxSummary.vue'
import { priceDict, IssueBatchTxInput } from '@/store/types'
import { WalletType } from '@/js/wallets/types'
import { bnToBig } from '@/helpers/helper'
import * as bip39 from 'bip39'
import FormC from '@/components/wallet/transfer/FormC.vue'
import { ChainIdType } from '@/constants'

import ChainInput from '@/components/wallet/transfer/ChainInput.vue'
import AvaAsset from '../../js/AvaAsset'
import { TxState } from '@/components/wallet/earn/ChainTransfer/types'

export default defineComponent({
    name: 'Transfer',
    components: {
        FaucetLink,
        TxList,
        QrInput,
        NftList,
        TxSummary,
        FormC,
        ChainInput,
    },
    setup() {
        const store = useStore()
        const route = useRoute()
        const { t } = useI18n()

        const formType = ref<ChainIdType>('X')
        const showAdvanced = ref(false)
        const isAjax = ref(false)
        const addressIn = ref('')
        const memo = ref('')
        const orders = ref<ITransaction[]>([])
        const nftOrders = ref<UTXO[]>([])
        const formErrors = ref<string[]>([])
        const err = ref('')

        const formAddress = ref('')
        const formOrders = ref<ITransaction[]>([])
        const formNftOrders = ref<UTXO[]>([])
        const formMemo = ref('')

        const isConfirm = ref(false)
        const isSuccess = ref(false)
        const txId = ref('')

        const canSendAgain = ref(false)
        const txState = ref<TxState | null>(null)

        const txList = ref<InstanceType<typeof TxList>>()
        const nftList = ref<InstanceType<typeof NftList>>()

        const confirm = () => {
            let isValid = formCheck()
            if (!isValid) return

            formOrders.value = [...orders.value]
            formNftOrders.value = [...nftOrders.value]
            formAddress.value = addressIn.value
            formMemo.value = memo.value

            isConfirm.value = true
        }

        const cancelConfirm = () => {
            err.value = ''
            formMemo.value = ''
            formOrders.value = []
            formNftOrders.value = []
            formAddress.value = ''
            isConfirm.value = false
        }

        const updateTxList = (data: ITransaction[]) => {
            orders.value = data
        }

        const updateNftList = (val: UTXO[]) => {
            nftOrders.value = val
        }

        const formCheck = () => {
            formErrors.value = []
            let errList = []

            let addr = addressIn.value

            let chain = addr.split('-')

            if (chain[0] !== 'X') {
                errList.push('Invalid address. You can only send to other X addresses.')
            }

            if (!isValidAddress(addr)) {
                errList.push('Invalid address.')
            }

            let memoVal = memo.value
            if (memo.value) {
                let buff = Buffer.from(memoVal)
                let size = buff.length
                if (size > 256) {
                    errList.push('You can have a maximum of 256 characters in your memo.')
                }

                // Make sure memo isnt mnemonic
                let isMnemonic = bip39.validateMnemonic(memoVal)
                if (isMnemonic) {
                    errList.push('You should not put a mnemonic phrase into the Memo field.')
                }
            }

            // Make sure to address matches the bech32 network hrp
            let hrp = ava.getHRP()
            if (!addr.includes(hrp)) {
                errList.push('Not a valid address for this network.')
            }

            formErrors.value = errList
            if (errList.length === 0) {
                return true
            } else {
                return false
            }
        }

        const startAgain = () => {
            clearForm()

            txId.value = ''
            isSuccess.value = false
            cancelConfirm()

            orders.value = []
            nftOrders.value = []
            formOrders.value = []
            formNftOrders.value = []
        }

        const clearForm = () => {
            addressIn.value = ''
            memo.value = ''

            // Clear transactions list
            txList.value?.reset()

            // Clear NFT list
            if (hasNFT.value) {
                nftList.value?.clear()
            }
        }

        const onsuccess = async (txIdVal: string) => {
            isAjax.value = false
            isSuccess.value = true

            store.dispatch('Notifications/add', {
                title: t('transfer.success_title'),
                message: t('transfer.success_msg'),
                type: 'success',
            })

            // Update the user's balance
            store.dispatch('Assets/updateUTXOs').then(() => {
                updateSendAgainLock()
            })
            store.dispatch('History/updateTransactionHistory')
        }

        const updateSendAgainLock = () => {
            if (!wallet.value.isFetchUtxos) {
                canSendAgain.value = true
            } else {
                setTimeout(() => {
                    updateSendAgainLock()
                }, 1000)
            }
        }

        const onerror = (errVal: any) => {
            err.value = errVal
            isAjax.value = false
            store.dispatch('Notifications/add', {
                title: t('transfer.error_title'),
                message: t('transfer.error_msg'),
                type: 'error',
            })
        }

        const submit = () => {
            isAjax.value = true
            err.value = ''

            let sumArray: (ITransaction | UTXO)[] = [...formOrders.value, ...formNftOrders.value]

            let txListData: IssueBatchTxInput = {
                toAddress: formAddress.value,
                memo: Buffer.from(formMemo.value),
                orders: sumArray,
            }

            store
                .dispatch('issueBatchTx', txListData)
                .then((res) => {
                    canSendAgain.value = false
                    waitTxConfirm(res)
                    txId.value = res
                })
                .catch((errVal) => {
                    onerror(errVal)
                })
        }

        const waitTxConfirm = async (txIdVal: string) => {
            let status = await avm.getTxStatus(txIdVal)
            if (status === 'Unknown' || status === 'Processing') {
                // if not confirmed ask again
                setTimeout(() => {
                    waitTxConfirm(txIdVal)
                }, 500)
                return false
            } else if (status === 'Dropped') {
                // If dropped stop the process
                txState.value = TxState.failed
                return false
            } else {
                // If success display success page
                txState.value = TxState.success
                onsuccess(txIdVal)
            }
        }

        // Computed properties
        const networkStatus = computed(() => {
            return store.state.Network.status
        })

        const hasNFT = computed(() => {
            return store.state.Assets.nftUTXOs.length > 0
        })

        const faucetLink = computed(() => {
            let link = process.env.VITE_APP_FAUCET_LINK
            if (link) return link
            return null
        })

        const canSend = computed(() => {
            if (!addressIn.value) return false

            if (
                orders.value.length > 0 &&
                totalTxSize.value.eq(new BN(0)) &&
                nftOrders.value.length === 0
            ) {
                return false
            }

            if (orders.value.length === 0 && nftOrders.value.length === 0) return false

            return true
        })

        const totalTxSize = computed(() => {
            let res = new BN(0)
            for (var i = 0; i < orders.value.length; i++) {
                let order = orders.value[i]
                if (order.amount) {
                    res = res.add(orders.value[i].amount)
                }
            }
            return res
        })

        const avaxTxSize = computed(() => {
            let res = new BN(0)
            for (var i = 0; i < orders.value.length; i++) {
                let order = orders.value[i]
                if (!order.asset) continue
                if (order.amount && order.asset.id === avaxAsset.value.id) {
                    res = res.add(orders.value[i].amount)
                }
            }
            return res
        })

        const avaxAsset = computed((): AvaAsset => {
            return store.getters['Assets/AssetAVA']
        })

        const wallet = computed((): WalletType => {
            return store.state.activeWallet
        })

        const txFee = computed((): Big => {
            let fee = avm.getTxFee()
            return bnToBig(fee, 9)
        })

        const totalUSD = computed((): Big => {
            let totalAsset = avaxTxSize.value.add(avm.getTxFee())
            let bigAmt = bnToBig(totalAsset, 9)
            let usdPrice = priceDict.value.usd
            let usdBig = bigAmt.times(usdPrice)
            return usdBig
        })

        const addresses = computed(() => {
            return store.state.addresses
        })

        const priceDict = computed((): priceDict => {
            return store.state.prices
        })

        const nftUTXOs = computed((): UTXO[] => {
            return store.state.Assets.nftUTXOs
        })

        // Lifecycle hooks
        onDeactivated(() => {
            startAgain()
        })

        onActivated(() => {
            clearForm()

            if (route.query.chain) {
                let chain = route.query.chain as string
                if (chain === 'X') {
                    formType.value = 'X'
                } else {
                    formType.value = 'C'
                }
            }

            if (route.query.nft) {
                let utxoId = route.query.nft as string
                let target = nftUTXOs.value.find((el) => {
                    return el.getUTXOID() === utxoId
                })

                if (target) {
                    nftList.value?.addNft(target)
                }
            }
        })

        return {
            formType,
            showAdvanced,
            isAjax,
            addressIn,
            memo,
            orders,
            nftOrders,
            formErrors,
            err,
            formAddress,
            formOrders,
            formNftOrders,
            formMemo,
            isConfirm,
            isSuccess,
            txId,
            canSendAgain,
            txState,
            txList,
            nftList,
            confirm,
            cancelConfirm,
            updateTxList,
            updateNftList,
            formCheck,
            startAgain,
            clearForm,
            onsuccess,
            updateSendAgainLock,
            onerror,
            submit,
            waitTxConfirm,
            networkStatus,
            hasNFT,
            faucetLink,
            canSend,
            totalTxSize,
            avaxTxSize,
            avaxAsset,
            wallet,
            txFee,
            totalUSD,
            addresses,
            priceDict,
            nftUTXOs,
        }
    }
})

</script>

<style lang="scss">
.advanced_panel {
    .v-expansion-panel-header {
        padding: 0;
        font-size: 12px;
        font-weight: normal;
        color: #2c3e50;
        min-height: auto !important;
        margin-bottom: 10px;
    }
    .v-expansion-panel-content__wrap {
        padding: 0 !important;
    }

    .v-icon {
        font-size: 12px;
    }
}
</style>
<style scoped lang="scss">
@use '../../main';

$padLeft: 24px;
$padTop: 8px;

.disconnected {
    padding: 30px;
    text-align: center;
    background-color: var(--bg-light);
}

.explain {
    font-size: 12px;
    color: var(--primary-color-light);
}
h1 {
    font-weight: normal;
}
h4 {
    display: block;
    text-align: left;
    font-size: 12px;
    font-weight: bold;
    margin: 12px 0;
}

.send_to {
    display: flex;
    margin-bottom: 10px;
}

.addressIn >>> input {
    color: var(--bg) !important;
    padding: 5px 6px !important;
    text-align: center;
    letter-spacing: 2px;
    font-size: 12px;
}

.addressIn >>> input::-webkit-input-placeholder {
    color: var(--primary-color-light) !important;
}

.addressIn .v-input__slot:before {
    display: none;
}

.readerBut {
    margin-top: 4px;
    display: flex;
    background-color: #404040;
    /*cursor: pointer;*/
}
.readerBut button {
    opacity: 0.6;
    outline: none;
    padding: 6px 12px;
    margin: 0px auto;
}
.readerBut:hover button {
    opacity: 1;
}

.memo {
    font-size: 14px;
    background-color: var(--bg-light);
    resize: none;
    width: 100%;
    height: 80px;
    border-radius: 2px;
    padding: 4px 12px;
}

.radio_buttons {
    margin-top: 15px;
}

.tx_info {
    text-align: left;
    font-size: 14px;
}

.new_order_Form {
    display: grid;
    grid-template-columns: 1fr 1fr 300px;
    column-gap: 45px;
}

.new_order_Form > div {
    /*padding: 10px 0;*/
    margin-bottom: 15px;
}
.lists {
    /*padding-right: 45px;*/
    border-right: 1px solid var(--bg-light);
    grid-column: 1/3;

    /*> div{*/
    /*    margin: 14px 0;*/
    /*}*/
}

.tx_list {
    margin-bottom: 14px;
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

.to_address {
}

label {
    color: var(--primary-color-light);
    font-size: 12px;
    font-weight: bold;
    margin: 2px 0 !important;
}

.faucet {
    margin-top: 20px;
}

.advanced {
    padding: 20px 0px !important;
    margin-bottom: 20px;
}

.advanced .advancedBody {
    transition-duration: 0.2s;
}

.err_list {
    font-size: 12px;
    color: var(--error);
    margin: 6px 0;
}

.checkout {
    margin-top: 14px;
}

.confirm_val {
    background-color: var(--bg-light);
    word-break: break-all;
    padding: 8px 16px;
}

//@media only screen and (max-width: 600px) {
//    .order_form {
//        display: block;
//    }
//    .asset_select button {
//        flex-grow: 1;
//        word-break: break-word;
//    }
//}

@include main.medium-device {
    .new_order_Form {
        grid-template-columns: 1fr 1fr 220px;
        column-gap: 25px;
    }
}

@include main.mobile-device {
    .transfer_card {
        display: block;
        grid-template-columns: none;
    }

    .but_primary {
        width: 100%;
    }

    .new_order_Form {
        display: block;
        grid-template-columns: none;
    }

    .tx_list {
        padding: 0;
        border: none;
    }

    .lists {
        border: none;
    }
}
</style>
