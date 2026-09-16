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

            <!--
              An alternative to pasting the phrase above: fetch it from a
              self-hosted AVXTO Manager instance instead. Same downstream
              path either way — once we have a 24-word phrase, it's validated
              and handed to mainStore.accessWallet() exactly like the manual
              form's own `access()` does.
            -->
            <div class="manager_panel">
                <h4>Access using AVXTO Manager</h4>
                <p class="manager_desc">
                    Reads your mnemonic phrase from a JSON-RPC endpoint you run yourself, instead
                    of pasting it above. The session password below is sent to that endpoint to
                    unlock it, then reused as this wallet's own session password — exactly as if
                    you had typed the returned phrase into the field above.
                    <strong>The password travels in plain JSON-RPC — only point this at an
                    endpoint you trust, and prefer an https:// URL.</strong>
                </p>
                <input
                    type="text"
                    v-model="managerUrl"
                    placeholder="https://your-avxto-manager.example/rpc"
                    autocomplete="off"
                    autocapitalize="off"
                    data-1p-ignore
                    data-lpignore="true"
                />
                <input
                    type="password"
                    ref="manager_pw_in"
                    v-model="managerPassword"
                    placeholder="Session password"
                    autocomplete="off"
                />
                <p class="err" v-if="managerErr">{{ managerErr }}</p>
                <button
                    class="ava_button button_secondary manager_proceed"
                    @click="accessViaManager"
                    :disabled="managerLoading"
                >
                    <span v-if="managerLoading">Loading...</span>
                    <span v-else>Proceed</span>
                </button>
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
import { buildReadRequest, extractMnemonic } from '@/utils/avxtoManager'

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

        // AVXTO Manager: fetches the mnemonic from a user-run JSON-RPC
        // endpoint instead of it being pasted directly. Kept entirely
        // separate from the fields above — it has its own error/loading
        // state and its own password, and only ever calls into the same
        // `mainStore.accessWallet()` the manual form uses.
        const managerUrl = ref('')
        const managerPassword = ref('')
        const manager_pw_in = ref<HTMLInputElement>()
        const managerErr = ref('')
        const managerLoading = ref(false)

        onBeforeUnmount(() => {
            // Clear the DOM nodes as well as the refs — an input's .value keeps
            // the secret alive independently of the reactive binding.
            if (mnemonic_in.value) mnemonic_in.value.value = ''
            if (session_pw_in.value) session_pw_in.value.value = ''
            if (session_pw_confirm_in.value) session_pw_confirm_in.value.value = ''
            if (manager_pw_in.value) manager_pw_in.value.value = ''
            sessionPassword.value = ''
            sessionPasswordConfirm.value = ''
            managerPassword.value = ''
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

        /**
         * Posts the session password to a user-run JSON-RPC endpoint per the
         * AVXTO Manager protocol (see utils/avxtoManager.ts for the wire
         * format and response parsing), then hands the mnemonic it returns
         * to `mainStore.accessWallet()` — the exact same call the manual
         * phrase form above makes. From that point on there is no difference
         * between the two paths: same wallet, same session-password gate,
         * same downstream state.
         */
        const accessViaManager = async () => {
            managerErr.value = ''

            const url = managerUrl.value.trim()
            if (!url) {
                managerErr.value = 'Enter the AVXTO Manager JSON-RPC URL.'
                return
            }
            if (!managerPassword.value) {
                managerErr.value = 'Enter the session password.'
                return
            }

            managerLoading.value = true
            try {
                let response: Response
                try {
                    response = await fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(buildReadRequest(managerPassword.value)),
                    })
                } catch {
                    // A failed `fetch()` is indistinguishable from here
                    // whether the server is actually unreachable or the
                    // browser blocked reading its response over CORS — the
                    // browser deliberately hides that distinction from JS.
                    // The latter is by far the more common cause for a
                    // self-hosted endpoint: it must send
                    // `Access-Control-Allow-Origin` (matching this page's
                    // origin, or `*`) on both the POST response and the
                    // OPTIONS preflight, which most simple JSON-RPC servers
                    // don't do without being told to. No setting on this end
                    // can substitute for that — CORS is the server's grant to
                    // make, not this page's to take.
                    throw new Error(
                        'Could not reach the AVXTO Manager endpoint, or it refused this page ' +
                            "(check the browser console for a CORS error). The server must send " +
                            "'Access-Control-Allow-Origin' for this page's origin, or '*', on " +
                            'both the POST response and the OPTIONS preflight.'
                    )
                }

                if (!response.ok) {
                    throw new Error(`AVXTO Manager returned an error (HTTP ${response.status}).`)
                }

                let body: any
                try {
                    body = await response.json()
                } catch {
                    throw new Error('AVXTO Manager did not return valid JSON.')
                }

                const mnemonic = extractMnemonic(body)
                await mainStore.accessWallet(mnemonic, managerPassword.value)
            } catch (e: any) {
                managerErr.value = e?.message || 'Failed to access wallet via AVXTO Manager.'
            } finally {
                // Drop our copy of the password regardless of outcome — same
                // discipline as the manual form's own `access()`.
                managerPassword.value = ''
                if (manager_pw_in.value) manager_pw_in.value.value = ''
                managerLoading.value = false
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
            access,
            managerUrl,
            managerPassword,
            manager_pw_in,
            managerErr,
            managerLoading,
            accessViaManager,
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

.manager_panel {
    margin-top: 30px;
    padding: 16px 20px;
    max-width: 440px;
    width: 100%;
    text-align: left;
    border: 1px solid var(--secondary-color);
    border-radius: 6px;
    background-color: var(--bg);

    h4 {
        font-size: 13px;
        font-weight: bold;
        margin-bottom: 4px;
    }

    .manager_desc {
        font-size: 12px;
        color: var(--primary-color-light);
        margin-bottom: 10px;
        line-height: 1.5;

        strong {
            color: var(--primary-color);
        }
    }

    input {
        display: block;
        width: 100%;
        margin-bottom: 8px;
    }

    .err {
        text-align: left;
        margin: 6px 0 !important;
    }
}

.manager_proceed {
    width: 100%;
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
