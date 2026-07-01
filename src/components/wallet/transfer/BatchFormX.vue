<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="batch_form_x">
        <slot></slot>

        <template v-if="!isSuccess">
            <div class="recipients">
                <div
                    v-for="(row, i) in recipients"
                    :key="row.uuid"
                    class="recipient_row"
                >
                    <div class="row_top">
                        <h4>{{ $t('transfer.to') }} #{{ i + 1 }}</h4>
                        <button
                            v-if="recipients.length > 1 && !isConfirm"
                            class="remove_but"
                            @click="removeRecipient(i)"
                        >
                            <img src="@/assets/trash_can_dark.svg" />
                        </button>
                    </div>
                    <qr-input
                        v-model="row.address"
                        class="qrIn hover_border"
                        placeholder="X-..."
                        :disabled="isConfirm"
                    ></qr-input>
                    <currency-input-dropdown
                        class="cur_in"
                        :disabled="isConfirm"
                        @change="onOrderChange(i, $event)"
                    ></currency-input-dropdown>
                </div>
            </div>

            <button
                v-if="!isConfirm"
                class="add_recipient"
                @click="addRecipient"
            >
                <fa icon="plus"></fa>
                Add recipient
            </button>

            <div class="memo_cont">
                <h4 v-if="memo || !isConfirm">{{ $t('transfer.memo') }}</h4>
                <textarea
                    v-if="memo || !isConfirm"
                    class="memo"
                    maxlength="256"
                    placeholder="Memo"
                    autocomplete="off"
                    v-model="memo"
                    :disabled="isConfirm"
                ></textarea>
            </div>

            <div class="fees">
                <p>
                    {{ $t('transfer.fee_tx') }}
                    <span>{{ txFee.toLocaleString(9) }} AVAX</span>
                </p>
                <p>
                    Recipients
                    <span>{{ recipients.length }}</span>
                </p>
            </div>

            <div class="checkout">
                <ul class="err_list" v-if="formErrors.length > 0">
                    <li v-for="err in formErrors" :key="err">{{ err }}</li>
                </ul>
                <p class="err" v-if="err">{{ err }}</p>

                <template v-if="isInjectedWallet">
                    <v-btn
                        depressed
                        block
                        class="button_primary"
                        :loading="isAjax"
                        :ripple="false"
                        :disabled="!canSend || isAjax"
                        @click="sendOneClick"
                    >
                        {{ $t('transfer.send') }}
                    </v-btn>
                </template>
                <template v-else-if="!isConfirm">
                    <v-btn
                        depressed
                        block
                        class="button_primary"
                        :ripple="false"
                        :disabled="!canSend"
                        @click="confirm"
                    >
                        Confirm
                    </v-btn>
                </template>
                <template v-else>
                    <v-btn
                        depressed
                        block
                        class="button_primary"
                        :loading="isAjax"
                        :ripple="false"
                        :disabled="isAjax"
                        @click="submit"
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
            </div>
        </template>

        <template v-else>
            <BatchTxReport :results="results" title="Batch Send Report"></BatchTxReport>
            <v-btn
                depressed
                block
                class="button_primary"
                style="margin-top: 14px"
                :ripple="false"
                @click="startAgain"
            >
                Start Again
            </v-btn>
        </template>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useAssetsStore, useHistoryStore, useMainStore, useNotificationsStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import { v1 as uuidv1 } from 'uuid'
import Big from 'big.js'
import { BN, Buffer } from '@/avalanche'
import { ava, avm, isValidAddress } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import * as bip39 from 'bip39'
import { QrInput } from '@/vue_components'
import CurrencyInputDropdown from '@/components/misc/CurrencyInputDropdown.vue'
import AvaAsset from '@/js/AvaAsset'
import { ICurrencyInputDropdownValue } from '@/components/wallet/transfer/types'
import BatchTxReport, { BatchTxResult } from '@/components/wallet/transfer/BatchTxReport.vue'
import { IBatchRecipient } from '@/js/TxHelper'
import { Wallet } from '@/js/wallets/AbstractWallet'

interface BatchRowX {
    uuid: string
    address: string
    asset: AvaAsset | null
    amount: BN
}

const newRow = (): BatchRowX => ({
    uuid: uuidv1(),
    address: '',
    asset: null,
    amount: new BN(0),
})

export default defineComponent({
    name: 'BatchFormX',
    components: { QrInput, CurrencyInputDropdown, BatchTxReport },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()
        const notificationsStore = useNotificationsStore()
        const { t } = useI18n()

        const recipients = ref<BatchRowX[]>([newRow()])
        const memo = ref('')
        const isConfirm = ref(false)
        const isAjax = ref(false)
        const isSuccess = ref(false)
        const err = ref('')
        const formErrors = ref<string[]>([])
        const results = ref<BatchTxResult[]>([])

        const wallet = computed((): Wallet => mainStore.activeWallet as Wallet)
        const isInjectedWallet = computed(() => wallet.value?.type === 'injected')

        const txFee = computed((): Big => bnToBig(avm.getTxFee(), 9))

        const canSend = computed((): boolean => {
            if (recipients.value.length === 0) return false
            for (const r of recipients.value) {
                if (!r.address) return false
                if (!r.asset) return false
                if (!r.amount || r.amount.lte(new BN(0))) return false
            }
            return true
        })

        const onOrderChange = (index: number, event: ICurrencyInputDropdownValue) => {
            if (!event) return
            recipients.value[index].asset = event.asset
            recipients.value[index].amount = event.amount
        }

        const addRecipient = () => {
            recipients.value.push(newRow())
        }

        const removeRecipient = (index: number) => {
            recipients.value.splice(index, 1)
        }

        const formCheck = (): boolean => {
            const errList: string[] = []
            const hrp = ava.getHRP()

            recipients.value.forEach((r, i) => {
                const addr = r.address
                const chain = addr.split('-')
                if (chain[0] !== 'X') {
                    errList.push(`Recipient #${i + 1}: only X-Chain addresses are allowed.`)
                } else if (!isValidAddress(addr)) {
                    errList.push(`Recipient #${i + 1}: invalid address.`)
                } else if (!addr.includes(hrp)) {
                    errList.push(`Recipient #${i + 1}: not valid for this network.`)
                }
                if (!r.amount || r.amount.lte(new BN(0))) {
                    errList.push(`Recipient #${i + 1}: amount must be greater than 0.`)
                }
            })

            if (memo.value) {
                const buff = Buffer.from(memo.value)
                if (buff.length > 256) {
                    errList.push('Memo must be 256 characters or fewer.')
                }
                if (bip39.validateMnemonic(memo.value)) {
                    errList.push('You should not put a mnemonic phrase into the Memo field.')
                }
            }

            formErrors.value = errList
            return errList.length === 0
        }

        const confirm = () => {
            if (!formCheck()) return
            isConfirm.value = true
        }

        const cancelConfirm = () => {
            isConfirm.value = false
            err.value = ''
        }

        const submit = async () => {
            isAjax.value = true
            err.value = ''
            try {
                const batch: IBatchRecipient[] = recipients.value.map((r) => ({
                    address: r.address,
                    asset: { id: (r.asset as AvaAsset).id },
                    amount: r.amount,
                }))

                const memoBuf = memo.value ? Buffer.from(memo.value) : undefined
                const txId = await mainStore.issueBatchTxMulti(batch, memoBuf)

                // A single atomic tx pays every recipient; report each address
                // against the shared tx id.
                results.value = recipients.value.map((r) => ({
                    address: r.address,
                    status: 'success' as const,
                    txId,
                }))
                isSuccess.value = true

                notificationsStore.add({
                    title: t('transfer.success_title'),
                    message: t('transfer.success_msg'),
                    type: 'success',
                })

                assetsStore.updateUTXOs()
                historyStore.updateTransactionHistory()
            } catch (e: any) {
                err.value = e?.message ?? String(e)
                notificationsStore.add({
                    title: t('transfer.error_title'),
                    message: t('transfer.error_msg'),
                    type: 'error',
                })
            } finally {
                isAjax.value = false
            }
        }

        const sendOneClick = () => {
            confirm()
            if (isConfirm.value) submit()
        }

        const startAgain = () => {
            recipients.value = [newRow()]
            memo.value = ''
            isConfirm.value = false
            isSuccess.value = false
            isAjax.value = false
            err.value = ''
            formErrors.value = []
            results.value = []
        }

        return {
            recipients,
            memo,
            isConfirm,
            isAjax,
            isSuccess,
            err,
            formErrors,
            results,
            isInjectedWallet,
            txFee,
            canSend,
            onOrderChange,
            addRecipient,
            removeRecipient,
            confirm,
            cancelConfirm,
            submit,
            sendOneClick,
            startAgain,
        }
    },
})
</script>
<style scoped lang="scss">
@use '../../../main';

h4 {
    display: block;
    text-align: left;
    font-size: 12px;
    font-weight: bold;
    margin: 12px 0;
}

.recipient_row {
    background-color: var(--bg-light);
    border-radius: 4px;
    padding: 12px 14px;
    margin-bottom: 12px;
}

.row_top {
    display: flex;
    justify-content: space-between;
    align-items: center;

    h4 {
        margin: 4px 0;
    }

    .remove_but {
        height: 18px;
        opacity: 0.6;
        &:hover {
            opacity: 1;
        }
        img {
            height: 100%;
            object-fit: contain;
        }
    }
}

.cur_in {
    margin-top: 10px;
}

.add_recipient {
    width: 100%;
    border: 1px dashed var(--primary-color-light);
    padding: 8px;
    color: var(--primary-color-light);
    font-size: 14px;
    opacity: 0.5;
    transition-duration: 0.2s;
    margin-bottom: 14px;

    &:hover {
        opacity: 1;
        color: var(--primary-color);
    }
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

.fees {
    margin: 14px 0;
    border-top: 1px solid var(--bg-light);
    padding-top: 14px;

    p {
        text-align: left;
        font-size: 13px;
        color: var(--primary-color-light);
    }
    span {
        float: right;
    }
}

.err_list {
    font-size: 12px;
    color: var(--error);
    margin: 6px 0;
}

.checkout {
    margin-top: 14px;
}
</style>
