<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Sends BTC.

  The shape of this form is driven by what makes Bitcoin different from every
  other platform here: the fee is not a fixed protocol constant but a market
  rate per virtual byte, and the transaction's size depends on how many UTXOs
  get pulled in — which the user cannot predict. So the fee, input count and
  exact total are computed and shown BEFORE any password is asked for, rather
  than discovered after signing.
-->
<template>
    <div class="btc_send">
        <template v-if="!isSuccess">
            <div class="field">
                <label for="btc_to">Recipient address</label>
                <input
                    id="btc_to"
                    v-model="to"
                    class="text_in mono"
                    :placeholder="addressPlaceholder"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isSending"
                />
                <p v-if="to.trim() && !isToValid" class="hint err">
                    That is not a valid {{ networkName }} Bitcoin address.
                </p>
                <p v-else-if="recipientTypeLabel" class="hint">
                    {{ recipientTypeLabel }} address
                </p>
            </div>

            <div class="field">
                <label for="btc_amt">Amount</label>
                <div class="amount_row">
                    <input
                        id="btc_amt"
                        v-model="amount"
                        class="text_in"
                        inputmode="decimal"
                        placeholder="0.0"
                        autocomplete="off"
                        :disabled="isSending || sendMax"
                    />
                    <span class="ticker">{{ symbol }}</span>
                    <button
                        type="button"
                        class="max_but"
                        :class="{ active: sendMax }"
                        @click="toggleMax"
                        :disabled="isSending || !balanceSats"
                    >
                        Max
                    </button>
                </div>
                <p class="hint">
                    Balance {{ balanceText }} {{ symbol }}
                    <span v-if="isScanning">· scanning…</span>
                </p>
                <p v-if="amountError" class="hint err">{{ amountError }}</p>
            </div>

            <div class="field">
                <label>Fee rate</label>
                <div class="fee_grid">
                    <button
                        v-for="t in feeTargets"
                        :key="t.blocks"
                        type="button"
                        class="fee_but"
                        :class="{ active: !customFee && feeBlocks === t.blocks }"
                        :disabled="isSending"
                        @click="pickTarget(t.blocks)"
                    >
                        <span class="f_label">{{ t.label }}</span>
                        <span class="f_rate">{{ rateFor(t.blocks) }} sat/vB</span>
                        <span class="f_detail">{{ t.detail }}</span>
                    </button>
                </div>
                <label class="custom_row">
                    <input type="checkbox" v-model="customFee" :disabled="isSending" />
                    Set the rate manually
                    <input
                        v-if="customFee"
                        v-model="customRate"
                        class="text_in rate_in"
                        inputmode="decimal"
                        :disabled="isSending"
                    />
                    <span v-if="customFee" class="ticker">sat/vB</span>
                </label>
            </div>

            <!--
              The whole point of a preview: which UTXOs get spent, and so what
              the fee actually is, cannot be known until the amount is entered.
            -->
            <div v-if="preview" class="preview">
                <div class="p_row">
                    <span>Sending</span>
                    <span class="mono">{{ fmt(preview.outputSats) }} {{ symbol }}</span>
                </div>
                <div class="p_row">
                    <span>Network fee</span>
                    <span class="mono">
                        {{ fmt(preview.feeSats) }} {{ symbol }}
                        <span class="p_sub">
                            ({{ preview.feeSats.toLocaleString() }} sats ·
                            {{ preview.effectiveFeeRate.toFixed(1) }} sat/vB)
                        </span>
                    </span>
                </div>
                <div class="p_row">
                    <span>Inputs</span>
                    <span class="mono">
                        {{ preview.inputCount }} unspent output{{
                            preview.inputCount === 1 ? '' : 's'
                        }}
                        · ~{{ preview.vbytes }} vB
                    </span>
                </div>
                <div v-if="preview.changeSats > 0" class="p_row">
                    <span>Change back</span>
                    <span class="mono">{{ fmt(preview.changeSats) }} {{ symbol }}</span>
                </div>
                <div v-else class="p_row subtle">
                    <span>Change</span>
                    <span>
                        None — the remainder would be dust, so it goes to the miner instead.
                    </span>
                </div>
                <div class="p_row total">
                    <span>Total deducted</span>
                    <span class="mono">
                        {{ fmt(preview.outputSats + preview.feeSats) }} {{ symbol }}
                    </span>
                </div>
            </div>

            <p v-if="isWatchOnly" class="hint err">
                This wallet is watch-only — it holds no key and cannot send.
            </p>
            <p v-if="previewError" class="send_error">{{ previewError }}</p>
            <p v-if="sendError" class="send_error">{{ sendError }}</p>

            <v-btn
                depressed
                class="button_primary send_but"
                :loading="isSending"
                :disabled="!canSend"
                @click="send"
            >
                {{ isSending ? 'Signing and broadcasting…' : `Send ${symbol}` }}
            </v-btn>
        </template>

        <div v-else class="success">
            <p class="ok">
                <fa icon="check-circle"></fa>
                Broadcast
            </p>
            <p class="sig_label">Transaction ID</p>
            <a :href="txUrl" target="_blank" rel="noopener noreferrer" class="mono sig">
                {{ txid }}
            </a>
            <p class="hint">
                It will appear as unconfirmed until a miner includes it in a block.
            </p>
            <v-btn depressed class="button_secondary" @click="reset">Send another</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted, watch } from 'vue'
import Big from 'big.js'

import { useBitcoinStore, FEE_TARGETS } from '@/platforms/bitcoin/store'
import { useNotificationsStore } from '@/stores'
import { isValidBitcoinAddress, detectAddressType } from '@/bitcoin/keys'
import {
    ADDRESS_TYPE_INFO,
    SATS_PER_BTC,
    getBitcoinTxUrl,
} from '@/bitcoin/networks'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import type { SendPreview } from '@/platforms/bitcoin/wallet'

export default defineComponent({
    name: 'BitcoinSendForm',
    setup() {
        const btc = useBitcoinStore()
        const notifications = useNotificationsStore()

        const to = ref('')
        const amount = ref('')
        const sendMax = ref(false)
        const feeBlocks = ref<number>(6)
        const customFee = ref(false)
        const customRate = ref('10')
        const isSending = ref(false)
        const sendError = ref('')
        const txid = ref('')

        const wallet = computed(() => btc.wallet)
        const isWatchOnly = computed(() => wallet.value?.isReadonly ?? false)
        const isScanning = computed(() => btc.isScanning)
        const symbol = computed(() => btc.network.native.symbol)
        const networkName = computed(() => btc.network.name)
        const feeTargets = computed(() => FEE_TARGETS)

        const addressPlaceholder = computed(() =>
            btc.network.isTestnet ? 'tb1… / m… / 2…' : 'bc1… / 1… / 3…'
        )

        const balanceSats = computed(() => {
            void btc.scanEpoch
            return wallet.value?.balanceSats ?? 0
        })
        const balanceText = computed(
            () => Big(balanceSats.value).div(SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0'
        )

        onMounted(() => {
            void btc.refreshFeeRates()
        })
        watch(() => btc.network.id, () => btc.refreshFeeRates())

        const rateFor = (blocks: number): string => {
            const r = btc.feeRates[blocks]
            return r ? r.toFixed(r < 10 ? 1 : 0) : '—'
        }

        /** The rate a send will actually use. */
        const feeRate = computed((): number => {
            if (customFee.value) {
                const parsed = Number.parseFloat(customRate.value)
                return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
            }
            return btc.feeRates[feeBlocks.value] ?? 0
        })

        const pickTarget = (blocks: number) => {
            customFee.value = false
            feeBlocks.value = blocks
        }

        const toggleMax = () => {
            sendMax.value = !sendMax.value
            if (sendMax.value) amount.value = ''
        }

        const isToValid = computed(() => isValidBitcoinAddress(to.value, btc.network))

        const recipientTypeLabel = computed(() => {
            if (!isToValid.value) return ''
            const t = detectAddressType(to.value, btc.network)
            return t ? ADDRESS_TYPE_INFO[t].label : ''
        })

        const amountSats = computed((): number | null => {
            if (sendMax.value) return 0
            const raw = amount.value.trim()
            if (!raw) return null
            try {
                const big = Big(raw)
                if (big.lte(0)) return null
                const sats = big.times(SATS_PER_BTC)
                // More than 8 decimals cannot be represented on chain.
                if (!sats.eq(sats.round(0, 0))) return null
                return Number(sats.toFixed(0))
            } catch {
                return null
            }
        })

        const amountError = computed((): string => {
            if (sendMax.value) return ''
            const raw = amount.value.trim()
            if (!raw) return ''
            if (amountSats.value === null) {
                return 'Enter a valid amount with at most 8 decimal places.'
            }
            return ''
        })

        /**
         * Runs coin selection live so the fee and input count are visible
         * before committing. Errors here are expected during typing (an amount
         * larger than the balance, for instance), so they render as guidance
         * rather than as a failure.
         */
        const previewResult = computed((): { preview: SendPreview | null; error: string } => {
            const w = wallet.value
            if (!w || isWatchOnly.value) return { preview: null, error: '' }
            if (!isToValid.value) return { preview: null, error: '' }
            if (!sendMax.value && amountSats.value === null) return { preview: null, error: '' }
            if (feeRate.value <= 0) return { preview: null, error: '' }

            try {
                return {
                    preview: w.previewSend({
                        to: to.value,
                        amountSats: amountSats.value ?? 0,
                        feeRate: feeRate.value,
                        sendMax: sendMax.value,
                    }),
                    error: '',
                }
            } catch (e: any) {
                return { preview: null, error: e?.message ?? String(e) }
            }
        })

        const preview = computed(() => previewResult.value.preview)
        const previewError = computed(() => previewResult.value.error)

        const canSend = computed(
            () => !isSending.value && !isWatchOnly.value && preview.value !== null
        )

        const isSuccess = computed(() => txid.value !== '')
        const txUrl = computed(() =>
            txid.value ? getBitcoinTxUrl(txid.value, btc.network) : ''
        )

        const send = async () => {
            const w = wallet.value
            if (!canSend.value || !w) return

            isSending.value = true
            sendError.value = ''
            try {
                const id = await authorizeSingle(
                    w,
                    `Send ${fmt(preview.value!.outputSats)} ${symbol.value}`,
                    () =>
                        w.send({
                            to: to.value,
                            amountSats: amountSats.value ?? 0,
                            feeRate: feeRate.value,
                            sendMax: sendMax.value,
                        })
                )

                txid.value = id
                notifications.add({
                    type: 'success',
                    title: 'Broadcast',
                    message: `${fmt(preview.value?.outputSats ?? 0)} ${symbol.value} sent.`,
                })
                void btc.refreshBalance()
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                sendError.value = e?.message ?? String(e)
            } finally {
                isSending.value = false
            }
        }

        const reset = () => {
            to.value = ''
            amount.value = ''
            sendMax.value = false
            txid.value = ''
            sendError.value = ''
            void btc.refreshBalance()
        }

        const fmt = (sats: number): string =>
            Big(sats).div(SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0'

        return {
            to,
            amount,
            sendMax,
            toggleMax,
            feeBlocks,
            feeTargets,
            customFee,
            customRate,
            rateFor,
            pickTarget,
            symbol,
            networkName,
            addressPlaceholder,
            balanceSats,
            balanceText,
            isScanning,
            isToValid,
            recipientTypeLabel,
            amountError,
            preview,
            previewError,
            canSend,
            isSending,
            isWatchOnly,
            sendError,
            txid,
            txUrl,
            isSuccess,
            send,
            reset,
            fmt,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.btc_send {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 4px 0;
}

.field {
    display: flex;
    flex-direction: column;

    > label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--primary-color-light);
        margin-bottom: 8px;
    }
}

.text_in {
    background-color: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 12px;
    font-size: 14px;
    color: var(--primary-color);
    outline: none;
    width: 100%;

    &:focus {
        border-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.6;
    }
}

.mono {
    font-family: monospace;
    word-break: break-all;
}

.amount_row {
    display: flex;
    align-items: center;
    gap: 8px;

    .text_in {
        flex-grow: 1;
    }

    .ticker {
        font-size: 14px;
        color: var(--primary-color-light);
    }
}

.max_but {
    background: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--primary-color);
    cursor: pointer;

    &.active {
        border-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

.fee_grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
}

.fee_but {
    background: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    color: var(--primary-color);

    .f_label {
        display: block;
        font-size: 12px;
        font-weight: 600;
    }

    .f_rate {
        display: block;
        font-size: 12px;
        font-family: monospace;
        color: var(--primary-color);
    }

    .f_detail {
        display: block;
        font-size: 11px;
        color: var(--primary-color-light);
    }

    &.active {
        border-color: var(--secondary-color);
    }
}

.custom_row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--primary-color-light);
    margin-top: 10px;

    .rate_in {
        width: 90px;
        padding: 6px 8px;
        font-size: 13px;
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 8px 0 0;

    &.err {
        color: var(--error);
    }
}

.preview {
    background: var(--bg-light);
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 13px;

    .p_row {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 5px 0;

        > span:first-child {
            color: var(--primary-color-light);
        }

        > span:last-child {
            text-align: right;
        }

        &.subtle > span:last-child {
            color: var(--primary-color-light);
            font-size: 12px;
        }

        &.total {
            border-top: 1px solid var(--bg);
            margin-top: 6px;
            padding-top: 10px;
            font-weight: 700;
        }
    }

    .p_sub {
        color: var(--primary-color-light);
        font-size: 11px;
    }
}

.send_error {
    font-size: 13px;
    color: var(--error);
    margin: 0;
    line-height: 1.5;
}

.send_but {
    width: 100%;
}

.success {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;

    .ok {
        color: var(--success);
        font-size: 16px;
        margin: 0;
    }

    .sig_label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--primary-color-light);
        margin: 0;
    }

    .sig {
        font-size: 12px;
        color: var(--primary-color);
        text-decoration: underline;
    }
}

@include main.mobile-device {
    .fee_grid {
        grid-template-columns: 1fr;
    }
}
</style>
