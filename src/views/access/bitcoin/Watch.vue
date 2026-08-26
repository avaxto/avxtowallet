<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Watch-only access: an extended public key or a single address.

  The two behave quite differently and the UI says so. An xpub is a whole
  account — it scans the gap limit and tracks every address the wallet has
  used, including change, so the balance matches what the real wallet shows. A
  single address is only that address, which for an HD wallet is almost always
  a fraction of the true balance.

  Either way the resulting wallet satisfies neither branch of the signing gate
  in js/security/authorize.ts, so signing is refused by construction rather
  than by a UI check.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Watch a Bitcoin Wallet</h1>
            <p class="sub">
                Paste an extended public key (<span class="mono">xpub</span>,
                <span class="mono">ypub</span> or <span class="mono">zpub</span>) to track a
                whole wallet, or a single address to track just that one.
            </p>

            <form @submit.prevent="access" autocomplete="off">
                <textarea
                    v-model="input"
                    class="in"
                    rows="3"
                    placeholder="xpub… / zpub… / bc1…"
                    autocomplete="off"
                    autocorrect="off"
                    autocapitalize="none"
                    spellcheck="false"
                    :disabled="isLoading"
                ></textarea>

                <p v-if="mode === 'xpub'" class="mode_note">
                    <fa icon="check-circle"></fa>
                    Extended public key — scans the whole account, including change addresses.
                </p>
                <p v-else-if="mode === 'address'" class="mode_note">
                    <fa icon="info-circle"></fa>
                    Single address — shows only this address's balance. If it belongs to an HD
                    wallet, that is usually less than the wallet's total.
                </p>
                <p v-else-if="input.trim()" class="hint err">
                    That is neither a valid {{ networkName }} address nor an extended public key.
                </p>

                <template v-if="mode === 'xpub'">
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
                    <p class="hint">
                        An extended key does not record which address encoding its wallet uses,
                        so this has to be told. Pick what the source wallet shows.
                    </p>
                </template>

                <p class="err" v-if="error">{{ error }}</p>

                <v-btn
                    class="ava_button button_primary"
                    @click="access"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    Watch Wallet
                </v-btn>
            </form>

            <p class="net_note">
                Watching on <b>{{ networkName }}</b>.
            </p>

            <router-link to="/access" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import {
    ADDRESS_TYPES,
    ADDRESS_TYPE_INFO,
    DEFAULT_ADDRESS_TYPE,
    type BtcAddressType,
} from '@/bitcoin/networks'
import { isValidBitcoinAddress } from '@/bitcoin/keys'

export default defineComponent({
    name: 'BitcoinWatchAccess',
    setup() {
        const bitcoinStore = useBitcoinStore()

        const input = ref('')
        const addressType = ref<BtcAddressType>(DEFAULT_ADDRESS_TYPE)
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

        /** Which kind of input this is, so the form can explain the difference. */
        const mode = computed((): 'xpub' | 'address' | null => {
            const raw = input.value.trim()
            if (!raw) return null
            if (/^([xyz]pub|[tuv]pub)/i.test(raw)) return 'xpub'
            if (isValidBitcoinAddress(raw, bitcoinStore.network)) return 'address'
            return null
        })

        const canSubmit = computed(() => mode.value !== null && !isLoading.value)

        const access = async () => {
            if (!canSubmit.value) return
            error.value = ''
            isLoading.value = true
            try {
                await bitcoinStore.accessWatchOnly(input.value, addressType.value)
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        return {
            input,
            mode,
            addressType,
            addressTypes,
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
}

.in {
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

.mode_note {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 10px 0 0;
    line-height: 1.5;

    svg {
        margin-right: 5px;
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
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 10px 0 0;
    line-height: 1.5;

    &.err {
        color: var(--error);
    }
}

.ava_button {
    width: 100%;
    margin: 20px 0 12px;
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
