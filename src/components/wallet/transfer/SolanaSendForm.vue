<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Sends SOL.

  Separate from FormC.vue rather than another branch inside it: that form is
  built around EVM mechanics — gas price and limit, nonce, an ERC-20 dropdown,
  the web3 singleton — none of which exist on Solana, where the fee is a flat
  per-signature amount and the failure modes are entirely different (rent
  exemption, blockhash expiry). Reusing it would mean threading "which chain am
  I?" through every field.

  SPL token transfers are deliberately not offered yet: sending one needs the
  recipient's associated token account, created and funded by the sender when
  it does not exist. That is a materially different transaction with its own
  cost the user has to consent to, so it belongs in its own flow rather than
  hidden behind an asset dropdown.
-->
<template>
    <div class="sol_send">
        <template v-if="!isSuccess">
            <div class="field">
                <label for="sol_to">Recipient address</label>
                <input
                    id="sol_to"
                    v-model="to"
                    class="text_in mono"
                    placeholder="Solana address"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isSending"
                />
                <p v-if="to.trim() && !isToValid" class="hint err">
                    That is not a valid Solana address.
                </p>
            </div>

            <div class="field">
                <label for="sol_amt">Amount</label>
                <div class="amount_row">
                    <input
                        id="sol_amt"
                        v-model="amount"
                        class="text_in"
                        inputmode="decimal"
                        placeholder="0.0"
                        autocomplete="off"
                        :disabled="isSending"
                    />
                    <span class="ticker">{{ symbol }}</span>
                    <button
                        type="button"
                        class="max_but"
                        @click="setMax"
                        :disabled="isSending || !balance.gt(0)"
                    >
                        Max
                    </button>
                </div>
                <p class="hint">
                    Balance {{ formatSol(balance) }} {{ symbol }}
                    <span class="fee_note">· network fee ≈ {{ formatSol(feeEstimate) }} {{ symbol }}</span>
                </p>
                <p v-if="amountError" class="hint err">{{ amountError }}</p>
            </div>

            <p v-if="isWatchOnly" class="hint err">
                This wallet is watch-only — it holds no key and cannot send.
            </p>

            <p v-if="sendError" class="send_error">{{ sendError }}</p>

            <v-btn
                depressed
                class="button_primary send_but"
                :loading="isSending"
                :disabled="!canSend"
                @click="send"
            >
                {{ isSending ? 'Sending…' : `Send ${symbol}` }}
            </v-btn>
        </template>

        <div v-else class="success">
            <p class="ok">
                <fa icon="check-circle"></fa>
                Sent
            </p>
            <p class="sig_label">Transaction signature</p>
            <a
                v-if="explorerUrl"
                :href="explorerUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="mono sig"
            >
                {{ signature }}
            </a>
            <span v-else class="mono sig">{{ signature }}</span>
            <v-btn depressed class="button_secondary" @click="reset">Send another</v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted } from 'vue'
import Big from 'big.js'

import { useSolanaStore } from '@/platforms/solana/store'
import { useNotificationsStore } from '@/stores'
import { isValidSolanaAddress } from '@/solana/keys'
import { getSolanaTxUrl, LAMPORTS_PER_SOL } from '@/solana/networks'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { WatchSolanaWallet } from '@/platforms/solana/wallet'

/** Solana's base fee is 5000 lamports per signature; a transfer has one. */
const FEE_LAMPORTS = 5000

export default defineComponent({
    name: 'SolanaSendForm',
    setup() {
        const solanaStore = useSolanaStore()
        const notifications = useNotificationsStore()

        const to = ref('')
        const amount = ref('')
        const isSending = ref(false)
        const sendError = ref('')
        const signature = ref('')

        const wallet = computed(() => solanaStore.wallet)
        const isWatchOnly = computed(() => wallet.value instanceof WatchSolanaWallet)
        const symbol = computed(() => solanaStore.network.native.symbol)
        const balance = computed(() => solanaStore.nativeBalance)
        const isLoadingBalance = computed(() => solanaStore.isLoadingBalance)
        const feeEstimate = computed(() => Big(FEE_LAMPORTS).div(LAMPORTS_PER_SOL))

        onMounted(() => {
            void solanaStore.refreshNativeBalance()
        })

        const isToValid = computed(() => isValidSolanaAddress(to.value))

        const parsedAmount = computed((): Big | null => {
            const raw = amount.value.trim()
            if (!raw) return null
            try {
                return Big(raw)
            } catch {
                return null
            }
        })

        const amountError = computed((): string => {
            const raw = amount.value.trim()
            if (!raw) return ''
            const amt = parsedAmount.value
            if (!amt) return 'Enter a number.'
            if (amt.lte(0)) return 'Enter an amount greater than zero.'
            // 9 decimals is the full lamport resolution; more cannot be
            // represented on chain, so say so rather than silently rounding.
            const decimals = (raw.split('.')[1] ?? '').length
            if (decimals > 9) return 'SOL amounts cannot have more than 9 decimal places.'
            // The balance starts at zero and is filled in asynchronously, so
            // checking it mid-load would flag every amount as unaffordable
            // while the first read is still in flight. The wallet re-checks
            // against the chain before signing regardless (assertCanAfford in
            // platforms/solana/wallet.ts), so skipping it here loses nothing.
            if (!isLoadingBalance.value && amt.plus(feeEstimate.value).gt(balance.value)) {
                return 'Not enough SOL to cover this amount plus the fee.'
            }
            return ''
        })

        const canSend = computed(
            () =>
                !isSending.value &&
                !isWatchOnly.value &&
                isToValid.value &&
                !!parsedAmount.value &&
                !amountError.value
        )

        /**
         * Fills in everything sendable — balance minus the fee.
         *
         * Not the raw balance: a send of exactly the balance always fails,
         * because the fee has to come from somewhere.
         */
        const setMax = () => {
            const spendable = balance.value.minus(feeEstimate.value)
            amount.value = spendable.gt(0) ? spendable.toFixed(9).replace(/\.?0+$/, '') : '0'
        }

        const isSuccess = computed(() => signature.value !== '')

        const explorerUrl = computed(() =>
            signature.value ? getSolanaTxUrl(signature.value, solanaStore.network) : ''
        )

        const send = async () => {
            const w = wallet.value
            const amt = parsedAmount.value
            if (!canSend.value || !w || !amt) return

            isSending.value = true
            sendError.value = ''
            try {
                // Routed through the same authorization gate every other
                // platform's signing uses. A LocalSolanaWallet has a vault and
                // so prompts for the session password; an injected wallet is
                // externally authorized and passes straight through, with the
                // extension doing the prompting instead.
                const sig = await authorizeSingle(w, `Send ${amt.toString()} ${symbol.value}`, () =>
                    w.sendSol(to.value, amt)
                )

                signature.value = sig
                notifications.add({
                    type: 'success',
                    title: 'Sent',
                    message: `${amt.toString()} ${symbol.value} sent.`,
                })
                void solanaStore.refreshNativeBalance()
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
            signature.value = ''
            sendError.value = ''
            void solanaStore.refreshNativeBalance()
        }

        const formatSol = (v: Big): string => {
            const s = v.toFixed(9).replace(/\.?0+$/, '')
            return s === '' || s === '-' ? '0' : s
        }

        return {
            to,
            amount,
            symbol,
            balance,
            feeEstimate,
            isToValid,
            amountError,
            canSend,
            isSending,
            isWatchOnly,
            sendError,
            signature,
            isSuccess,
            explorerUrl,
            send,
            reset,
            setMax,
            formatSol,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.sol_send {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 4px 0;
}

.field {
    display: flex;
    flex-direction: column;

    label {
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
    border: none;
    border-radius: 4px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--primary-color);
    cursor: pointer;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 8px 0 0;

    &.err {
        color: var(--error);
    }

    .fee_note {
        opacity: 0.8;
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
    }

    a.sig {
        text-decoration: underline;
    }
}
</style>
