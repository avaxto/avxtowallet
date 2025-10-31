<template>
    <modal ref="modal" :title="$t('modal.keystore.title')" class="modal_main" :can_close="false">
        <div class="update_keystore_modal_body">
            <p>{{ $t('modal.keystore.desc') }}</p>
            <ExportWallet
                v-if="!isSuccess"
                @success="success"
                :is-desc="false"
                class="export_wallet"
                ref="exportRef"
                :wallets="allWallets"
            ></ExportWallet>
            <v-btn v-else class="ava_button button_primary" @click="logout">
                {{ $t('modal.keystore.logout') }}
            </v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import Modal from '@/components/modals/Modal.vue'
import CopyText from '@/components/misc/CopyText.vue'
import ExportWallet from '@/components/wallet/manage/ExportWallet.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'

export default defineComponent({
    name: 'UpdateKeystoreModal',
    components: {
        Modal,
        CopyText,
        ExportWallet,
    },
    props: {
        phrase: {
            type: String,
            default: ''
        }
    },
    setup() {
        const store = useStore()
        const { t } = useI18n()
        
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const exportRef = ref<InstanceType<typeof ExportWallet> | null>(null)
        const isSuccess = ref(false)

        const open = (): void => {
            modal.value?.open()
        }

        const success = () => {
            exportRef.value?.clear()
            isSuccess.value = true
        }

        const logout = () => {
            store.dispatch('logout')
        }

        const allWallets = computed((): MnemonicWallet[] => {
            return store.state.wallets
        })

        onMounted(() => {
            open()
        })

        return {
            modal,
            exportRef,
            isSuccess,
            open,
            success,
            logout,
            allWallets
        }
    }
})
</script>
<style scoped lang="scss">
.update_keystore_modal_body {
    /*width: 600px;*/
    width: 400px;
    max-width: 100%;
    padding: 30px;
    /*background-color: var(--bg-light);*/
}

.export_wallet {
    margin: 30px 0;
}

.ava_button {
    display: block;
    margin: 10px auto !important;
}
</style>
