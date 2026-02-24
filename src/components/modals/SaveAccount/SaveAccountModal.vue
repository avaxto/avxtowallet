<template>
    <div>
        <Modal ref="modal" :title="$t('keys.save_account.title')">
            <div class="remember_modal">
                <form @submit.prevent="submit">
                    <div class="flex-row" style="justify-content: center">
                        <Identicon :value="baseAddresses.join('')"></Identicon>
                    </div>
                    <p>{{ $t('keys.save_account.desc') }}</p>

                    <input
                        v-model="accountName"
                        :name="$t('keys.save_account.placeholder_1')"
                        placeholder="Account Name"
                        :disabled="existsInLocalStorage"
                    />
                    <input
                        type="password"
                        :placeholder="$t('keys.save_account.placeholder_2')"
                        v-model="password"
                    />
                    <input
                        type="password"
                        :placeholder="$t('keys.save_account.placeholder_3')"
                        v-model="password_confirm"
                    />
                    <p class="err">{{ err }}</p>
                    <p class="err small" style="text-align: center">
                        Clearing your browser cache will remove this account. Make sure you have
                        your
                        <b>{{ walletType == 'mnemonic' ? 'mnemonic phrase' : 'private key' }}</b>
                        saved.
                    </p>
                    <v-btn
                        class="button_primary"
                        :disabled="!canSubmit"
                        type="submit"
                        :loading="isLoading"
                    >
                        {{ $t('keys.save_account.submit') }}
                    </v-btn>
                </form>
            </div>
        </Modal>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useAccountsStore, useMainStore, useNotificationsStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import Modal from '../Modal.vue'
import { SaveAccountInput } from '@/types'
import { iUserAccountEncrypted } from '@/types'
import Identicon from '@/components/misc/Identicon.vue'

export default defineComponent({
    name: 'SaveAccountModal',
    components: {
        Identicon,
        Modal,
    },
    setup() {
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const accountsStore = useAccountsStore()
        const { t } = useI18n()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const password = ref('')
        const password_confirm = ref('')
        const isLoading = ref(false)
        const err = ref<any>('')
        const accountName = ref('')
        const existsInLocalStorage = ref(false)
        const index = ref(0)
        const foundAccount = ref<iUserAccountEncrypted | null>(null)

        const walletType = computed(() => {
            return mainStore.activeWallet.type
        })

        const error = computed(() => {
            if (!password.value) return t('keys.password_validation')
            if (!password_confirm.value) return t('keys.password_validation2')
            if (accountName.value.length < 1) return t('keys.account_name_required')
            if (password.value.length < 9) return t('keys.password_validation')
            if (password.value !== password_confirm.value) return t('keys.password_validation2')

            return null
        })

        const canSubmit = computed(() => {
            if (error.value !== null) return false
            return true
        })

        const submit = async (): Promise<void> => {
            isLoading.value = true
            const pass = password.value
            const accountNameVal = accountName.value

            const input: SaveAccountInput = {
                accountName: accountNameVal,
                password: pass,
            }
            await accountsStore.saveAccount(input)

            isLoading.value = false
            onsuccess()
        }

        const onsuccess = () => {
            notificationsStore.add({
                title: 'Account Saved',
                message: 'Your keys are now stored under a new local account.',
                type: 'info',
            })
            close()
        }

        const clear = () => {
            password.value = ''
            password_confirm.value = ''
            accountName.value = ''
            err.value = ''
        }

        const close = () => {
            clear()
            modal.value?.close()
        }

        const open = () => {
            modal.value?.open()
        }

        const baseAddresses = computed((): string[] => {
            return accountsStore.baseAddresses
        })

        return {
            modal,
            password,
            password_confirm,
            isLoading,
            err,
            accountName,
            existsInLocalStorage,
            index,
            foundAccount,
            walletType,
            canSubmit,
            error,
            submit,
            onsuccess,
            clear,
            close,
            open,
            baseAddresses
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.remember_modal {
    width: 320px;
    max-width: 100%;
    padding: 12px 30px;
}

form {
    display: flex;
    flex-direction: column;

    > * {
        margin: 6px 0px;
    }
}

input {
    background-color: var(--bg-light);
    color: var(--primary-color);
    padding: 6px 14px;
}

.cancel_but {
    color: #999;
    font-size: 0.9rem;
}

.password {
    background-color: var(--bg-light);
    color: var(--primary-color);
    padding: 6px 14px;
}

.submit {
    margin-top: 30px;
}

.err {
    color: var(--error);
}
</style>
