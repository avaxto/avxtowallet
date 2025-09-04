<template>
    <div v-if="!isLedger && wallet">
        <template v-if="account">
            <button class="account_but" @click="openSettings">
                <Identicon :value="account.baseAddresses.join('')" diameter="18"></Identicon>
                <p>{{ account.name }}</p>
            </button>
            <AccountSettingsModal ref="settingsModal"></AccountSettingsModal>
        </template>
        <template v-else>
            <SaveAccountModal ref="saveModal"></SaveAccountModal>
            <button class="save_account" @click="save">
                <fa icon="exclamation-triangle" class="volatile_alert"></fa>
                Save Account
            </button>
        </template>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'

import { iUserAccountEncrypted } from '@/store/types'
import Identicon from '@/components/misc/Identicon.vue'
import SaveAccountModal from '@/components/modals/SaveAccount/SaveAccountModal.vue'
import AccountSettingsModal from '@/components/modals/AccountSettings/AccountSettingsModal.vue'
import { WalletType } from '@/js/wallets/types'

export default defineComponent({
    name: 'AccountMenu',
    components: {
        AccountSettingsModal,
        SaveAccountModal,
        Identicon,
    },
    setup() {
        const store = useStore()
        const saveModal = ref<InstanceType<typeof SaveAccountModal>>()
        const settingsModal = ref<InstanceType<typeof AccountSettingsModal>>()

        const account = computed((): iUserAccountEncrypted | null => {
            return store.getters['Accounts/account']
        })

        const wallet = computed((): WalletType | null => {
            return store.state.activeWallet
        })

        const isLedger = computed(() => {
            let w = wallet.value
            if (!w) return false
            return w.type === 'ledger'
        })

        const openSettings = () => {
            settingsModal.value?.open()
        }

        const save = () => {
            saveModal.value?.open()
        }

        return {
            account,
            wallet,
            isLedger,
            saveModal,
            settingsModal,
            openSettings,
            save
        }
    }
})
</script>
<style scoped lang="scss">
.account_but {
    //padding: 4px 8px;
    //border-radius: 4px;
    //background-color: var(--bg-light);
    color: var(--primary-color);
    display: flex;
    flex-direction: row;
    align-items: center;
    p {
        text-align: left;
        margin-left: 8px !important;
    }

    &:hover {
        opacity: 0.5;
    }
}

.save_account {
    color: var(--warning);
    &:hover {
        opacity: 0.5;
    }
}
</style>
