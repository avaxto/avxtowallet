<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The Moats burn requirement, asked at the moment of a gated action instead
  of at the door.

  Mounted once, in the wallet layout — the modal's open state lives in
  composables/useBaseAssetGate, shared module-level, so every gated button on
  every page raises this same instance rather than each page carrying its own
  copy.

  The ways out are the ones the user actually has: Cancel leaves them exactly
  where they were (the button behind this is disabled by then, since the
  check that opened this modal is what taught `isGated` the answer); "Burn on
  Moats" opens moats.app in a new tab, leaving the wallet — and its
  in-memory session — where it is; or, from the notice, the deliberately
  ungated /wallet/swap to get AVXTO to burn.

  And the shortest one, at the top: a single button preset to exactly the
  AVXTO still missing, which burns it on Moats from this wallet (the wallet
  still asks for its own approval — that is the confirmation). Offered only
  when it can work: a C-Chain signer whose address IS the one the gate
  checks — a burn from any other address would not count — holding enough.
  Once it lands, the gated action the user clicked carries on by itself.
-->
<template>
    <Modal ref="modal" title="AVXTO Burn Required" @beforeClose="onClose">
        <div class="gate_body">
            <div class="quick_burn">
                <!--
                  A plain <button>, not <v-btn class="button_primary">: that
                  pairing's disabled state is light-grey text on a near-white
                  fill, faded again by Vuetify's own disabled overlay, and
                  `:loading` swaps the label for a spinner — the amount, the
                  one thing this button exists to show, was unreadable in
                  exactly the states it spends most time in. Colours below
                  are set for every state.
                -->
                <button
                    type="button"
                    class="quick_burn_btn"
                    :disabled="!!quickBurnBlocker || isBurning"
                    @click="quickBurn"
                >
                    <template v-if="isBurning">Burning {{ burnAmountText }} {{ symbol }}…</template>
                    <template v-else>🔥 Burn {{ burnAmountText }} {{ symbol }} now</template>
                </button>
                <p v-if="isBurning" class="quick_note">
                    {{ needsApproval ? 'Approve, then burn, in your wallet…' : 'Confirm the burn in your wallet…' }}
                </p>
                <p v-else-if="quickBurnError" class="quick_note error">{{ quickBurnError }}</p>
                <p v-else-if="quickBurnBlocker" class="quick_note">{{ quickBurnBlocker }}</p>
                <p v-else class="quick_note">
                    Burns exactly what is missing from this wallet on Moats, in one step.
                </p>
            </div>

            <InsufficientBalanceNotice
                :thr-value="thrValue"
                :thr-symbol="symbol"
                :thr-address="thrAddress"
                :burned-value="burnedValue"
                :burn-address="burnAddress"
                @goToSwap="goToSwap"
            ></InsufficientBalanceNotice>

            <div class="gate_actions">
                <v-btn class="ava_button_secondary moats_btn" :disabled="isBurning" @click="goToMoats">
                    Burn {{ symbol }} on moats.app instead
                </v-btn>
                <button class="ava_button_secondary cancel_btn" :disabled="isBurning" @click="cancel">
                    Cancel
                </button>
            </div>
        </div>
    </Modal>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import Big from 'big.js'

import Modal from '@/components/modals/Modal.vue'
import InsufficientBalanceNotice from '@/components/misc/InsufficientBalanceNotice.vue'
import {
    MOATS_BURN_URL,
    REQUIRED_BURN_WEI,
    useBaseAssetGate,
} from '@/composables/useBaseAssetGate'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import { BN } from '@/avalanche'
import { useMainStore, useNotificationsStore } from '@/stores'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { authorizeBatch, SessionAuthCancelled } from '@/js/security/authorize'
import {
    MOATS_CHAIN_ID,
    formatTokenAmount,
    readMoatsState,
    runMoatsAction,
    validateMoatsAmount,
    type MoatsState,
} from '@/js/Moats'

export default defineComponent({
    name: 'BaseAssetGateModal',
    components: { Modal, InsufficientBalanceNotice },
    setup() {
        const router = useRouter()
        const mainStore = useMainStore()
        const notifications = useNotificationsStore()
        const gate = useBaseAssetGate()
        const { isModalOpen, closeModal, required, burned, symbol } = gate

        const modal = ref<InstanceType<typeof Modal> | null>(null)

        // ── One-click burn ──
        const signer = computed(() => activeEvmSigner())
        /** The signer's balance, allowance and Moats flags, read when the modal opens. */
        const walletState = ref<MoatsState | null>(null)
        const isBurning = ref(false)
        const quickBurnError = ref('')

        /** Exactly what is missing, in wei; the full requirement when nothing is known. */
        const burnWei = computed((): BN => {
            const b = burned.value
            const left = b ? REQUIRED_BURN_WEI.sub(b) : REQUIRED_BURN_WEI
            return left.gtn(0) ? left : REQUIRED_BURN_WEI
        })
        const burnAmountText = computed(() =>
            Number(formatTokenAmount(burnWei.value, 18)).toLocaleString('en-US', {
                maximumFractionDigits: 6,
            })
        )
        const needsApproval = computed(
            () => !!walletState.value && walletState.value.allowance.lt(burnWei.value)
        )

        /** Why the one-click burn cannot run from here, or null when it can. */
        const quickBurnBlocker = computed((): string | null => {
            const s = signer.value
            if (!s) return 'Connect an Avalanche or EVM wallet to burn from here.'
            if (s.network.evmChainId !== MOATS_CHAIN_ID) {
                return `Switch your wallet from ${s.network.name} to Avalanche C-Chain to burn from here.`
            }
            // Only burns from the checked address count; burning from another
            // would spend the tokens and leave the gate exactly where it was.
            if (s.address.toLowerCase() !== gate.address.value) {
                return 'This tab\'s wallet is not the one the requirement is checked against — switch to the Avalanche tab to burn from it.'
            }
            const state = walletState.value
            if (!state) return 'Reading your AVXTO balance…'
            if (state.balance.lt(burnWei.value)) {
                const short = formatTokenAmount(burnWei.value.sub(state.balance), 18)
                return `You hold ${Number(formatTokenAmount(state.balance, 18)).toLocaleString('en-US')} ${symbol}. Get ${Number(short).toLocaleString('en-US')} more first — see below.`
            }
            return validateMoatsAmount('burn', burnWei.value, state)
        })

        // Leaves `quickBurnError` alone: it also runs right after a failed
        // burn, whose error must stay on screen. Opening clears it instead.
        const loadWalletState = async () => {
            walletState.value = null
            const s = signer.value
            if (!s || s.network.evmChainId !== MOATS_CHAIN_ID) return
            try {
                const next = await readMoatsState(s)
                if (signer.value?.address === s.address) walletState.value = next
            } catch (e) {
                console.warn('[BaseAssetGateModal] Could not read the wallet for a quick burn:', e)
                quickBurnError.value = 'Could not read your AVXTO balance.'
            }
        }

        const quickBurn = async () => {
            // Resolved once and threaded through, per the invariant in @/evm/signer.
            const s = signer.value
            const wei = burnWei.value
            if (!s || quickBurnBlocker.value || isBurning.value) return
            const shown = burnAmountText.value

            isBurning.value = true
            quickBurnError.value = ''
            try {
                const res = await authorizeBatch(s.authSubject, `Burn ${shown} ${symbol} on Moats`, () =>
                    runMoatsAction(s, 'burn', wei)
                )
                if (res.offline) {
                    quickBurnError.value =
                        'The burn was captured for offline signing, not sent — nothing is unlocked until it is broadcast.'
                    return
                }
                notifications.add({
                    type: 'success',
                    title: 'AVXTO Burned',
                    message: `${shown} ${symbol} burned on Moats.`,
                })
                // Hands the decision back to gatedAction, which re-reads the
                // burn and runs the action the user clicked if it now passes.
                closeModal('burned')
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                console.error('Quick burn failed', e)
                quickBurnError.value = e?.message || 'The burn did not go through. Nothing was burned.'
                // An approval may have landed even though the burn did not.
                void loadWalletState()
            } finally {
                isBurning.value = false
            }
        }

        // Modal.vue owns its own `isActive` and exposes open()/close(), so
        // the shared flag is mirrored onto it rather than replacing it.
        watch(isModalOpen, (open) => {
            if (open) {
                modal.value?.open()
                quickBurnError.value = ''
                void loadWalletState()
            } else {
                modal.value?.close()
            }
        })

        const thrValue = computed(() => required.value.toString())
        const thrAddress = AVXTO_CONTRACT_ADDRESS
        /** Whole tokens, from the check that just opened this modal. */
        const burnedValue = computed(() =>
            burned.value ? Big(burned.value.toString()).div(Big(10).pow(18)).toString() : ''
        )
        /** The address the gate checked — the one whose burns count. */
        const burnAddress = computed(() => {
            const eth = mainStore.avalancheWallet?.ethAddress
            if (eth) return eth.startsWith('0x') ? eth : '0x' + eth
            return activeEvmSigner()?.address ?? ''
        })

        /**
         * Fired by Modal's own close affordances (X, backdrop) — both are
         * dismissals, which is `closeModal`'s default outcome.
         *
         * Also fired by every programmatic `modal.close()`, since Modal emits
         * `beforeClose` from inside it. So the buttons below never close the
         * Modal themselves: they settle their outcome FIRST through
         * `closeModal`, and the `isModalOpen` watcher then closes the Modal,
         * whose `beforeClose` lands here with nothing left to settle. Closing
         * the Modal first — as this used to — settled every exit as a
         * dismissal, so leaving for moats.app or the swap page greyed out the
         * button behind it.
         */
        const onClose = () => closeModal()

        const cancel = () => closeModal('cancel')

        /**
         * Not a dismissal: the user is acting on the message, so the button
         * they came from stays live for when they return having burned.
         * A new tab, not a navigation: the wallet's session is in memory only.
         */
        const goToMoats = () => {
            window.open(MOATS_BURN_URL, '_blank', 'noopener,noreferrer')
            closeModal('burn')
        }

        const goToSwap = () => {
            closeModal('swap')
            router.push('/wallet/swap')
        }

        return {
            modal,
            symbol,
            burnAmountText,
            needsApproval,
            quickBurnBlocker,
            quickBurnError,
            isBurning,
            quickBurn,
            thrValue,
            thrAddress,
            burnedValue,
            burnAddress,
            onClose,
            cancel,
            goToMoats,
            goToSwap,
        }
    },
})
</script>

<style scoped lang="scss">
.gate_body {
    padding: 24px 30px 30px;
    max-width: 520px;
    width: 100%;
}

.quick_burn {
    margin-bottom: 22px;
    padding-bottom: 20px;
    border-bottom: 1px solid var(--bg);
    text-align: center;

    .quick_burn_btn {
        width: 100%;
        padding: 12px 16px;
        border: 1px solid var(--secondary-color);
        border-radius: 6px;
        background-color: var(--secondary-color);
        // See the note on `.button_secondary` in _main.scss: a platform accent
        // can be light enough to need dark text. !important because `body`
        // forces --primary-color with !important.
        color: var(--platform-on-accent, #fff) !important;
        font-family: 'DM Sans', sans-serif;
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.3px;
        cursor: pointer;
        transition: opacity 0.15s;

        &:hover:not(:disabled) {
            opacity: 0.85;
        }

        // Still legible: the amount is worth reading even when the line
        // below explains why it cannot be burned from here yet.
        &:disabled {
            background-color: var(--bg);
            border-color: var(--primary-color-light);
            color: var(--primary-color) !important;
            cursor: not-allowed;
        }
    }

    .quick_note {
        margin-top: 8px !important;
        font-size: 13px;
        color: var(--primary-color-light);

        &.error {
            color: var(--error);
        }
    }
}

.gate_actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 24px;

    .ava_button {
        width: 100%;
    }

    .moats_btn {
        width: 100%;
    }

    .cancel_btn {
        margin-top: 10px;
    }
}
</style>
