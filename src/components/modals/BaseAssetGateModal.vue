<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The holding requirement, asked at the moment of a gated action instead of
  at the door.

  Mounted once, in the wallet layout — the modal's open state lives in
  composables/useBaseAssetGate, shared module-level, so every gated button on
  every page raises this same instance rather than each page carrying its own
  copy.

  Two ways out, and they are the two the user actually has: Cancel leaves
  them exactly where they were (the button behind this is disabled by then,
  since the check that opened this modal is what taught `isGated` the
  answer), or they go to /wallet/swap — deliberately ungated — and trade for
  the base asset.
-->
<template>
    <Modal ref="modal" title="AVXTO Required" @beforeClose="onClose">
        <div class="gate_body">
            <InsufficientBalanceNotice
                :thr-value="thrValue"
                :thr-symbol="thrSymbol"
                :thr-address="thrAddress"
                :c-chain-address="cChainAddress"
                @goToSwap="goToSwap"
            ></InsufficientBalanceNotice>

            <div class="gate_actions">
                <v-btn class="ava_button button_primary" @click="goToSwap">
                    Swap for {{ thrSymbol }}
                </v-btn>
                <button class="ava_button_secondary cancel_btn" @click="cancel">Cancel</button>
            </div>
        </div>
    </Modal>
</template>

<script lang="ts">
import { computed, defineComponent, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import Modal from '@/components/modals/Modal.vue'
import InsufficientBalanceNotice from '@/components/misc/InsufficientBalanceNotice.vue'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import { useMainStore } from '@/stores'

export default defineComponent({
    name: 'BaseAssetGateModal',
    components: { Modal, InsufficientBalanceNotice },
    setup() {
        const router = useRouter()
        const mainStore = useMainStore()
        const { isModalOpen, closeModal, baseAsset } = useBaseAssetGate()

        const modal = ref<InstanceType<typeof Modal> | null>(null)

        // Modal.vue owns its own `isActive` and exposes open()/close(), so
        // the shared flag is mirrored onto it rather than replacing it.
        watch(isModalOpen, (open) => {
            if (open) modal.value?.open()
            else modal.value?.close()
        })

        // Read live off the store rather than from the sessionStorage the
        // standalone /insufficient-balance page uses — inside the wallet
        // there is a session, so these are simply known.
        const thrValue = computed(() => baseAsset.value?.thr?.toString() ?? '')
        const thrSymbol = computed(() => baseAsset.value?.symbol ?? 'AVXTO')
        const thrAddress = computed(() => baseAsset.value?.address ?? '')
        const cChainAddress = computed(() => {
            const eth = mainStore.activeWallet?.ethAddress
            return eth ? '0x' + eth : ''
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
         * they came from stays live for when they return holding some.
         */
        const goToSwap = () => {
            modal.value?.close()
            closeModal('swap')
            router.push('/wallet/swap')
        }

        return {
            modal,
            thrValue,
            thrSymbol,
            thrAddress,
            cChainAddress,
            onClose,
            cancel,
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
