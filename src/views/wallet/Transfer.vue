<template>
    <div class="transfer_card">
        <div v-if="networkStatus !== 'connected'" class="disconnected">
            <p>{{ $t('transfer.disconnected') }}</p>
        </div>
        <div class="card_body" v-else>
            <FormC v-show="formType === 'C'">
                <ChainInput v-if="hasXChain" v-model="formType" :disabled="isConfirm"></ChainInput>
            </FormC>
            <div class="new_order_Form" v-if="hasXChain" v-show="formType === 'X'">
                <div class="batch_toggle_row">
                    <ChainInput
                        v-model="formType"
                        :disabled="isConfirm || batchMode || multisigMode"
                    ></ChainInput>
                    <label class="batch_switch">
                        <input
                            type="checkbox"
                            v-model="batchMode"
                            :disabled="isConfirm"
                            @change="onBatchToggle"
                        />
                        Batch send (multiple recipients)
                    </label>
                    <label class="batch_switch">
                        <input
                            type="checkbox"
                            v-model="multisigMode"
                            :disabled="isConfirm"
                            @change="onMultisigToggle"
                        />
                        Multisig output (several owners)
                    </label>
                </div>
                <MultisigFormX v-if="multisigMode"></MultisigFormX>
                <BatchFormX v-else-if="batchMode"></BatchFormX>
                <template v-else>
                    <div class="lists">
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
                        <UtxoPreview :preview="utxoPreview"></UtxoPreview>
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
                            <template v-if="isInjectedWallet && !isSuccess && !offline.hasRecords">
                                <p class="err">{{ err }}</p>
                                <SignOnlyToggle :disabled="isAjax"></SignOnlyToggle>
                                <v-btn
                                    depressed
                                    class="button_primary"
                                    :loading="isAjax"
                                    :ripple="false"
                                    @click="sendOneClick"
                                    :disabled="!canSend || isAjax"
                                    block
                                >
                                    {{ $t('transfer.send') }}
                                </v-btn>
                            </template>
                            <template v-else-if="!isConfirm">
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
                                <SignOnlyToggle :disabled="isAjax"></SignOnlyToggle>
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
                            <template v-else-if="offline.hasRecords">
                                <SignedTxExport
                                    :records="offline.records"
                                    @done="startAgain"
                                ></SignedTxExport>
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
                </template>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onActivated, onDeactivated, toRaw } from 'vue'
import {
    useAssetsStore,
    useHistoryStore,
    useMainStore,
    useNetworkStore,
    useNotificationsStore,
    useTransferPrefillStore,
} from '@/stores'
import { useI18n } from 'vue-i18n'

import TxList from '@/components/wallet/transfer/TxList.vue'
import Big from 'big.js'

import NftList from '@/components/wallet/transfer/NftList.vue'
import { QrInput } from '@/vue_components'

// QrInput component imported from vue_components
import { ava, avm, isValidAddress } from '../../AVA'
import FaucetLink from '@/components/misc/FaucetLink.vue'
import { ITransaction } from '@/components/wallet/transfer/types'
import { UTXO } from '@/avalanche/apis/avm'
import { Buffer, BN } from '@/avalanche'
import TxSummary from '@/components/wallet/transfer/TxSummary.vue'
import { IssueBatchTxInput } from '@/types'
// Type for price data
type priceDict = { usd: number }
import { Wallet } from '@/js/wallets/AbstractWallet'
import { bnToBig } from '@/helpers/helper'
import * as bip39 from 'bip39'
import FormC from '@/components/wallet/transfer/FormC.vue'
import { ChainIdType } from '@/constants'

import ChainInput from '@/components/wallet/transfer/ChainInput.vue'
import BatchFormX from '@/components/wallet/transfer/BatchFormX.vue'
import MultisigFormX from '@/components/wallet/transfer/MultisigFormX.vue'
import UtxoPreview from '@/components/wallet/transfer/UtxoPreview.vue'
import { previewFromTx } from '@/js/utxoPreview'
import type { UtxoPreview as UtxoPreviewData } from '@/js/utxoPreview'
import AvaAsset from '../../js/AvaAsset'
import { TxState } from '@/components/wallet/earn/ChainTransfer/types'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { useOfflineSigningStore, isOfflineTxId } from '@/stores'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'
import { useActivePlatformStore } from '@/platforms'

export default defineComponent({
    name: 'Transfer',
    components: {
        SignOnlyToggle,
        SignedTxExport,
        FaucetLink,
        TxList,
        QrInput,
        NftList,
        TxSummary,
        FormC,
        ChainInput,
        BatchFormX,
        MultisigFormX,
        UtxoPreview,
    },
    setup() {
        const mainStore = useMainStore()
        const offline = useOfflineSigningStore()
        const assetsStore = useAssetsStore()
        const networkStore = useNetworkStore()
        const notificationsStore = useNotificationsStore()
        const historyStore = useHistoryStore()
        const transferPrefill = useTransferPrefillStore()
        const platformStore = useActivePlatformStore()
        const { t } = useI18n()

        // X-chain (and the toggle between it and C) is an Avalanche-only
        // concept. `networkStore` — read below by `networkStatus` — is
        // likewise Avalanche's own RPC connection and, since App.vue only
        // boots it while Avalanche is active, never becomes 'connected' on
        // any other platform.
        const hasXChain = computed(
            () => platformStore.hasChainKind('utxo') || platformStore.hasChainKind('staking')
        )

        const formType = ref<ChainIdType>(hasXChain.value ? 'X' : 'C')
        const batchMode = ref(false)
        // Multisig replaces the whole X-chain form rather than layering on
        // the batch one — a batch of multisig outputs is a different feature,
        // so the two are mutually exclusive instead of silently combining.
        const multisigMode = ref(false)

        const onBatchToggle = () => {
            if (batchMode.value) multisigMode.value = false
        }

        const onMultisigToggle = () => {
            if (multisigMode.value) batchMode.value = false
        }
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

        /**
         * Which UTXOs the pending send will consume.
         *
         * Built by running the REAL builder against the current orders and
         * reading its inputs back, so the preview cannot drift from what
         * actually gets signed. `buildUnsignedTransaction` only selects
         * against the wallet's UTXO set and returns an unsigned transaction —
         * it signs nothing, broadcasts nothing and mutates neither the set
         * nor the wallet — so running it per keystroke is safe.
         */
        const utxoPreview = ref<UtxoPreviewData | null>(null)
        let previewToken = 0

        const refreshUtxoPreview = async () => {
            const token = ++previewToken
            // Reads the store directly rather than the `wallet` computed,
            // which is declared further down this setup body.
            const w = mainStore.activeWallet as Wallet | null
            const activeOrders = [...orders.value, ...nftOrders.value]
            if (!w || activeOrders.length === 0) {
                utxoPreview.value = null
                return
            }

            try {
                // Coin selection depends on the amounts, assets and fee — not
                // on where the funds are going — so the wallet's own address
                // stands in while the recipient field is still empty or
                // half-typed. Using it avoids a preview that flickers in only
                // once a valid address happens to be present.
                const destination = addressIn.value.trim() || w.getCurrentAddressAvm()
                const unsignedTx = await w.buildUnsignedTransaction(activeOrders, destination)

                // A slow build for an older set of orders must not overwrite a
                // newer one's result.
                if (token !== previewToken) return

                const sending: Record<string, BN> = {}
                for (const order of orders.value) {
                    const assetId = (order as ITransaction).asset?.id
                    if (!assetId) continue
                    sending[assetId] = (sending[assetId] ?? new BN(0)).add(
                        (order as ITransaction).amount
                    )
                }

                const utxoSet = w.getUTXOSet()
                utxoPreview.value = previewFromTx(
                    unsignedTx.getTransaction() as any,
                    (utxoId) => utxoSet.getUTXO(utxoId),
                    sending
                )
            } catch (e) {
                // Not enough funds, an unsupported combination, a transient
                // asset-id lookup — all of which the submit path reports
                // properly. A preview has nothing useful to add, so it simply
                // shows nothing rather than surfacing a second error.
                if (token === previewToken) utxoPreview.value = null
            }
        }

        let previewTimer: ReturnType<typeof setTimeout> | undefined
        watch(
            [orders, nftOrders, addressIn],
            () => {
                clearTimeout(previewTimer)
                previewTimer = setTimeout(refreshUtxoPreview, 250)
            },
            { deep: true }
        )

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

        // Injected wallets (Core App / MetaMask) sign+broadcast through the
        // extension's own confirmation UI, so this app's separate Confirm step
        // is redundant friction — collapse Confirm+Submit into a single click.
        // Mnemonic (and other local-key) wallets keep the 2-step flow since
        // there's no external confirmation prompt to lean on.
        const isInjectedWallet = computed(() => wallet.value?.type === 'injected')

        const sendOneClick = () => {
            confirm()
            if (isConfirm.value) {
                submit()
            }
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
            if (!data || data instanceof Event) return

            orders.value = [...data]
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
            offline.clearRecords()
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

            notificationsStore.add({
                title: t('transfer.success_title'),
                message: t('transfer.success_msg'),
                type: 'success',
            })

            // Update the user's balance
            assetsStore.updateUTXOs().then(() => {
                updateSendAgainLock()
            })
            historyStore.updateTransactionHistory()
        }

        const updateSendAgainLock = () => {
            if (!wallet.value.isFetchingUtxos) {
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
            notificationsStore.add({
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

            authorizeSingle(wallet.value, 'Send an X-chain transaction', () =>
                mainStore.issueBatchTx(txListData)
            )
                .then((res) => {
                    canSendAgain.value = false
                    waitTxConfirm(res)
                    txId.value = res
                })
                .catch((errVal) => {
                    if (errVal instanceof SessionAuthCancelled) {
                        isAjax.value = false
                        return
                    }
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
        /**
         * Drives the top-level "Network is disconnected" gate. On Avalanche
         * this is `networkStore`'s real RPC connection state; other platforms
         * have no equivalent poller of their own yet (see the same pattern in
         * StatusBar.vue), so readiness there just means a wallet is attached —
         * otherwise this would read 'disconnected' forever post-App.vue-fix
         * and permanently hide the send form on every non-Avalanche platform.
         */
        const networkStatus = computed(() => {
            if (hasXChain.value) return networkStore.status
            return platformStore.activeWallet !== null ? 'connected' : 'disconnected'
        })

        const hasNFT = computed(() => {
            return assetsStore.nftUTXOs.length > 0
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
            const rawOrders = toRaw(orders.value)
            for (var i = 0; i < rawOrders.length; i++) {
                let order = rawOrders[i]
                if (order.amount) {
                    res = res.add(order.amount)
                }
            }
            return res
        })

        const avaxTxSize = computed(() => {
            let res = new BN(0)
            const rawOrders = toRaw(orders.value)
            for (var i = 0; i < rawOrders.length; i++) {
                let order = rawOrders[i]
                if (!order.asset) continue
                if (!avaxAsset.value) continue
                if (order.amount && order.asset.id === avaxAsset.value.id) {
                    res = res.add(order.amount)
                }
            }
            return res
        })

        const avaxAsset = computed(
            (): AvaAsset => {
                return assetsStore.AssetAVA
            }
        )

        const wallet = computed(
            (): Wallet => {
                return mainStore.activeWallet as Wallet
            }
        )

        const txFee = computed(
            (): Big => {
                let fee = avm.getTxFee()
                return bnToBig(fee, 9)
            }
        )

        const totalUSD = computed(
            (): Big => {
                let totalAsset = avaxTxSize.value.add(avm.getTxFee())
                let bigAmt = bnToBig(totalAsset, 9)
                let usdPrice = priceDict.value.usd
                if (typeof usdPrice !== 'number' || isNaN(usdPrice)) {
                    return Big(0)
                }
                let usdBig = bigAmt.times(usdPrice)
                return usdBig
            }
        )

        const addresses = computed(() => {
            return mainStore.addresses
        })

        const priceDict = computed(
            (): priceDict => {
                return mainStore.prices
            }
        )

        const nftUTXOs = computed((): UTXO[] => {
            return assetsStore.nftUTXOs
        })

        // Lifecycle hooks
        onDeactivated(() => {
            startAgain()
            // Reset the prefill store so a later, un-prefilled visit to this
            // view (e.g. via the sidebar's plain Transfer link) starts clean
            // instead of reusing whatever a previous "send" icon set here.
            transferPrefill.clear()
        })

        onActivated(() => {
            clearForm()

            if (transferPrefill.chain) {
                formType.value = transferPrefill.chain === 'X' ? 'X' : 'C'
            }

            if (transferPrefill.nft) {
                let utxoId = transferPrefill.nft
                let target = nftUTXOs.value.find((el) => {
                    return el.getUTXOID() === utxoId
                })

                if (target) {
                    nftList.value?.addNft(target)
                }
            }
        })

        return {
            offline,
            formType,
            batchMode,
            utxoPreview,
            multisigMode,
            onBatchToggle,
            onMultisigToggle,
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
            isInjectedWallet,
            sendOneClick,
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
            hasXChain,
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
    },
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

.addressIn :deep(input) {
    color: var(--bg) !important;
    padding: 5px 6px !important;
    text-align: center;
    letter-spacing: 2px;
    font-size: 12px;
}

.addressIn :deep(input::-webkit-input-placeholder) {
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
    display: block;
}

.batch_toggle_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
}

.batch_switch {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--primary-color-light);
    cursor: pointer;
    margin: 0 !important;
    font-weight: normal;

    input {
        cursor: pointer;
    }
}

.new_order_Form > div {
    /*padding: 10px 0;*/
    margin-bottom: 15px;
}
.lists {
    /*padding-right: 45px;*/
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
