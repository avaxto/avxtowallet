<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Burn AVXTO through Moats (moats.app) — see js/MoatsBurn.ts for the
  contract flow. Burning is irreversible, so the button arms a confirmation
  step naming the exact amount rather than sending on the first click.

  Deliberately not behind useBaseAssetGate: burning requires holding AVXTO
  already, so the holding gate would only ever refuse people with nothing to
  burn — which the balance check below does with a clearer message.
-->
<template>
    <div class="moats_page">
        <h1>Burn AVXTO</h1>
        <p class="desc">
            Burn AVXTO through
            <a href="https://moats.app/" target="_blank" rel="noopener noreferrer">Moats</a>
            . Burned tokens are sent to the dead address permanently and credit burn points to
            your address. A burn also pays out any pending Moats rewards.
        </p>

        <div v-if="!signer" class="card notice">
            <p>
                No EVM wallet is connected. Connect an Avalanche wallet, or the EVM platform on
                Avalanche C-Chain, to burn AVXTO.
            </p>
        </div>

        <div v-else-if="wrongChain" class="card notice">
            <p>
                Moats burns happen on
                <strong>Avalanche C-Chain</strong>
                . Your wallet is on {{ signer.network.name }} — switch it to Avalanche C-Chain to
                continue.
            </p>
        </div>

        <template v-else>
            <div class="card">
                <div class="card_header">
                    <h2>Your AVXTO</h2>
                    <button type="button" class="refresh_btn" :disabled="loading" @click="load">
                        <fa icon="sync"></fa>
                    </button>
                </div>

                <p v-if="loadError" class="error_msg">{{ loadError }}</p>
                <div v-else class="stats">
                    <div>
                        <label>Balance</label>
                        <p class="big">{{ state ? fmt(state.balance) : '--' }} AVXTO</p>
                    </div>
                    <div>
                        <label>You have burned</label>
                        <p>{{ state ? fmt(state.userBurned) : '--' }} AVXTO</p>
                    </div>
                    <div>
                        <label>Burned on Moats by everyone</label>
                        <p>{{ state ? fmt(state.totalBurned) : '--' }} AVXTO</p>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>Burn</h2>
                <div class="field">
                    <label>Amount</label>
                    <div class="amount_row">
                        <input
                            v-model="amountText"
                            type="text"
                            inputmode="decimal"
                            placeholder="1000"
                            :disabled="isBurning || !state"
                            autocomplete="off"
                            name="moats-burn-amount"
                            data-1p-ignore
                            data-lpignore="true"
                            @input="confirming = false"
                        />
                        <button
                            type="button"
                            class="max_btn"
                            :disabled="isBurning || !state"
                            @click="setMax"
                        >
                            Max
                        </button>
                    </div>
                    <span v-if="needsApproval" class="field_hint">
                        Moats needs an allowance for this amount first — your wallet will ask for
                        an approval, then for the burn.
                    </span>
                </div>

                <p v-if="amountText && validationError" class="error_msg">
                    {{ validationError }}
                </p>

                <div v-if="confirming" class="confirm_box">
                    <p>
                        You are about to permanently destroy
                        <strong>{{ amountDisplay }} AVXTO</strong>
                        . This cannot be undone.
                    </p>
                    <div class="confirm_actions">
                        <button
                            type="button"
                            class="burn_btn danger"
                            :disabled="isBurning"
                            @click="burn"
                        >
                            <span v-if="isBurning">{{ progressText }}</span>
                            <span v-else>Burn {{ amountDisplay }} AVXTO</span>
                        </button>
                        <button
                            type="button"
                            class="cancel_btn"
                            :disabled="isBurning"
                            @click="confirming = false"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
                <button
                    v-else
                    type="button"
                    class="burn_btn"
                    :disabled="!canBurn"
                    @click="confirming = true"
                >
                    Burn AVXTO
                </button>
            </div>

            <div v-if="result" class="card result_card">
                <h2 v-if="result.offline">Burn captured for offline signing</h2>
                <h2 v-else>🔥 Burned {{ result.amount }} AVXTO</h2>
                <div v-if="result.approveTxHash" class="result_row">
                    <span class="result_label">Approval</span>
                    <a
                        v-if="!result.offline"
                        class="result_value mono"
                        :href="txUrl(result.approveTxHash)"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {{ result.approveTxHash }}
                    </a>
                    <span v-else class="result_value mono">{{ result.approveTxHash }}</span>
                </div>
                <div class="result_row">
                    <span class="result_label">Burn</span>
                    <a
                        v-if="!result.offline"
                        class="result_value mono"
                        :href="txUrl(result.burnTxHash)"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {{ result.burnTxHash }}
                    </a>
                    <span v-else class="result_value mono">{{ result.burnTxHash }}</span>
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { useNotificationsStore } from '@/stores'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { explorerTxUrl } from '@/evm/networkRegistry'
import { authorizeBatch, SessionAuthCancelled } from '@/js/security/authorize'
import {
    MOATS_CHAIN_ID,
    burnAvxto,
    formatTokenAmount,
    parseTokenAmount,
    readBurnState,
    validateBurnAmount,
    type BurnState,
} from '@/js/MoatsBurn'

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing the balance from the last visit.
    name: 'moats_burn',
    setup() {
        const notifications = useNotificationsStore()

        // Recomputed for display; `burn` resolves it ONCE and threads it
        // through, per the invariant in `@/evm/signer`.
        const signer = computed(() => activeEvmSigner())
        const wrongChain = computed(
            () => !!signer.value && signer.value.network.evmChainId !== MOATS_CHAIN_ID
        )

        const state = ref<BurnState | null>(null)
        const loading = ref(false)
        const loadError = ref('')

        const amountText = ref('')
        const confirming = ref(false)
        const isBurning = ref(false)
        const progressText = ref('')
        const result = ref<{
            amount: string
            approveTxHash: string | null
            burnTxHash: string
            offline: boolean
        } | null>(null)
        /** Pinned at submit, so the result links cannot relabel themselves. */
        const resultNetwork = ref(signer.value?.network ?? null)

        const decimals = computed(() => state.value?.decimals ?? 18)
        const fmt = (wei: any) => Number(formatTokenAmount(wei, decimals.value)).toLocaleString(
            undefined,
            { maximumFractionDigits: 6 }
        )

        const amount = computed(() => parseTokenAmount(amountText.value, decimals.value))
        const amountDisplay = computed(() =>
            amount.value ? formatTokenAmount(amount.value, decimals.value) : ''
        )
        const validationError = computed(() => {
            if (!state.value) return null
            if (amountText.value && !amount.value) return 'Enter a valid number.'
            return validateBurnAmount(amount.value, state.value)
        })
        const needsApproval = computed(
            () =>
                !!state.value &&
                !!amount.value &&
                !validationError.value &&
                state.value.allowance.lt(amount.value)
        )
        const canBurn = computed(
            () => !!state.value && !!amount.value && !validationError.value && !isBurning.value
        )

        const load = async () => {
            const s = signer.value
            if (!s || wrongChain.value) {
                state.value = null
                return
            }
            loading.value = true
            loadError.value = ''
            try {
                const next = await readBurnState(s)
                // The wallet may have changed while this was in flight.
                if (signer.value?.address === s.address) state.value = next
            } catch (e: any) {
                console.warn('[MoatsBurn] Could not read burn state:', e)
                loadError.value = 'Could not read your AVXTO balance. Try refreshing.'
            } finally {
                loading.value = false
            }
        }

        // Keyed on address + chain rather than the signer object, which is
        // rebuilt on every recompute.
        watch(
            () => `${signer.value?.address ?? ''}|${signer.value?.network.evmChainId ?? ''}`,
            () => {
                state.value = null
                confirming.value = false
                load()
            },
            { immediate: true }
        )

        const setMax = () => {
            if (!state.value) return
            amountText.value = formatTokenAmount(state.value.balance, decimals.value)
            confirming.value = false
        }

        const txUrl = (hash: string) =>
            resultNetwork.value ? explorerTxUrl(resultNetwork.value, hash) : ''

        const burn = async () => {
            const activeSigner = signer.value
            const wei = amount.value
            if (!activeSigner || !wei || !canBurn.value) return
            const shown = amountDisplay.value

            isBurning.value = true
            progressText.value = needsApproval.value
                ? 'Approve, then burn, in your wallet…'
                : 'Confirm the burn in your wallet…'
            result.value = null
            resultNetwork.value = activeSigner.network
            try {
                const res = await authorizeBatch(
                    activeSigner.authSubject,
                    `Burn ${shown} AVXTO on Moats`,
                    () => burnAvxto(activeSigner, wei)
                )
                result.value = { amount: shown, ...res }
                amountText.value = ''
                confirming.value = false
                notifications.add({
                    type: 'success',
                    title: res.offline ? 'Burn Captured' : 'AVXTO Burned',
                    message: res.offline
                        ? 'The burn was captured for offline signing.'
                        : `${shown} AVXTO burned on Moats.`,
                })
                if (!res.offline) await load()
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                console.error('Moats burn failed', e)
                notifications.add({
                    type: 'error',
                    title: 'Burn Failed',
                    message: e?.message || 'Could not burn AVXTO. Nothing was burned.',
                })
                // An approval may have landed even though the burn did not.
                await load()
            } finally {
                isBurning.value = false
            }
        }

        return {
            signer,
            wrongChain,
            state,
            loading,
            loadError,
            amountText,
            amountDisplay,
            confirming,
            isBurning,
            progressText,
            result,
            validationError,
            needsApproval,
            canBurn,
            fmt,
            load,
            setMax,
            burn,
            txUrl,
        }
    },
})
</script>

<style lang="scss" scoped>
.moats_page {
    max-width: 640px;

    h1 {
        margin-bottom: 8px;
    }

    .desc {
        color: var(--primary-color-light);
        margin-bottom: 24px;
        line-height: 1.5;

        a {
            color: var(--secondary-color);
        }
    }
}

.card {
    background: var(--bg-light);
    border: 1px solid var(--bg-light);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
    // Bootstrap's own `.card` sets `color: var(--bs-body-color)` (#212529),
    // so without this every figure inside inherits near-black on the dark
    // card. The scoped selector outranks Bootstrap's bare class.
    color: var(--primary-color);

    h2 {
        margin: 0 0 16px;
        font-size: 18px;
    }
}

.card_header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;

    .refresh_btn {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--primary-color-light);

        &:disabled {
            opacity: 0.4;
        }
    }
}

.notice p {
    color: var(--primary-color-light);
    line-height: 1.5;
}

.stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 16px;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }

    p {
        margin: 4px 0 0;
        font-size: 15px;
        word-break: break-all;
    }

    .big {
        font-size: 22px;
        font-weight: 600;
    }
}

.field {
    display: flex;
    flex-direction: column;
    margin-bottom: 16px;

    label {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--primary-color);
    }

    .field_hint {
        font-size: 12px;
        color: var(--primary-color-light);
        margin-top: 6px;
    }
}

.amount_row {
    display: flex;
    gap: 8px;

    input {
        flex: 1;
        min-width: 0;
        background: var(--bg);
        border: 1px solid var(--bg-light);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 15px;
        color: var(--primary-color);

        &:focus {
            outline: none;
            border-color: var(--secondary-color);
        }

        &:disabled {
            opacity: 0.6;
        }
    }
}

.max_btn,
.cancel_btn {
    border: 1px solid var(--bg-light);
    background: var(--bg);
    border-radius: 8px;
    padding: 0 14px;
    font-size: 13px;
    cursor: pointer;
    color: var(--primary-color);

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.burn_btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--secondary-color);
    // See the identical note in Launcher.vue on `--platform-on-accent`.
    color: var(--platform-on-accent, #fff) !important;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;

    &.danger {
        background: #e53935;
        color: #fff !important;
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.confirm_box {
    border: 1px solid #e53935;
    border-radius: 8px;
    padding: 16px;

    p {
        margin: 0 0 12px;
        line-height: 1.5;
    }

    .confirm_actions {
        display: flex;
        gap: 8px;

        .burn_btn {
            flex: 1;
        }

        .cancel_btn {
            padding: 0 18px;
        }
    }
}

.error_msg {
    margin: 4px 0 12px;
    font-size: 13px;
    color: #f44336;
}

.result_card {
    border-color: #4caf50;

    .result_row {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
        flex-wrap: wrap;
    }

    .result_label {
        font-size: 13px;
        font-weight: 600;
        min-width: 70px;
    }

    .result_value {
        font-size: 13px;
        word-break: break-all;
        flex: 1;
        color: var(--secondary-color);
    }

    .mono {
        font-family: monospace;
    }
}
</style>
