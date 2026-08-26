<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Imports a raw Solana private key.

  Accepts both formats real wallets export: Phantom/Solflare's base58 string,
  and solana-keygen's JSON byte array. See solana/keys.ts — a 64-byte key has
  its embedded public half verified against the private half rather than
  trusted, so a mistyped key fails here instead of silently opening a wallet at
  an address the user doesn't recognise.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Solana Private Key</h1>
            <p class="sub">
                Paste a base58 private key (Phantom &rarr; Export Private Key) or the contents
                of a <span class="mono">solana-keygen</span> JSON key file.
            </p>

            <form @submit.prevent="access" autocomplete="off">
                <textarea
                    v-model="privateKey"
                    class="key_in"
                    rows="3"
                    placeholder="base58 key, or [12,34,56,…]"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isLoading"
                ></textarea>

                <SessionPasswordFields
                    v-model="sessionPassword"
                    :show-error="pwTouched"
                    @validity="isSessionPwValid = $event"
                ></SessionPasswordFields>

                <p class="err" v-if="error">{{ error }}</p>

                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    Access Wallet
                </v-btn>
            </form>

            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'
import SessionPasswordFields from '@/components/misc/SessionPasswordFields.vue'
import { useSolanaStore } from '@/platforms/solana/store'

export default defineComponent({
    name: 'SolanaPrivateKeyAccess',
    components: { SessionPasswordFields },
    setup() {
        const solanaStore = useSolanaStore()

        const privateKey = ref('')
        const sessionPassword = ref('')
        const isSessionPwValid = ref(false)
        const pwTouched = ref(false)
        const isLoading = ref(false)
        const error = ref('')

        const canSubmit = computed(
            () => !!privateKey.value.trim() && isSessionPwValid.value && !isLoading.value
        )

        const access = async () => {
            if (!canSubmit.value) return
            pwTouched.value = true
            error.value = ''
            isLoading.value = true
            try {
                await solanaStore.accessWithPrivateKey(privateKey.value, sessionPassword.value)
                privateKey.value = ''
                sessionPassword.value = ''
            } catch (e: any) {
                // keys.ts throws a specific message per malformed shape
                // (wrong length, bad base58, inconsistent key) — surface it
                // rather than flattening to "invalid private key".
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        onBeforeUnmount(() => {
            privateKey.value = ''
            sessionPassword.value = ''
        })

        return {
            privateKey,
            sessionPassword,
            isSessionPwValid,
            pwTouched,
            isLoading,
            error,
            canSubmit,
            access,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.access_card {
    background-color: var(--bg-light);
    padding: main.$container-padding;
    width: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-radius: 6px;
}

.content {
    width: 380px;
    max-width: 100%;
    margin: 0px auto;
}

h1 {
    font-size: main.$m-size;
    font-weight: 400;
    margin-bottom: 8px;
}

.sub {
    font-size: 13px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin-bottom: 24px;
}

.mono {
    font-family: monospace;
}

.key_in {
    width: 100%;
    background-color: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 12px;
    font-family: monospace;
    font-size: 13px;
    color: var(--primary-color);
    resize: vertical;
    outline: none;
    margin-bottom: 16px;
    word-break: break-all;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.ava_button {
    width: 100%;
    margin-bottom: 22px;
}

.err {
    font-size: 13px;
    color: var(--error);
    margin: 14px 0px !important;
}

.link {
    color: var(--secondary-color);
}

@media only screen and (max-width: main.$mobile_width) {
    h1 {
        font-size: main.$m-size-mobile;
    }
}
</style>
