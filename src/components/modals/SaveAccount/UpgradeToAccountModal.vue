<template>
    <Modal ref="modal" :can_close="false" :title="$t('modal.activateWallet.title')">
        <div class="remember_modal">
            <p>{{ $t('modal.activateWallet.desc') }}</p>
            <form @submit.prevent="onsubmit" autocomplete="off">
                <input type="password" placeholder="Password" v-model="password" class="password" />
                <p class="err">{{ err }}</p>
                <v-btn
                    type="submit"
                    :loading="isLoading"
                    depressed
                    class="ava_button button_primary submit"
                >
                    {{ $t('modal.activateWallet.submit') }}
                </v-btn>
                <button @click="cancel" class="cancel_but ava_button_secondary">
                    {{ $t('modal.activateWallet.cancel') }}
                    <br />
                    {{ $t('modal.activateWallet.cancel2') }}
                </button>
            </form>
        </div>
    </Modal>
</template>
<script lang="ts">
import { defineComponent, ref, watch, onMounted } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import Modal from '../Modal.vue'
import {
    AllKeyFileDecryptedTypes,
    AllKeyFileTypes,
    KeyFileDecryptedV6,
    KeystoreFileKeyType,
} from '@/js/IKeystore'
import {
    extractKeysFromDecryptedFile,
    KEYSTORE_VERSION,
    makeKeyfile,
    readKeyFile,
} from '@/js/Keystore'
import MnemonicWallet from '../../../js/wallets/MnemonicWallet'
import { SingletonWallet } from '../../../js/wallets/SingletonWallet'
import { SaveAccountInput } from '@/store/types'

export default defineComponent({
    name: 'UpgradeToAccountModal',
    components: { Modal },
    setup() {
        const store = useStore()
        const { t } = useI18n()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const password = ref('')
        const isLoading = ref(false)
        const err = ref('')

        const openIfValid = () => {
            const w = localStorage.getItem('w')
            if (w) {
                open()
            }
        }

        const onsubmit = async () => {
            isLoading.value = true
            err.value = ''
            const w = localStorage.getItem('w')
            if (!w) return
            const pass = password.value
            const fileData: AllKeyFileTypes = JSON.parse(w)
            try {
                const keyFile: AllKeyFileDecryptedTypes = await readKeyFile(fileData, pass)
                isLoading.value = false
                const accessInput = extractKeysFromDecryptedFile(keyFile)
                await store.dispatch('accessWalletMultiple', {
                    keys: accessInput,
                    activeIndex: keyFile.activeIndex,
                })

                // If they are using an old keystore version upgrade to a new one
                // if (keyFile.version !== KEYSTORE_VERSION) {
                //     let wallets = store.state.wallets as MnemonicWallet[]
                //     let wallet = store.state.activeWallet as
                //         | MnemonicWallet
                //         | SingletonWallet
                //         | null
                //     if (!wallet) throw new Error('No active wallet.')
                //     let activeIndex = wallets.findIndex((w) => w.id == wallet!.id)
                //     let file = await makeKeyfile(wallets, pass, activeIndex)
                //     let fileString = JSON.stringify(file)
                //     localStorage.setItem('w', fileString)
                // }

                // Save the wallets to an account using the same password
                const accountIn: SaveAccountInput = {
                    password: pass,
                    accountName: 'Account 1',
                }
                await store.dispatch('Accounts/saveAccount', accountIn)

                // Wont be using this anymore
                localStorage.removeItem('w')

                // These are not volatile wallets since they are loaded from storage
                store.state.volatileWallets = []
                password.value = ''
                close()
            } catch (e) {
                isLoading.value = false
                if (e === 'INVALID_PASS') {
                    err.value = t('modal.activateWallet.err1') as string
                } else {
                    err.value = t('modal.activateWallet.err2') as string
                }
                return
            }
        }

        const cancel = () => {
            localStorage.removeItem('w')
            close()
        }

        const close = () => {
            modal.value?.close()
        }

        const open = () => {
            modal.value?.open()
        }

        // Watch store auth state
        watch(() => store.state.isAuth, (val: boolean) => {
            if (!val) {
                openIfValid()
            }
        })

        onMounted(() => {
            openIfValid()
        })

        return {
            modal,
            password,
            isLoading,
            err,
            onsubmit,
            cancel,
            close,
            open
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';
.remember_modal {
    padding: 30px;
}
form {
    display: flex;
    flex-direction: column;
    > * {
        margin: 6px 0px;
    }
}
.cancel_but {
    color: var(--primary-color-light);
    font-size: 0.8rem !important;
    text-transform: none !important;
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
