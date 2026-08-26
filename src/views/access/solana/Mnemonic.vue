<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Imports a BIP-39 recovery phrase as a Solana wallet.

  Separate from views/access/Mnemonic.vue rather than a branch inside it: that
  view builds an Avalanche MnemonicWallet (X/P address derivation, the
  Avalanche stores, secp256k1 HD keys). Solana shares only the BIP-39 phrase
  itself — the key derived from it is ed25519 via SLIP-0010 — so the two have
  essentially no logic in common beyond collecting the words.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Solana Recovery Phrase</h1>
            <p class="sub">
                Enter your 12 or 24 word BIP-39 phrase. The wallet checks both common Solana
                derivation paths and opens the account holding funds.
            </p>

            <form @submit.prevent="access" autocomplete="off">
                <MaskedSecretTextarea
                    ref="phrase_in"
                    v-model="phrase"
                    :rows="3"
                    placeholder="word1 word2 word3 …"
                    :disabled="isLoading"
                ></MaskedSecretTextarea>
                <p class="word_count" :class="{ ok: isPlausibleLength }">
                    {{ wordCount }} {{ wordCount === 1 ? 'word' : 'words' }}
                </p>

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
                    {{ isLoading ? 'Checking accounts…' : 'Access Wallet' }}
                </v-btn>
            </form>

            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'
import SessionPasswordFields from '@/components/misc/SessionPasswordFields.vue'
import MaskedSecretTextarea from '@/components/misc/MaskedSecretTextarea.vue'
import { useSolanaStore } from '@/platforms/solana/store'

export default defineComponent({
    name: 'SolanaMnemonicAccess',
    components: { SessionPasswordFields, MaskedSecretTextarea },
    setup() {
        const solanaStore = useSolanaStore()

        const phrase = ref('')
        const phrase_in = ref<InstanceType<typeof MaskedSecretTextarea> | null>(null)
        const sessionPassword = ref('')
        const isSessionPwValid = ref(false)
        const pwTouched = ref(false)
        const isLoading = ref(false)
        const error = ref('')

        const wordCount = computed(
            () => phrase.value.trim().split(/\s+/).filter(Boolean).length
        )
        // BIP-39 only defines these lengths; anything else cannot validate, so
        // saying so before submitting beats a generic "invalid phrase".
        const isPlausibleLength = computed(() =>
            [12, 15, 18, 21, 24].includes(wordCount.value)
        )

        const canSubmit = computed(
            () => isPlausibleLength.value && isSessionPwValid.value && !isLoading.value
        )

        const access = async () => {
            if (!canSubmit.value) return
            pwTouched.value = true
            error.value = ''
            isLoading.value = true
            try {
                await solanaStore.accessWithMnemonic(phrase.value, sessionPassword.value)
                // Only cleared on success — leaving the phrase in place on
                // failure means a single typo doesn't cost the whole entry.
                phrase.value = ''
                phrase_in.value?.clear()
                sessionPassword.value = ''
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        // The phrase is the wallet. Don't leave it sitting in a component ref
        // (or the textarea's own DOM node — see MaskedSecretTextarea.clear())
        // after navigating away.
        onBeforeUnmount(() => {
            phrase.value = ''
            phrase_in.value?.clear()
            sessionPassword.value = ''
        })

        return {
            phrase_in,
            phrase,
            wordCount,
            isPlausibleLength,
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

.word_count {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 6px 0 16px;
    text-align: right;

    &.ok {
        color: var(--success);
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
