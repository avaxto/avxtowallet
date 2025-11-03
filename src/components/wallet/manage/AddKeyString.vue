<template>
    <div>
   // QrInput component is globally registered by @avalabs/vue_components   <label>{{ $t('private_key') }}</label>
        <form @submit.prevent="addKey">
            <qr-input @change="validateQR" v-model="privateKeyInput" class="qrIn"></qr-input>
            <p class="err">{{ error }}</p>
            <v-btn
                type="submit"
                :loading="isLoading"
                :disabled="!canAdd"
                class="addKeyBut button_primary ava_button"
                depressed
                block
            >
                {{ $t('add_pk') }}
            </v-btn>
        </form>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'
// @ts-ignore
import { QrInput } from '@/vue_components'
import Spinner from '@/components/misc/Spinner.vue'

export default defineComponent({
    name: 'AddKeyString',
    components: {
        QrInput,
        Spinner,
    },
    emits: ['success'],
    setup(_, { emit }) {
        const store = useStore()
        const { t } = useI18n()
        const privateKeyInput = ref('')
        const canAdd = ref(false)
        const error = ref('')
        const isLoading = ref(false)

        const validateQR = (val: string) => {
            if (privateKeyInput.value.length > 10) {
                canAdd.value = true
            } else if (privateKeyInput.value.length === 0) {
                error.value = ''
                canAdd.value = false
            } else {
                canAdd.value = false
            }
        }

        const clear = () => {
            isLoading.value = false
            privateKeyInput.value = ''
            canAdd.value = false
            error.value = ''
        }

        const addKey = () => {
            isLoading.value = true
            error.value = ''

            setTimeout(async () => {
                try {
                    await store.dispatch('addWalletSingleton', privateKeyInput.value)
                    emit('success')
                    clear()
                } catch (e) {
                    isLoading.value = false

                    if (e.message.includes('already')) {
                        error.value = t('keys.import_key_duplicate_err') as string
                    } else {
                        error.value = t('keys.import_key_err') as string
                    }
                }
            }, 200)
        }

        return {
            privateKeyInput,
            canAdd,
            error,
            isLoading,
            validateQR,
            clear,
            addKey
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

label {
    color: #909090;
    font-size: 12px;
}

.qrIn {
    border-radius: 2px !important;
    height: 40px;
    font-size: 12px;
    background-color: #f5f6fa;
}

.err {
    color: var(--error);
}
</style>
