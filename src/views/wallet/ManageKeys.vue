<template>
    <div>
        <div>
            <div class="card_body">
                <header>
                    <h1>{{ $t('keys.title') }}</h1>
                    <div class="button_container" v-if="canEncryptWallet">
                        <button
                            v-if="!account"
                            @click="openSaveAccount"
                            class="save_account ava_button_secondary"
                        >
                            <fa icon="exclamation-triangle"></fa>
                            {{ $t('keys.button1') }}
                        </button>
                        <button
                            v-if="hasVolatile && account"
                            @click="openAccountSettings"
                            class="save_account ava_button_secondary"
                        >
                            <fa icon="exclamation-triangle"></fa>
                            {{ $t('keys.button1') }}
                        </button>
                        <button class="but_primary ava_button_secondary" @click="exportKeys">
                            <fa icon="upload"></fa>
                            {{ $t('keys.button3') }}
                        </button>
                        <SaveAccountModal ref="account_modal"></SaveAccountModal>
                        <AccountSettingsModal ref="account_settings"></AccountSettingsModal>
                        <ExportKeys ref="export" :wallets="allWallets"></ExportKeys>
                    </div>
                </header>
                <my-keys></my-keys>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'
import MyKeys from '@/components/wallet/manage/MyKeys.vue'
import ImportKeys from '@/components/modals/ImportKeys.vue'
import ExportKeys from '@/components/modals/ExportKeys.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import SaveAccountModal from '@/components/modals/SaveAccount/SaveAccountModal.vue'

import { WalletNameType } from '@/js/wallets/types'
import { iUserAccountEncrypted } from '@/store/types'
import AccountSettingsModal from '@/components/modals/AccountSettings/AccountSettingsModal.vue'

export default defineComponent({
    name: 'manage',
    components: {
        AccountSettingsModal,
        MyKeys,
        ImportKeys,
        ExportKeys,
        SaveAccountModal,
    },
    setup() {
        const store = useStore()

        const importRef = ref<InstanceType<typeof ImportKeys>>()
        const exportRef = ref<InstanceType<typeof ExportKeys>>()
        const account_modal = ref<InstanceType<typeof SaveAccountModal>>()
        const account_settings = ref<InstanceType<typeof AccountSettingsModal>>()

        const account = computed(() => {
            return store.getters['Accounts/account']
        })

        const importKeys = () => {
            importRef.value?.open()
        }

        const exportKeys = () => {
            exportRef.value?.open()
        }

        const openSaveAccount = () => {
            account_modal.value?.open()
        }

        const openAccountSettings = () => {
            account_settings.value?.open()
        }

        const canEncryptWallet = computed(() => {
            return ['mnemonic', 'singleton'].includes(walletType.value)
        })

        const walletType = computed((): WalletNameType => {
            return store.state.activeWallet.type
        })

        const hasVolatile = computed(() => {
            return store.state.volatileWallets.length > 0
        })

        const allWallets = computed((): MnemonicWallet[] => {
            return store.state.wallets
        })

        const warnUpdateKeyfile = computed(() => {
            return store.state.warnUpdateKeyfile
        })

        return {
            import: importRef,
            export: exportRef,
            account_modal,
            account_settings,
            account,
            importKeys,
            exportKeys,
            openSaveAccount,
            openAccountSettings,
            canEncryptWallet,
            walletType,
            hasVolatile,
            allWallets,
            warnUpdateKeyfile
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.button_container {
    display: flex;
    flex-direction: row;
    align-items: center;
}
header {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

h1 {
    font-weight: lighter;
}

.save_account {
    color: var(--warning);
}

@include main.mobile-device {
    header {
        display: block;
    }

    .button_container {
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        /*flex-wrap: wrap;*/

        button {
            padding: 8px 0;
        }
    }
}
</style>
