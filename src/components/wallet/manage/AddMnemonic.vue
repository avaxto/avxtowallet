<template>
    <div class="add_mnemonic">
        <textarea
            v-model="phrase"
            placeholder="web  jar  rack  cereal  inherit ...."
            autocomplete="off"
            autocapitalize="off"
        ></textarea>
        <p class="err">{{ err }}</p>
        <v-btn
            :disabled="!canSubmit"
            :loading="isLoading"
            @click="access"
            class="addKeyBut button_primary ava_button"
            depressed
            block
        >
            {{ $t('keys.import_key_button') }}
        </v-btn>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import * as bip39 from 'bip39'

export default defineComponent({
    name: 'AddMnemonic',
    emits: ['success'],
    setup(_, { emit }) {
        const store = useStore()
        const { t } = useI18n()
        const phrase = ref('')
        const err = ref('')
        const isLoading = ref(false)

        const wordCount = computed((): number => {
            return phrase.value.trim().split(' ').length
        })

        const canSubmit = computed(() => {
            if (wordCount.value < 24) {
                return false
            }
            return true
        })

        const errCheck = () => {
            let phraseValue = phrase.value.trim()
            let words = phraseValue.split(' ')

            // not a valid key phrase
            if (words.length !== 24) {
                err.value =
                    'Invalid key phrase length. Your phrase must be 24 words separated by a single space.'
                return false
            }

            if (!bip39.validateMnemonic(phraseValue)) {
                err.value = 'Not a valid mnemonic phrase.'
                return false
            }

            return true
        }

        const clear = () => {
            phrase.value = ''
            err.value = ''
            isLoading.value = false
        }

        const handleImportSuccess = () => {
            phrase.value = ''
            emit('success')
        }

        const access = async () => {
            let phraseValue = phrase.value.trim()
            err.value = ''
            isLoading.value = true

            if (!errCheck()) {
                isLoading.value = false
                return
            }

            setTimeout(async () => {
                try {
                    await store.dispatch('addWalletMnemonic', phraseValue)
                    isLoading.value = false
                    handleImportSuccess()
                } catch (e) {
                    isLoading.value = false
                    if (e.message.includes('already')) {
                        err.value = t('keys.import_mnemonic_duplicate_err') as string
                    } else {
                        err.value = t('keys.import_mnemonic_err') as string
                    }
                }
            }, 500)
        }

        return {
            phrase,
            err,
            isLoading,
            wordCount,
            canSubmit,
            errCheck,
            clear,
            handleImportSuccess,
            access
        }
    }
})
</script>
<style scoped lang="scss">
.add_mnemonic {
    /*background-color: #e7e7ea;*/
    padding: 14px 0;
}

textarea {
    padding: 12px;
    font-size: 0.8rem;
    background-color: var(--bg-wallet);
    resize: none;
    width: 100%;
    height: 120px;
    margin-top: 14px;
}

.but_submit {
    margin-top: 12px;
}

.err {
    color: var(--error);
    font-size: 14px;
}
</style>
