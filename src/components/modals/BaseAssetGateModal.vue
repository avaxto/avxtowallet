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
-->
<template>
    <Modal ref="modal" title="AVXTO Burn Required" @beforeClose="onClose">
        <div class="gate_body">
            <InsufficientBalanceNotice
                :thr-value="thrValue"
                :thr-symbol="symbol"
                :thr-address="thrAddress"
                :burned-value="burnedValue"
                :burn-address="burnAddress"
                @goToSwap="goToSwap"
            ></InsufficientBalanceNotice>

            <div class="gate_actions">
                <v-btn class="ava_button button_primary" @click="goToMoats">
                    Burn {{ symbol }} on Moats
                </v-btn>
                <button class="ava_button_secondary cancel_btn" @click="cancel">Cancel</button>
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
import { MOATS_BURN_URL, useBaseAssetGate } from '@/composables/useBaseAssetGate'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'
import { useMainStore } from '@/stores'
import { activeEvmSigner } from '@/platforms/evmSigner'

export default defineComponent({
    name: 'BaseAssetGateModal',
    components: { Modal, InsufficientBalanceNotice },
    setup() {
        const router = useRouter()
        const mainStore = useMainStore()
        const { isModalOpen, closeModal, required, burned, symbol } = useBaseAssetGate()

        const modal = ref<InstanceType<typeof Modal> | null>(null)

        // Modal.vue owns its own `isActive` and exposes open()/close(), so
        // the shared flag is mirrored onto it rather than replacing it.
        watch(isModalOpen, (open) => {
            if (open) modal.value?.open()
            else modal.value?.close()
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
         * Fired by Modal's own close affordances (X, backdrop) too — both are
         * dismissals, which is `closeModal`'s default outcome.
         */
        const onClose = () => closeModal()

        const cancel = () => {
            modal.value?.close()
            closeModal('cancel')
        }

        /**
         * Not a dismissal: the user is acting on the message, so the button
         * they came from stays live for when they return having burned.
         * A new tab, not a navigation: the wallet's session is in memory only.
         */
        const goToMoats = () => {
            window.open(MOATS_BURN_URL, '_blank', 'noopener,noreferrer')
            modal.value?.close()
            closeModal('burn')
        }

        const goToSwap = () => {
            modal.value?.close()
            closeModal('swap')
            router.push('/wallet/swap')
        }

        return {
            modal,
            symbol,
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

.gate_actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 24px;

    .ava_button {
        width: 100%;
    }

    .cancel_btn {
        margin-top: 10px;
    }
}
</style>
