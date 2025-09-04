<template>
    <modal ref="modal" title="Account Settings" class="modal_main" @beforeClose="clear">
        <div class="modal_body">
            <div class="header">
                <Identicon :value="account.baseAddresses.join('')"></Identicon>
                <p style="text-align: center">{{ account.name }}</p>

                <p class="err small" style="text-align: center">
                    Clearing your browser cache will remove this account. Make sure you have your
                    <b>mnemonic phrase</b>
                    or
                    <b>private key</b>
                    saved.
                </p>
            </div>

            <div class="options" v-if="!subComponent">
                <button
                    v-if="hasVolatile"
                    @click="saveKeys"
                    class="ava_button"
                    style="color: var(--warning)"
                >
                    <fa icon="exclamation-triangle"></fa>
                    Save Keys
                </button>
                <button @click="changePassword" class="ava_button">Change Password</button>
                <button @click="deleteAccount" class="ava_button">Delete Account</button>
            </div>
            <template v-else>
                <component v-if="subComponent" :is="subComponent"></component>
                <button @click="clear">Cancel</button>
            </template>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'

import Modal from '@/components/modals/Modal.vue'
import Identicon from '@/components/misc/Identicon.vue'
import { iUserAccountEncrypted } from '@/store/types'
import ChangePassword from '@/components/modals/AccountSettings/ChangePassword.vue'
import DeleteAccount from '@/components/modals/AccountSettings/DeleteAccount.vue'
import SaveKeys from '@/components/modals/AccountSettings/SaveKeys.vue'

export default defineComponent({
    name: 'AccountSettingsModal',
    components: {
        ChangePassword,
        Identicon,
        Modal,
    },
    setup() {
        const store = useStore()
        
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const subComponent = ref<any>(null)

        const account = computed((): iUserAccountEncrypted => {
            return store.getters['Accounts/account']
        })

        const hasVolatile = computed(() => {
            return store.state.volatileWallets.length > 0
        })

        const open = () => {
            modal.value?.open()
        }

        const close = () => {
            modal.value?.close()
        }

        const clear = () => {
            subComponent.value = null
        }

        const changePassword = () => {
            subComponent.value = ChangePassword
        }

        const deleteAccount = () => {
            subComponent.value = DeleteAccount
        }

        const saveKeys = () => {
            subComponent.value = SaveKeys
        }

        return {
            modal,
            subComponent,
            account,
            hasVolatile,
            open,
            close,
            clear,
            changePassword,
            deleteAccount,
            saveKeys
        }
    }
})
</script>
<style scoped lang="scss">
.modal_body {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 320px;
    max-width: 100%;
    padding: 20px 30px;
    color: var(--primary-color);
}

.header {
    margin-bottom: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
}

.options {
    display: flex;
    flex-direction: column;

    button {
        padding: 20px 30px;
        width: 100%;
        border-top: 1px solid var(--bg-light);
    }
}
</style>
