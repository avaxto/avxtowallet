<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Burn, stake or lock AVXTO through Moats (moats.app) — the route component
  for /wallet/moats/burn, /stake and /lock, which pass `mode`. See
  js/Moats.ts for the contract flow; the actions differ in wording, which
  stats are shown, the contract function called, and (lock only) a duration.

  The button arms a confirmation step naming the exact amount rather than
  sending on the first click: a burn cannot be undone, a stake costs the
  unstake fee to get back out, and leaving a lock early costs up to 95%.

  Deliberately not behind useBaseAssetGate, and it must never be: that gate
  requires a Moats burn, so gating the burn page would lock out the one way
  to meet it.
-->
<template>
    <div class="moats_page">
        <h1>{{ copy.title }}</h1>
        <p class="desc">
            {{ copy.verb }} AVXTO through
            <a href="https://moats.app/" target="_blank" rel="noopener noreferrer">Moats</a>
            . {{ copy.explainer }} It also pays out any pending Moats rewards.
        </p>

        <div v-if="!signer" class="card notice">
            <p>
                No EVM wallet is connected. Connect an Avalanche wallet, or the EVM platform on
                Avalanche C-Chain, to {{ mode }} AVXTO.
            </p>
        </div>

        <div v-else-if="wrongChain" class="card notice">
            <p>
                Moats is on
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
                    <div v-for="stat in stats" :key="stat.label">
                        <label>{{ stat.label }}</label>
                        <p>{{ state ? fmt(stat.value) : '--' }} AVXTO</p>
                    </div>
                </div>

                <div v-if="mode === 'lock' && state && state.userLocks.length" class="locks">
                    <label>Your active locks</label>
                    <div v-for="lock in state.userLocks" :key="lock.index" class="lock_row">
                        <span>{{ fmt(lock.amount) }} AVXTO</span>
                        <span class="lock_meta">
                            {{ lockMultiplierText(lock.originalDuration) }} ·
                            {{ lock.end * 1000 <= now ? 'unlocked' : `unlocks ${formatDate(lock.end)}` }}
                        </span>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2>{{ copy.verb }}</h2>
                <div class="field">
                    <label>Amount</label>
                    <div class="amount_row">
                        <input
                            v-model="amountText"
                            type="text"
                            inputmode="decimal"
                            placeholder="1000"
                            :disabled="isSending || !state"
                            autocomplete="off"
                            :name="`moats-${mode}-amount`"
                            data-1p-ignore
                            data-lpignore="true"
                            @input="confirming = false"
                        />
                        <button
                            type="button"
                            class="max_btn"
                            :disabled="isSending || !state"
                            @click="setMax"
                        >
                            Max
                        </button>
                    </div>
                    <span v-if="needsApproval" class="field_hint">
                        Moats needs an allowance for this amount first — your wallet will ask for
                        an approval, then for the {{ mode }}.
                    </span>
                    <span v-if="mode === 'stake' && unstakeFeeText" class="field_hint">
                        Unstaking later costs a {{ unstakeFeeText }} fee.
                    </span>
                </div>

                <div v-if="mode === 'lock'" class="field">
                    <label>Lock for (days)</label>
                    <div class="amount_row">
                        <input
                            v-model.number="lockDays"
                            type="number"
                            :min="minLockDays"
                            :max="maxLockDays"
                            step="1"
                            :disabled="isSending || !state"
                            autocomplete="off"
                            name="moats-lock-days"
                            data-1p-ignore
                            data-lpignore="true"
                            @input="confirming = false"
                        />
                    </div>
                    <div class="presets">
                        <button
                            v-for="p in lockPresets"
                            :key="p.days"
                            type="button"
                            class="preset_btn"
                            :class="{ selected: lockDays === p.days }"
                            :disabled="isSending || !state"
                            @click="pickLockDays(p.days)"
                        >
                            {{ p.label }}
                        </button>
                    </div>
                    <span v-if="!lockDaysError" class="field_hint">
                        {{ lockMultiplierText(lockDays * daySeconds) }} points · unlocks
                        {{ formatDate(unlockAt) }}. Leaving early costs up to 95%, shrinking as the
                        end date nears.
                    </span>
                </div>

                <p v-if="amountText && validationError" class="error_msg">
                    {{ validationError }}
                </p>
                <p v-if="lockDaysError" class="error_msg">{{ lockDaysError }}</p>

                <div v-if="confirming" class="confirm_box" :class="mode">
                    <p v-if="mode === 'burn'">
                        You are about to permanently destroy
                        <strong>{{ amountDisplay }} AVXTO</strong>
                        . This cannot be undone.
                    </p>
                    <p v-else-if="mode === 'lock'">
                        You are about to lock
                        <strong>{{ amountDisplay }} AVXTO</strong>
                        for
                        <strong>{{ lockDays }} {{ lockDays === 1 ? 'day' : 'days' }}</strong>
                        , until {{ formatDate(unlockAt) }}. Leaving before then costs up to
                        <strong>95%</strong>
                        of it — that much if you leave right away, less as the end date nears.
                        <template v-if="unstakeFeeText">
                            Exiting after it ends costs a {{ unstakeFeeText }} fee.
                        </template>
                    </p>
                    <p v-else>
                        You are about to stake
                        <strong>{{ amountDisplay }} AVXTO</strong>
                        in Moats.
                        <template v-if="unstakeFeeText">
                            Getting it back out costs a {{ unstakeFeeText }} unstake fee.
                        </template>
                    </p>
                    <div class="confirm_actions">
                        <button
                            type="button"
                            class="action_btn"
                            :class="{ danger: mode !== 'stake' }"
                            :disabled="isSending"
                            @click="send"
                        >
                            <span v-if="isSending">{{ progressText }}</span>
                            <span v-else>{{ copy.verb }} {{ amountDisplay }} AVXTO</span>
                        </button>
                        <button
                            type="button"
                            class="cancel_btn"
                            :disabled="isSending"
                            @click="confirming = false"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
                <button
                    v-else
                    type="button"
                    class="action_btn"
                    :disabled="!canSend"
                    @click="confirming = true"
                >
                    {{ copy.verb }} AVXTO
                </button>
            </div>

            <div v-if="result" class="card result_card">
                <h2 v-if="result.offline">{{ copy.verb }} captured for offline signing</h2>
                <h2 v-else>{{ copy.done }} {{ result.amount }} AVXTO</h2>
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
                    <span class="result_label">{{ copy.verb }}</span>
                    <a
                        v-if="!result.offline"
                        class="result_value mono"
                        :href="txUrl(result.actionTxHash)"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {{ result.actionTxHash }}
                    </a>
                    <span v-else class="result_value mono">{{ result.actionTxHash }}</span>
                </div>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, type PropType } from 'vue'
import { useNotificationsStore } from '@/stores'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { explorerTxUrl } from '@/evm/networkRegistry'
import { authorizeBatch, SessionAuthCancelled } from '@/js/security/authorize'
import {
    DAY_SECONDS,
    MAX_LOCK_DAYS,
    MIN_LOCK_DAYS,
    MOATS_CHAIN_ID,
    formatTokenAmount,
    lockMultiplier,
    validateLockDays,
    parseTokenAmount,
    readMoatsState,
    runMoatsAction,
    validateMoatsAmount,
    type MoatsMode,
    type MoatsResult,
    type MoatsState,
} from '@/js/Moats'

const COPY: Record<MoatsMode, { title: string; verb: string; done: string; explainer: string }> = {
    burn: {
        title: 'Burn AVXTO',
        verb: 'Burn',
        done: '🔥 Burned',
        explainer:
            'Burned tokens are sent to the dead address permanently and credit burn points to your address.',
    },
    stake: {
        title: 'Stake AVXTO',
        verb: 'Stake',
        done: 'Staked',
        explainer:
            'Staked tokens stay in the Moats contract and earn staking points for your address until you unstake them.',
    },
    lock: {
        title: 'Lock AVXTO',
        verb: 'Lock',
        done: 'Locked',
        explainer:
            'Locked tokens stay in the Moats contract until the lock ends and earn 2x to 5x points, more the longer you lock.',
    },
}

const LOCK_PRESETS = [
    { days: 30, label: '30 days' },
    { days: 90, label: '90 days' },
    { days: 180, label: '6 months' },
    { days: 365, label: '1 year' },
    { days: MAX_LOCK_DAYS, label: '2 years (5x)' },
]

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing the balance from the last visit.
    name: 'MoatsAction',
    props: {
        mode: { type: String as PropType<MoatsMode>, required: true },
    },
    setup(props) {
        const notifications = useNotificationsStore()
        const copy = computed(() => COPY[props.mode])

        // Recomputed for display; `send` resolves it ONCE and threads it
        // through, per the invariant in `@/evm/signer`.
        const signer = computed(() => activeEvmSigner())
        const wrongChain = computed(
            () => !!signer.value && signer.value.network.evmChainId !== MOATS_CHAIN_ID
        )

        const state = ref<MoatsState | null>(null)
        const loading = ref(false)
        const loadError = ref('')

        const amountText = ref('')
        const confirming = ref(false)
        const isSending = ref(false)
        const progressText = ref('')
        const result = ref<(MoatsResult & { amount: string }) | null>(null)
        /** Pinned at submit, so the result links cannot relabel themselves. */
        const resultNetwork = ref(signer.value?.network ?? null)

        const decimals = computed(() => state.value?.decimals ?? 18)
        const fmt = (wei: any) =>
            Number(formatTokenAmount(wei, decimals.value)).toLocaleString(undefined, {
                maximumFractionDigits: 6,
            })

        const stats = computed(() => {
            const s = state.value
            if (props.mode === 'burn') {
                return [
                    { label: 'You have burned', value: s?.userBurned },
                    { label: 'Burned on Moats by everyone', value: s?.totalBurned },
                ]
            }
            if (props.mode === 'lock') {
                return [
                    { label: 'You have locked', value: s?.userLocked },
                    { label: 'Locked on Moats by everyone', value: s?.totalLocked },
                ]
            }
            return [
                { label: 'You have staked', value: s?.userStaked },
                { label: 'Staked on Moats by everyone', value: s?.totalStaked },
            ]
        })

        // Lock only. Defaults to the maximum, which is what moats.app itself
        // offers first and the only duration that earns the full 5x.
        const lockDays = ref<number>(MAX_LOCK_DAYS)
        const lockDaysError = computed(() =>
            props.mode === 'lock' ? validateLockDays(Number(lockDays.value)) : null
        )
        /** Read once per render for the "unlocks …" labels; not a live clock. */
        const now = Date.now()
        const unlockAt = computed(() => Math.floor(now / 1000) + lockDays.value * DAY_SECONDS)
        const pickLockDays = (days: number) => {
            lockDays.value = days
            confirming.value = false
        }
        const lockMultiplierText = (durationSec: number) =>
            `${lockMultiplier(durationSec).toFixed(2).replace(/\.?0+$/, '')}x`
        const formatDate = (unixSec: number) =>
            new Date(unixSec * 1000).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            })

        /** "0.5%", from basis points; empty when there is no fee. */
        const unstakeFeeText = computed(() => {
            const bps = state.value?.unstakeFeeBps ?? 0
            return bps > 0 ? `${bps / 100}%` : ''
        })

        const amount = computed(() => parseTokenAmount(amountText.value, decimals.value))
        const amountDisplay = computed(() =>
            amount.value ? formatTokenAmount(amount.value, decimals.value) : ''
        )
        const validationError = computed(() => {
            if (!state.value) return null
            if (amountText.value && !amount.value) return 'Enter a valid number.'
            return validateMoatsAmount(props.mode, amount.value, state.value)
        })
        const needsApproval = computed(
            () =>
                !!state.value &&
                !!amount.value &&
                !validationError.value &&
                state.value.allowance.lt(amount.value)
        )
        const canSend = computed(
            () =>
                !!state.value &&
                !!amount.value &&
                !validationError.value &&
                !lockDaysError.value &&
                !isSending.value
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
                const next = await readMoatsState(s)
                // The wallet may have changed while this was in flight.
                if (signer.value?.address === s.address) state.value = next
            } catch (e: any) {
                console.warn('[Moats] Could not read state:', e)
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

        const send = async () => {
            const activeSigner = signer.value
            const wei = amount.value
            const mode = props.mode
            const verb = copy.value.verb
            const days = Number(lockDays.value)
            if (!activeSigner || !wei || !canSend.value) return
            const shown = amountDisplay.value

            isSending.value = true
            progressText.value = needsApproval.value
                ? `Approve, then ${mode}, in your wallet…`
                : `Confirm the ${mode} in your wallet…`
            result.value = null
            resultNetwork.value = activeSigner.network
            try {
                const res = await authorizeBatch(
                    activeSigner.authSubject,
                    `${verb} ${shown} AVXTO on Moats`,
                    () => runMoatsAction(activeSigner, mode, wei, { lockDays: days })
                )
                result.value = { amount: shown, ...res }
                amountText.value = ''
                confirming.value = false
                notifications.add({
                    type: 'success',
                    title: res.offline ? `${verb} Captured` : `AVXTO ${copy.value.done.replace(/^\W+/, '')}`,
                    message: res.offline
                        ? `The ${mode} was captured for offline signing.`
                        : `${shown} AVXTO ${copy.value.done.replace(/^\W+/, '').toLowerCase()} on Moats.`,
                })
                if (!res.offline) await load()
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                console.error(`Moats ${mode} failed`, e)
                notifications.add({
                    type: 'error',
                    title: `${verb} Failed`,
                    message: e?.message || `Could not ${mode} AVXTO.`,
                })
                // An approval may have landed even though the action did not.
                await load()
            } finally {
                isSending.value = false
            }
        }

        return {
            copy,
            signer,
            wrongChain,
            state,
            stats,
            loading,
            loadError,
            amountText,
            amountDisplay,
            confirming,
            isSending,
            progressText,
            result,
            validationError,
            needsApproval,
            canSend,
            unstakeFeeText,
            lockDays,
            lockDaysError,
            lockPresets: LOCK_PRESETS,
            minLockDays: MIN_LOCK_DAYS,
            maxLockDays: MAX_LOCK_DAYS,
            daySeconds: DAY_SECONDS,
            now,
            unlockAt,
            pickLockDays,
            lockMultiplierText,
            formatDate,
            fmt,
            load,
            setMax,
            send,
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

.action_btn {
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
    border: 1px solid var(--secondary-color);

    // Red for the two that cost dearly to undo: a burn cannot be, and a
    // lock left early forfeits up to 95%.
    &.burn,
    &.lock {
        border-color: #e53935;
    }

    border-radius: 8px;
    padding: 16px;

    p {
        margin: 0 0 12px;
        line-height: 1.5;
    }

    .confirm_actions {
        display: flex;
        gap: 8px;

        .action_btn {
            flex: 1;
        }

        .cancel_btn {
            padding: 0 18px;
        }
    }
}

.presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
}

.preset_btn {
    border: 1px solid var(--bg);
    background: var(--bg);
    border-radius: 16px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
    color: var(--primary-color);

    &.selected {
        border-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.locks {
    margin-top: 16px;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }

    .lock_row {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        padding: 6px 0;
        border-bottom: 1px solid var(--bg);
        font-size: 14px;
    }

    .lock_meta {
        color: var(--primary-color-light);
        font-size: 13px;
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
