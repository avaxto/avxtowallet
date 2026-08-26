<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Imports a BIP-39 recovery phrase as a Bitcoin wallet.

  Separate from views/access/Mnemonic.vue (Avalanche) and the Solana one for
  the same reason those are separate from each other: only the BIP-39 phrase is
  shared. Everything downstream — the derivation purpose, the four candidate
  address types, the gap-limit scan — is Bitcoin's own.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Bitcoin Recovery Phrase</h1>
            <p class="sub">
                Enter your 12 or 24 word BIP-39 phrase. The wallet checks Native SegWit, Nested
                SegWit, Legacy and Taproot addresses — plus the address Core Extension / Core App
                use for this same phrase — and opens whichever holds funds.
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
                    {{ isLoading ? 'Scanning addresses…' : 'Access Wallet' }}
                </v-btn>
            </form>

            <p class="net_note">
                Importing on <b>{{ networkName }}</b>.
            </p>

            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'
import SessionPasswordFields from '@/components/misc/SessionPasswordFields.vue'
import MaskedSecretTextarea from '@/components/misc/MaskedSecretTextarea.vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'

export default defineComponent({
    name: 'BitcoinMnemonicAccess',
    components: { SessionPasswordFields, MaskedSecretTextarea },
    setup() {
        const bitcoinStore = useBitcoinStore()

        const phrase = ref('')
        const phrase_in = ref<InstanceType<typeof MaskedSecretTextarea> | null>(null)
        const sessionPassword = ref('')
        const isSessionPwValid = ref(false)
        const pwTouched = ref(false)
        const isLoading = ref(false)
        const error = ref('')

        const networkName = computed(() => bitcoinStore.network.name)

        const wordCount = computed(
            () => phrase.value.trim().split(/\s+/).filter(Boolean).length
        )
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
                await bitcoinStore.accessWithMnemonic(phrase.value, sessionPassword.value)
                phrase.value = ''
                phrase_in.value?.clear()
                sessionPassword.value = ''
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        // The phrase is the wallet — don't leave it in a component ref (or the
        // textarea's own DOM node — see MaskedSecretTextarea.clear()) after
        // navigating away.
        onBeforeUnmount(() => {
            phrase.value = ''
            phrase_in.value?.clear()
            sessionPassword.value = ''
        })

        return {
            phrase,
            phrase_in,
            wordCount,
            isPlausibleLength,
            sessionPassword,
            isSessionPwValid,
            pwTouched,
            isLoading,
            error,
            canSubmit,
            networkName,
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
    margin-bottom: 12px;
}

.net_note {
    font-size: 12px;
    color: var(--primary-color-light);
    text-align: center;
    margin-bottom: 16px;
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
