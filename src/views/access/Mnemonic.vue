<template>
    <div class="mnemonic_auth notranslate" translate="no">
        <div class="left">
            <header>
                <h1>{{ $t('access.mnemonic.title') }}</h1>
            </header>
            <p>Your mnemonic phrase is 24 words seperated by an empty space.</p>
            <input
                type="password"
                ref="mnemonic_in"
                placeholder="Type your mnemonic phrase"
                autocomplete="off"
                autocapitalize="off"
            />

            <div class="session_pw">
                <h4>Session password</h4>
                <p class="session_pw_desc">
                    Encrypts your phrase and keys while the wallet is open, and
                    authorizes each transaction. It is never stored — you will
                    be asked for it again every time you sign, and it cannot be
                    recovered if forgotten.
                </p>
                <input
                    type="password"
                    ref="session_pw_in"
                    v-model="sessionPassword"
                    placeholder="Choose a session password"
                    autocomplete="new-password"
                />
                <input
                    type="password"
                    ref="session_pw_confirm_in"
                    v-model="sessionPasswordConfirm"
                    placeholder="Confirm session password"
                    autocomplete="new-password"
                />
            </div>

            <div class="button_container">
                <p class="err" v-if="err">{{ err }}</p>
                <button
                    class="ava_button but_primary button_primary access"
                    @click="access"
                    :disabled="isLoading"
                >
                    <span v-if="isLoading">Loading...</span>
                    <span v-else>{{ $t('access.mnemonic.submit') }}</span>
                </button>
                <router-link to="/access" class="link">
                    {{ $t('access.mnemonic.cancel') }}
                </router-link>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import * as bip39 from 'bip39'
import MnemonicPasswordInput from '@/components/misc/MnemonicPasswordInput.vue'

const WALLET_LOADING_TIMEOUT = 500

export default defineComponent({
    name: 'Mnemonic',
    components: {
        MnemonicPasswordInput,
    },
    setup() {
        const mainStore = useMainStore()
        const { t } = useI18n()
        
        const isLoading = ref<boolean>(false)
        const err = ref<string>('')
        const canSubmit = ref<boolean>(false)
        const mnemonic_in = ref<HTMLInputElement>()

        const sessionPassword = ref('')
        const sessionPasswordConfirm = ref('')
        const session_pw_in = ref<HTMLInputElement>()
        const session_pw_confirm_in = ref<HTMLInputElement>()

        onBeforeUnmount(() => {
            // Clear the DOM nodes as well as the refs — an input's .value keeps
            // the secret alive independently of the reactive binding.
            if (mnemonic_in.value) mnemonic_in.value.value = ''
            if (session_pw_in.value) session_pw_in.value.value = ''
            if (session_pw_confirm_in.value) session_pw_confirm_in.value.value = ''
            sessionPassword.value = ''
            sessionPasswordConfirm.value = ''
        })

        const getMnemonic = () => {
            if (!mnemonic_in.value) return ''
            const inputVal = mnemonic_in.value.value
            return inputVal.trim()
        }

        const getWordCount = () => {
            const phrase = getMnemonic() || ''
            return phrase.trim().split(' ').length
        }

        const errCheck = () => {
            let phrase = getMnemonic()
            
            if (!phrase) {
                return
            }

            let words = phrase.split(' ')

            // not a valid key phrase
            if (words.length !== 24) {
                err.value = `${t('access.mnemonic.error')}`
                return false
            }

            let isValid = bip39.validateMnemonic(phrase)
            
            if (!isValid) {
                err.value = 'Invalid mnemonic phrase. Make sure your mnemonic is all lowercase.'
                return false
            }

            return true
        }

        // No length or format restriction on the session password — see
        // SessionPasswordFields.vue for the reasoning.
        const sessionPasswordError = (): string => {
            if (sessionPassword.value !== sessionPasswordConfirm.value) {
                return 'Session passwords do not match.'
            }
            return ''
        }

        const access = async () => {

            err.value = ''
            const phrase = getMnemonic()

            isLoading.value = true

            if (!errCheck()) {
                isLoading.value = false
                return
            }

            const pwErr = sessionPasswordError()
            if (pwErr) {
                err.value = pwErr
                isLoading.value = false
                return
            }

            try {
                await mainStore.accessWallet(phrase, sessionPassword.value)
                // The wallet now holds only ciphertext; drop our copies.
                sessionPassword.value = ''
                sessionPasswordConfirm.value = ''
                if (session_pw_in.value) session_pw_in.value.value = ''
                if (session_pw_confirm_in.value) session_pw_confirm_in.value.value = ''
                isLoading.value = false
            } catch (e) {
                isLoading.value = false
                err.value = `${t('access.mnemonic.error')}`
            }

        }

        return {
            isLoading,
            err,
            canSubmit,
            mnemonic_in,
            sessionPassword,
            sessionPasswordConfirm,
            session_pw_in,
            session_pw_confirm_in,
            getMnemonic,
            getWordCount,
            errCheck,
            access
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.session_pw {
    margin-top: 22px;
    text-align: left;

    h4 {
        font-size: 13px;
        font-weight: bold;
        margin-bottom: 4px;
    }

    .session_pw_desc {
        font-size: 12px;
        color: var(--primary-color-light);
        margin-bottom: 10px;
    }

    input {
        display: block;
        width: 100%;
        margin-bottom: 8px;
    }
}


.mnemonic_auth {
    margin: 0px auto;
    width: 100%;
    background-color: var(--bg-light);
    padding: main.$container-padding;

    .left,
    .right {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
    }
}

h1 {
    font-weight: 400;
    font-size: main.$m-size;
}

label {
    text-align: left;
    color: main.$primary-color-light;
    font-size: 12px;
    margin-bottom: 20px;
}

textarea,
input[type='password'] {
    margin: 1em 0;
    max-width: 440px;
    width: 100%;
    background-color: var(--bg) !important;
    resize: none;
    padding: 1em 16px;
    font-size: 14px;
    color: var(--primary-color);
}

.phrase_disp {
    width: 100%;
    max-width: 560px;
    margin-bottom: main.$vertical-padding;
}

.err {
    font-size: 13px;
    color: var(--error);
    text-align: center;
    margin: 14px 0px !important;
}

.remember {
    margin-top: -20px;
    font-size: 0.75em;
}

.key_in {
    margin: 30px auto;
    margin-bottom: 6px;
    width: 100%;
    font-size: 13px;
    background-color: main.$white;
    border-radius: 4px;
}

.but_primary {
    margin-bottom: 15px;
}

.button_container {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
}

@include main.mobile_device {
    .mnemonic_auth {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;

        padding: main.$container-padding-mobile;

        .left,
        .right {
            flex-direction: column;
            align-items: stretch;
            justify-content: center;
        }

        .left {
            order: 2;
        }

        .right {
            order: 1;
            margin-bottom: main.$vertical-padding-mobile;
        }

        > * {
            width: 100%;
        }
    }

    h1 {
        text-align: center;
        font-size: main.$m-size-mobile;
    }

    label {
        text-align: center;
        margin-bottom: 20px;
    }

    .phrase_disp {
        width: 100%;
        max-width: 560px;
        margin-bottom: main.$vertical-padding-mobile;
    }

    .err {
        font-size: 13px;
        margin: 14px 0px !important;
    }

    .remember {
        margin-top: -20px;
        font-size: 0.75em;
    }

    .key_in {
        margin: 30px auto;
        margin-bottom: 6px;
        width: 100%;
        font-size: 13px;
    }

    .but_primary {
        margin: 0px auto;
        display: block;
        margin-top: 20px;
        margin-bottom: 15px;
    }

    .button_container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }
}
</style>
