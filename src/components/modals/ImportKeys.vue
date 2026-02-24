<template>
    <modal ref="modalRef" :title="title" @beforeClose="beforeClose">
        <div class="add_key_body">
            <img src="@/assets/import_key_bg.png" class="bg" />
            <p class="explain">Add additional keys to use with your wallet.</p>
            <v-tabs
                height="38"
                :grow="true"
                v-model="selectedTab"
                :show-arrows="false"
                :centered="true"
                :mobile-breakpoint="900"
            >
                <v-tab key="mnemonic">{{ $t('keys.import_key_option1') }}</v-tab>
                <v-tab key="keystore">{{ $t('keys.import_key_option2') }}</v-tab>
                <v-tab key="priv_key">{{ $t('keys.import_key_option3') }}</v-tab>
                <v-tab-item>
                    <AddMnemonic @success="handleImportSuccess" ref="mnemonicRef"></AddMnemonic>
                </v-tab-item>
                <v-tab-item>
                    <add-key-file @success="handleImportSuccess" ref="keyfileRef"></add-key-file>
                </v-tab-item>
                <v-tab-item>
                    <add-key-string @success="handleImportSuccess" ref="keyStringRef"></add-key-string>
                </v-tab-item>
            </v-tabs>
        </div>
    </modal>
</template>

<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, onMounted } from 'vue'
import { useNotificationsStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import Modal from '@/components/modals/Modal.vue'
import AddKeyFile from '@/components/wallet/manage/AddKeyFile.vue'
import AddKeyString from '@/components/wallet/manage/AddKeyString.vue'
import AddMnemonic from '@/components/wallet/manage/AddMnemonic.vue'

interface ITab {
    id: number
    name: string
}

export default defineComponent({
    name: 'ImportKeys',
    components: {
        Modal,
        AddKeyFile,
        AddKeyString,
        AddMnemonic,
    },
    setup() {
        const notificationsStore = useNotificationsStore()
        const { t } = useI18n()
        
        const modalRef = ref<Modal>()
        const keyfileRef = ref<AddKeyFile>()
        const keyStringRef = ref<AddKeyString>()
        const mnemonicRef = ref<AddMnemonic>()
        
        const title = ref('')
        const selectedTab = ref('')

        const open = () => {
            modalRef.value?.open()
            selectedTab.value = 'private' // explicitly set v-model value for modal
        }

        const beforeClose = () => {
            keyfileRef.value?.clear()
            keyStringRef.value?.clear()
            mnemonicRef.value?.clear()
        }

        const handleImportSuccess = () => {
            modalRef.value?.close()
            notificationsStore.add({
                title: t('keys.import_key_success_title'),
                message: t('keys.import_key_success_msg'),
            })
        }

        onMounted(() => {
            title.value = t('keys.import_key_title') as string
        })

        return {
            modalRef,
            keyfileRef,
            keyStringRef,
            mnemonicRef,
            title,
            selectedTab,
            open,
            beforeClose,
            handleImportSuccess
        }
    }
})
</script>

<style scoped lang="scss">
@use '../../main';

.add_key_body {
    padding: 30px;
    max-width: 450px;
    min-height: 315px;
}

.close_but {
    position: absolute;
    top: 12px;
    right: 20px;
    background-color: transparent;
    border: none;
    outline: none;
    opacity: 0.2;

    &:hover {
        opacity: 1;
    }
}

.bg {
    display: block;
    max-height: 50px;
    object-fit: contain;
    width: 100%;
    //margin: 12px auto;
}

.explain {
    text-align: center;
    margin: 14px 0 !important;
}

@include main.mobile-device {
    .add_key_body {
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
