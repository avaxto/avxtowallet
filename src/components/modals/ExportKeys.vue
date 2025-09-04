<template>
    <modal ref="modal" :title="title" @beforeClose="beforeClose">
        <div class="export_body">
            <p class="selection_num">
                {{ $t('keys.export_key_info', [wallets.length]) }}
            </p>
            <export-wallet
                @success="handleExportSuccess"
                :wallets="wallets"
                ref="exportRef"
            ></export-wallet>
        </div>
    </modal>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/modals/Modal.vue'
import ExportWallet from '@/components/wallet/manage/ExportWallet.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'

export default defineComponent({
    name: 'ExportKeys',
    components: {
        Modal,
        ExportWallet,
    },
    props: {
        wallets: {
            type: Array as () => MnemonicWallet[],
            required: true
        }
    },
    setup(props) {
        const { t } = useI18n()
        
        const modal = ref<InstanceType<typeof Modal>>()
        const exportRef = ref<InstanceType<typeof ExportWallet>>()
        const isActive = ref(false)
        const title = ref('Export Keys')

        const beforeClose = () => {
            if (exportRef.value) {
                exportRef.value.clear()
            }
        }

        const open = () => {
            if (modal.value) {
                modal.value.open()
            }
        }

        const close = () => {
            isActive.value = false
        }

        const handleExportSuccess = () => {
            if (modal.value) {
                modal.value.close()
            }
            close()
        }

        return {
            modal,
            exportRef,
            isActive,
            title,
            beforeClose,
            open,
            close,
            handleExportSuccess
        }
    }
})
</script>

<style scoped lang="scss">
@use '../../main';

.export_body {
    padding: 30px;
    width: 100%;
    max-width: 450px;
    min-height: 315px;
}

.selection_num {
    color: var(--primary-color);
    text-align: center;
    font-weight: bold;
    font-size: 14px;
    padding-bottom: 14px;
}

.explain {
    text-align: center;
}

@include main.mobile-device {
    .export_body {
        max-width: 100%;
    }
}
</style>

<style lang="scss">
@use '../../main';

.v-tab.v-tab {
    font-weight: 700;
}

.v-tabs-slider-wrapper {
    color: main.$secondary-color;
    caret-color: main.$secondary-color;
    height: 3px !important;
}
</style>
