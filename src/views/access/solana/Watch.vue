<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Watch-only access: an address, no key.

  The resulting wallet satisfies neither branch of the signing gate in
  js/security/authorize.ts (no vault, and its type isn't externally
  authorized), so every signing path refuses it by construction rather than by
  a UI check that could be bypassed.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Watch a Solana Address</h1>
            <p class="sub">
                View balances for any address without importing a key. Nothing can be sent or
                signed from a watched address.
            </p>

            <form @submit.prevent="access" autocomplete="off">
                <input
                    v-model="address"
                    class="addr_in"
                    placeholder="Solana address"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isLoading"
                />
                <p class="hint" v-if="address.trim() && !isValid">
                    That is not a valid Solana address.
                </p>

                <p class="err" v-if="error">{{ error }}</p>

                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    Watch Address
                </v-btn>
            </form>

            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useSolanaStore } from '@/platforms/solana/store'
import { isValidSolanaAddress } from '@/solana/keys'

export default defineComponent({
    name: 'SolanaWatchAccess',
    setup() {
        const solanaStore = useSolanaStore()

        const address = ref('')
        const isLoading = ref(false)
        const error = ref('')

        const isValid = computed(() => isValidSolanaAddress(address.value))
        const canSubmit = computed(() => isValid.value && !isLoading.value)

        const access = async () => {
            if (!canSubmit.value) return
            error.value = ''
            isLoading.value = true
            try {
                await solanaStore.accessWatchOnly(address.value)
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        return { address, isValid, isLoading, error, canSubmit, access }
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

.addr_in {
    width: 100%;
    background-color: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 12px;
    font-family: monospace;
    font-size: 13px;
    color: var(--primary-color);
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 6px 0 0;
}

.ava_button {
    width: 100%;
    margin: 22px 0;
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
