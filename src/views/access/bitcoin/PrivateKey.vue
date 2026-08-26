<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Imports a single WIF private key.

  Unlike the recovery-phrase flow, there is nothing to discover here: one key
  is one key, and which ADDRESS it presents as is a choice, not a fact — the
  same key yields a different address under each of the four encodings. So the
  type is asked for rather than probed, and the resulting address is previewed
  live so the user can confirm it matches the one holding their funds.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Bitcoin Private Key</h1>
            <p class="sub">
                Paste a WIF private key — it starts with
                <span class="mono">K</span>, <span class="mono">L</span> or
                <span class="mono">5</span> on mainnet.
            </p>

            <form @submit.prevent="access" autocomplete="off">
                <textarea
                    v-model="wif"
                    class="key_in"
                    rows="2"
                    placeholder="WIF private key"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isLoading"
                ></textarea>

                <label class="field_label">Address type</label>
                <div class="type_grid">
                    <button
                        v-for="t in addressTypes"
                        :key="t.id"
                        type="button"
                        class="type_but"
                        :class="{ active: addressType === t.id }"
                        :disabled="isLoading"
                        @click="addressType = t.id"
                    >
                        <span class="t_label">{{ t.label }}</span>
                        <span class="t_example">{{ t.example }}</span>
                    </button>
                </div>

                <!--
                  A live preview, because the address is the only way to tell
                  whether the chosen type is the right one — the key itself
                  looks identical for all four.
                -->
                <p v-if="previewAddress" class="preview">
                    Opens as <span class="mono">{{ previewAddress }}</span>
                </p>
                <p v-else-if="previewError" class="hint err">{{ previewError }}</p>

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
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import {
    ADDRESS_TYPES,
    ADDRESS_TYPE_INFO,
    DEFAULT_ADDRESS_TYPE,
    type BtcAddressType,
} from '@/bitcoin/networks'
import { addressFromPublicKey, parseWif } from '@/bitcoin/keys'
import { wipe } from '@/js/security/memory'

export default defineComponent({
    name: 'BitcoinPrivateKeyAccess',
    components: { SessionPasswordFields },
    setup() {
        const bitcoinStore = useBitcoinStore()

        const wif = ref('')
        const addressType = ref<BtcAddressType>(DEFAULT_ADDRESS_TYPE)
        const sessionPassword = ref('')
        const isSessionPwValid = ref(false)
        const pwTouched = ref(false)
        const isLoading = ref(false)
        const error = ref('')

        const networkName = computed(() => bitcoinStore.network.name)

        const addressTypes = computed(() =>
            ADDRESS_TYPES.map((id) => ({
                id,
                label: ADDRESS_TYPE_INFO[id].label,
                example: ADDRESS_TYPE_INFO[id].example,
            }))
        )

        /**
         * Derives the address the pasted key would open as.
         *
         * Deriving a public key from a private one is unavoidable to show
         * this, so the key material is wiped immediately rather than left
         * alive in whatever the parser returned.
         */
        const preview = computed((): { address: string; error: string } => {
            const raw = wif.value.trim()
            if (!raw) return { address: '', error: '' }
            let pair: ReturnType<typeof parseWif> | null = null
            try {
                pair = parseWif(raw, bitcoinStore.network)
                return {
                    address: addressFromPublicKey(
                        pair.publicKey,
                        addressType.value,
                        bitcoinStore.network
                    ),
                    error: '',
                }
            } catch (e: any) {
                return { address: '', error: e?.message ?? String(e) }
            } finally {
                const pk = (pair as { privateKey?: Uint8Array } | null)?.privateKey
                if (pk) wipe(pk)
            }
        })

        const previewAddress = computed(() => preview.value.address)
        // Only surface a parse error once enough has been typed for it to be a
        // real problem rather than an incomplete paste.
        const previewError = computed(() =>
            wif.value.trim().length > 20 ? preview.value.error : ''
        )

        const canSubmit = computed(
            () => !!previewAddress.value && isSessionPwValid.value && !isLoading.value
        )

        const access = async () => {
            if (!canSubmit.value) return
            pwTouched.value = true
            error.value = ''
            isLoading.value = true
            try {
                await bitcoinStore.accessWithPrivateKey(
                    wif.value,
                    sessionPassword.value,
                    addressType.value
                )
                wif.value = ''
                sessionPassword.value = ''
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        onBeforeUnmount(() => {
            wif.value = ''
            sessionPassword.value = ''
        })

        return {
            wif,
            addressType,
            addressTypes,
            previewAddress,
            previewError,
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
    width: 400px;
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
    word-break: break-all;
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
    word-break: break-all;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.field_label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--primary-color-light);
    margin: 16px 0 8px;
}

.type_grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.type_but {
    background: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 8px 10px;
    text-align: left;
    cursor: pointer;
    color: var(--primary-color);

    .t_label {
        display: block;
        font-size: 12px;
        font-weight: 600;
    }

    .t_example {
        display: block;
        font-size: 11px;
        font-family: monospace;
        color: var(--primary-color-light);
    }

    &.active {
        border-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

.preview {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 14px 0 0;
    word-break: break-all;
}

.hint {
    font-size: 12px;
    margin: 14px 0 0;

    &.err {
        color: var(--error);
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
    .type_grid {
        grid-template-columns: 1fr;
    }
}
</style>
