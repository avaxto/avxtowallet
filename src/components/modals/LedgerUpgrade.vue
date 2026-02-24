<template>
    <modal ref="modal" :title="$t('modal.ledger_upgrade.title')" @beforeClose="beforeClose">
        <div class="ledger_block">
            <ol>
                <li>Connect the ledger device to your computer.</li>
                <li>Enter your PIN and access your device.</li>
                <li>
                    Ensure you have installed the
                    <b>Avalanche App v{{ minV }}</b>
                    or above and open it on your device.
                </li>
            </ol>
            <p style="margin-top: 12px !important">
                <small>
                    If you do not have the Avalanche app on your ledger, please add it through the
                    <a href="https://www.ledger.com/ledger-live/download" target="_blank">
                        Ledger Live
                    </a>
                    app manager. The minimum version required to use the app is version {{ minV }},
                    more instructions can be found
                    <a
                        target="_blank"
                        href="https://support.avax.network/en/articles/6150237-how-to-use-a-ledger-nano-s-or-nano-x-with-avalanche"
                    >
                        here
                    </a>
                    .
                </small>
            </p>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount } from 'vue'
import { useLedgerStore, useMainStore } from '@/stores'
import { WalletType } from '@/js/wallets/types'

import Modal from './Modal.vue'
import { MIN_LEDGER_V } from '@/js/wallets/constants'

export default defineComponent({
    name: 'LedgerUpgrade',
    components: {
        Modal,
    },
    setup() {
        const mainStore = useMainStore()
        const ledgerStore = useLedgerStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)

        const open = () => {
            modal.value?.open()
        }

        const close = () => {
            modal.value?.close()
        }

        const beforeClose = () => {
            ledgerStore.setIsUpgradeRequired(false)
        }

        const minV = computed(() => {
            return MIN_LEDGER_V
        })

        const isActive = computed(() => {
            return ledgerStore.isUpgradeRequired
        })

        const wallet = computed(() => {
            return mainStore.activeWallet as WalletType
        })

        // Watch isActive for changes
        watch(isActive, (val: boolean) => {
            if (!modal.value) return
            if (val) {
                open()
            } else {
                close()
            }
        }, { immediate: true })

        onBeforeUnmount(() => {
            ledgerStore.setIsUpgradeRequired(false)
        })

        return {
            modal,
            open,
            close,
            beforeClose,
            minV,
            isActive,
            wallet
        }
    }
})
</script>
<style scoped lang="scss">
.ledger_block {
    padding: 30px;
    max-width: 450px;
}

.ledger_block > div {
    text-align: center;
}
</style>
