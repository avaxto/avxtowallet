<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="batch_form_c">
        <slot></slot>

        <template v-if="!isSuccess">
            <div class="recipients">
                <div v-for="(row, i) in recipients" :key="row.uuid" class="recipient_row">
                    <div class="row_top">
                        <h4>{{ $t('transfer.to') }} #{{ i + 1 }}</h4>
                        <button
                            v-if="recipients.length > 1 && !isSending"
                            class="remove_but"
                            @click="removeRecipient(i)"
                        >
                            <img src="@/assets/trash_can_dark.svg" />
                        </button>
                    </div>
                    <qr-input
                        v-model="row.address"
                        class="qrIn hover_border"
                        placeholder="0x..."
                        :disabled="isSending"
                    ></qr-input>
                    <EVMInputDropdown
                        class="cur_in"
                        :disabled="isSending"
                        :gas-price="gasPrice"
                        :gas-limit="21000"
                        @amountChange="onAmountChange(i, $event)"
                        @tokenChange="onTokenChange(i, $event)"
                        @collectibleChange="onCollectibleChange(i, $event)"
                    ></EVMInputDropdown>
                </div>
            </div>

            <button v-if="!isSending" class="add_recipient" @click="addRecipient">
                <fa icon="plus"></fa>
                Add recipient
            </button>

            <div class="fees">
                <p>
                    {{ $t('transfer.c_chain.gasPrice') }}
                    <span>{{ gasPriceGwei }} nAVAX</span>
                </p>
                <p>
                    Recipients
                    <span>{{ recipients.length }}</span>
                </p>
                <p class="note">
                    Each recipient is sent as a separate transaction (one signature per send).
                </p>
            </div>

            <div class="checkout">
                <ul class="err_list" v-if="formErrors.length > 0">
                    <li v-for="e in formErrors" :key="e">{{ e }}</li>
                </ul>
                <p class="err" v-if="err">{{ err }}</p>
                <v-btn
                    depressed
                    block
                    class="button_primary"
                    :loading="isSending"
                    :ripple="false"
                    :disabled="!canSend || isSending"
                    @click="submit"
                >
                    <template v-if="isSending">
                        Sending {{ sentCount }} / {{ recipients.length }}...
                    </template>
                    <template v-else>{{ $t('transfer.send') }}</template>
                </v-btn>
            </div>
        </template>

        <template v-else>
            <BatchTxReport
                :results="results"
                title="Batch Send Report"
                :explorer-base="explorerBase"
            ></BatchTxReport>
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
import { defineComponent, ref, computed, onMounted, onBeforeUnmount, markRaw } from 'vue'
import { useMainStore } from '@/stores'
import { v1 as uuidv1 } from 'uuid'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { GasHelper } from '@/avalanche-wallet-sdk'
import { WalletHelper } from '@/helpers/wallet_helper'
import { QrInput } from '@/vue_components'
import EVMInputDropdown from '@/components/misc/EVMInputDropdown/EVMInputDropdown.vue'
import Erc20Token from '@/js/Erc20Token'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import BatchTxReport, { BatchTxResult } from '@/components/wallet/transfer/BatchTxReport.vue'

interface BatchRowC {
    uuid: string
    address: string
    token: Erc20Token | 'native'
    amount: BN
    isCollectible: boolean
}

const newRow = (): BatchRowC => ({
    uuid: uuidv1(),
    address: '',
    token: 'native',
    amount: new BN(0),
    isCollectible: false,
})

const isEvmAddress = (addr: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(addr)

export default defineComponent({
    name: 'BatchFormC',
    components: { QrInput, EVMInputDropdown, BatchTxReport },
    setup() {
        const mainStore = useMainStore()

        const recipients = ref<BatchRowC[]>([newRow()])
        const gasPrice = ref(markRaw(new BN(225000000000)))
        const gasPriceGwei = ref(225)
        const gasInterval = ref<ReturnType<typeof setInterval> | undefined>(undefined)

        const isSending = ref(false)
        const isSuccess = ref(false)
        const sentCount = ref(0)
        const err = ref('')
        const formErrors = ref<string[]>([])
        const results = ref<BatchTxResult[]>([])

        const wallet = computed(() => mainStore.activeWallet as any)

        // Tx ids render as plain text (empty base). A C-chain explorer path can
        // be supplied here later if a per-network URL becomes available.
        const explorerBase = ''

        const updateGasPrice = async () => {
            try {
                const price = await GasHelper.getAdjustedGasPrice()
                gasPrice.value = markRaw(price)
                gasPriceGwei.value = price.div(new BN(1000000000)).toNumber()
            } catch (e) {
                /* keep last known gas price */
            }
        }

        onMounted(() => {
            updateGasPrice()
            gasInterval.value = setInterval(() => {
                if (!isSending.value) updateGasPrice()
            }, 15000)
        })

        onBeforeUnmount(() => {
            if (gasInterval.value) clearInterval(gasInterval.value)
        })

        const canSend = computed((): boolean => {
            if (recipients.value.length === 0) return false
            for (const r of recipients.value) {
                if (r.isCollectible) return false
                if (!isEvmAddress(r.address)) return false
                if (!r.amount || r.amount.lte(new BN(0))) return false
            }
            return true
        })

        const onAmountChange = (i: number, val: BN) => {
            recipients.value[i].amount = markRaw(val)
        }
        const onTokenChange = (i: number, token: Erc20Token | 'native') => {
            recipients.value[i].token = token
            recipients.value[i].isCollectible = false
        }
        const onCollectibleChange = (i: number, _val: iErc721SelectInput | null) => {
            // Collectibles aren't supported in batch send.
            recipients.value[i].isCollectible = true
        }

        const addRecipient = () => recipients.value.push(newRow())
        const removeRecipient = (i: number) => recipients.value.splice(i, 1)

        const formCheck = (): boolean => {
            const errList: string[] = []
            recipients.value.forEach((r, i) => {
                if (r.isCollectible) {
                    errList.push(`Recipient #${i + 1}: collectibles are not supported in batch send.`)
                    return
                }
                if (!isEvmAddress(r.address)) {
                    errList.push(`Recipient #${i + 1}: invalid C-Chain (0x) address.`)
                }
                if (!r.amount || r.amount.lte(new BN(0))) {
                    errList.push(`Recipient #${i + 1}: amount must be greater than 0.`)
                }
            })
            formErrors.value = errList
            return errList.length === 0
        }

        const submit = async () => {
            if (!formCheck()) return
            isSending.value = true
            err.value = ''
            sentCount.value = 0
            const out: BatchTxResult[] = []

            const w = wallet.value
            const fromAddr = '0x' + w.getEvmAddress()

            // Assign explicit, sequential nonces so back-to-back sends don't
            // race on the provider's nonce. Only advance the nonce on a
            // successful send to avoid leaving a stuck gap.
            let nonce: number
            try {
                nonce = await web3.eth.getTransactionCount(fromAddr, 'pending')
            } catch (e) {
                nonce = await web3.eth.getTransactionCount(fromAddr)
            }

            for (const r of recipients.value) {
                try {
                    let gasLimit = 21000
                    if (r.token !== 'native' && r.token instanceof Erc20Token) {
                        try {
                            gasLimit = await w.estimateGas(r.address, r.amount, r.token)
                        } catch (e) {
                            gasLimit = 100000
                        }
                    }

                    let hash: string
                    if (r.token !== 'native' && r.token instanceof Erc20Token) {
                        hash = await WalletHelper.sendErc20(
                            w,
                            r.address,
                            r.amount,
                            gasPrice.value,
                            gasLimit,
                            r.token,
                            nonce
                        )
                    } else {
                        hash = await WalletHelper.sendEth(
                            w,
                            r.address,
                            r.amount,
                            gasPrice.value,
                            gasLimit,
                            nonce
                        )
                    }

                    out.push({ address: r.address, status: 'success', txId: hash })
                    nonce += 1
                    sentCount.value += 1
                } catch (e: any) {
                    out.push({
                        address: r.address,
                        status: 'error',
                        error: e?.message ?? String(e),
                    })
                }
            }

            results.value = out
            isSending.value = false
            isSuccess.value = true
        }

        const startAgain = () => {
            recipients.value = [newRow()]
            isSending.value = false
            isSuccess.value = false
            sentCount.value = 0
            err.value = ''
            formErrors.value = []
            results.value = []
        }

        return {
            recipients,
            gasPrice,
            gasPriceGwei,
            isSending,
            isSuccess,
            sentCount,
            err,
            formErrors,
            results,
            explorerBase,
            canSend,
            onAmountChange,
            onTokenChange,
            onCollectibleChange,
            addRecipient,
            removeRecipient,
            submit,
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
    .note {
        font-size: 12px;
        margin-top: 8px;
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
