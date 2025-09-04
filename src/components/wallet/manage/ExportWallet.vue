<template>
    <div class="export_wallet">
        <p v-if="isDesc" class="explain">{{ $t('keys.export_key_desc') }}</p>
        <form @submit.prevent="download">
            <label>Password (min 9 characters)</label>
            <v-text-field
                type="password"
                placeholder="Password"
                v-model="pass"
                hide-details
                outlined
                dense
                class="formIn"
                height="40"
            ></v-text-field>
            <label>Confirm Password</label>
            <v-text-field
                type="password"
                placeholder="Confirm Password"
                v-model="passConfirm"
                hide-details
                outlined
                dense
                class="formIn"
                height="40"
            ></v-text-field>
            <p class="err">{{ err }}</p>
            <v-btn
                type="submit"
                :disabled="!isValid"
                :loading="isLoading"
                depressed
                block
                class="button_primary"
            >
                Export Wallet
            </v-btn>
        </form>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { ExportWalletsInput } from '@/store/types'

interface Props {
    wallets: MnemonicWallet[]
    isDesc: boolean
}

export default defineComponent({
    name: 'ExportWallet',
    props: {
        wallets: {
            type: Array as () => MnemonicWallet[],
            required: true
        },
        isDesc: {
            type: Boolean,
            default: true
        }
    },
    emits: ['success'],
    setup(props: Props, { emit }) {
        const store = useStore()
        
        const isLoading = ref(false)
        const pass = ref('')
        const passConfirm = ref('')
        const err = ref('')

        const isValid = computed((): boolean => {
            return pass.value.length >= 9 && pass.value === passConfirm.value ? true : false
        })

        const clear = () => {
            isLoading.value = false
            pass.value = ''
            passConfirm.value = ''
            err.value = ''
        }

        const download = async () => {
            isLoading.value = true
            err.value = ''

            if (!props.wallets) {
                isLoading.value = false
                err.value = 'No wallet selected.'
                return
            }

            const input: ExportWalletsInput = {
                password: pass.value,
                wallets: props.wallets,
            }
            setTimeout(() => {
                store.dispatch('exportWallets', input).then((res) => {
                    isLoading.value = false
                    pass.value = ''
                    passConfirm.value = ''
                    store.dispatch('Notifications/add', {
                        title: 'Key File Export',
                        message: 'Your keys are downloaded.',
                    })
                    emit('success')
                })
            }, 200)
        }

        return {
            isLoading,
            pass,
            passConfirm,
            err,
            isValid,
            clear,
            download
        }
    }
})
</script>
<style lang="scss">
.export_wallet {
    .formIn {
        .v-input__slot {
            background-color: var(--bg-light) !important;
        }

        .v-text-field__details {
            padding: 0;
        }

        fieldset {
            border: none;
        }
    }
}
</style>
<style lang="scss">
.export_wallet {
    fieldset {
        border: none !important;
    }
}
</style>
<style scoped lang="scss">
@use '../../../main';
@use '../../../light_theme';

.export_wallet {
    font-size: 12px;
}
.explain {
    color: var(--primary-color-light);
    margin-bottom: 20px !important;
}

label {
    color: var(--primary-color-light);
}

.formIn {
    background-color: var(--bg-light);
    font-size: 12px;
    border-radius: 2px;
}

.button_primary {
    margin-top: 10px;
}

.err {
    margin: 4px 0 !important;
    color: var(--error);
}
</style>
