<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Access using AVXTO Manager, straight from /access: reads the recovery phrase
  from the user's own AVXTO Manager JSON-RPC endpoint (see
  utils/avxtoManager.ts) and opens every platform they tick with it — the same
  multi-platform unlock as "Open every platform with one phrase", minus the
  typing. The session password is sent to the endpoint to unlock it, then
  reused as the wallet's own session password, exactly as on the Avalanche
  phrase screen's AVXTO Manager box.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>
                <fa icon="server" class="manager_icon"></fa>
                Access using AVXTO Manager
            </h1>
            <p class="sub">
                Reads your recovery phrase from a JSON-RPC endpoint you run yourself, instead of typing it, and opens
                the platforms you choose with it.
            </p>
            <p class="warn">
                <fa icon="triangle-exclamation"></fa>
                The password travels in plain JSON-RPC — only point this at an endpoint you trust, and prefer an
                <span class="mono">https://</span> URL.
            </p>

            <form autocomplete="off" @submit.prevent="unlock">
                <label class="field_label" for="manager-url">Manager endpoint</label>
                <input
                    id="manager-url"
                    v-model="managerUrl"
                    class="field"
                    type="text"
                    placeholder="https://your-avxto-manager.example/rpc"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    data-1p-ignore
                    data-lpignore="true"
                    :disabled="isLoading"
                />

                <label class="field_label" for="manager-pw">Session password</label>
                <input
                    id="manager-pw"
                    ref="pw_in"
                    v-model="password"
                    class="field"
                    type="password"
                    placeholder="Session password"
                    autocomplete="off"
                    :disabled="isLoading"
                />

                <div class="platforms">
                    <h4>Platforms to open</h4>
                    <label
                        v-for="platform in choices"
                        :key="platform.descriptor.id"
                        class="platform_row"
                        :class="{ disabled: isLoading || platform.connected }"
                    >
                        <input v-model="selected" type="checkbox" :value="platform.descriptor.id" :disabled="isLoading || platform.connected" />
                        <span class="dot" :style="{ backgroundColor: platform.accent }"></span>
                        <span class="name">{{ platform.descriptor.name }}</span>
                        <span v-if="platform.connected" class="badge">Already connected</span>
                    </label>
                    <p v-if="!choices.length" class="err">No platform on this build can be opened from a recovery phrase.</p>
                </div>

                <p v-if="selected.length > 1" class="note">This password will authorize signing on every platform you open here.</p>
                <p v-if="error" class="err">{{ error }}</p>
                <p v-if="notice" class="notice">{{ notice }}</p>
                <v-btn class="ava_button button_primary" depressed :loading="isLoading" :disabled="!canSubmit" @click="unlock">
                    {{ isLoading ? 'Opening…' : submitLabel }}
                </v-btn>
            </form>

            <div v-if="failures.length" class="results">
                <p class="results_head">
                    <span v-if="opened.length">Opened {{ opened.length }} of {{ opened.length + failures.length }}.</span>
                    <span v-else>Nothing could be opened.</span>
                </p>
                <p v-for="f in failures" :key="f.platformId" class="result_row">
                    <b>{{ platformName(f.platformId) }}</b> — {{ f.error }}
                </p>
                <v-btn v-if="opened.length" class="ava_button button_secondary" depressed @click="goToWallet">Continue to wallet</v-btn>
            </div>

            <router-link :to="cancelTo" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useActivePlatformStore } from '@/platforms'
import type { MnemonicUnlockResult, PlatformId } from '@/platforms'
import { fetchMnemonicFromManager, isBip39Phrase } from '@/utils/avxtoManager'

export default defineComponent({
    name: 'ManagerAccess',
    setup() {
        const platformStore = useActivePlatformStore()
        const router = useRouter()
        const route = useRoute()

        const managerUrl = ref('')
        const password = ref('')
        const pw_in = ref<HTMLInputElement | null>(null)
        const isLoading = ref(false)
        const error = ref('')
        const notice = ref('')
        const results = ref<MnemonicUnlockResult[]>([])

        const isAddingSession = computed(() => route.query.add !== undefined)
        const cancelTo = computed(() => (isAddingSession.value ? '/access?add=1' : '/access'))

        const choices = computed(() =>
            platformStore.mnemonicUnlockablePlatforms.map((p) => ({
                descriptor: p.descriptor,
                accent: p.descriptor.theme?.accent ?? 'var(--primary-color-light)',
                connected: platformStore.isPlatformConnected(p.descriptor.id),
            }))
        )
        const selected = ref<PlatformId[]>(choices.value.filter((c) => !c.connected).map((c) => c.descriptor.id))

        const canSubmit = computed(() => !!managerUrl.value.trim() && !!password.value && selected.value.length > 0 && !isLoading.value)
        const submitLabel = computed(() => (selected.value.length === 1 ? 'Open 1 Platform' : `Open ${selected.value.length} Platforms`))
        const opened = computed(() => results.value.filter((r) => r.status === 'connected'))
        const failures = computed(() => results.value.filter((r) => r.status === 'failed'))
        const platformName = (id: PlatformId) => choices.value.find((c) => c.descriptor.id === id)?.descriptor.name ?? id
        const goToWallet = () => router.push('/wallet')

        /** The password is a secret: drop every copy, the DOM node's included. */
        const clearPassword = () => {
            password.value = ''
            if (pw_in.value) pw_in.value.value = ''
        }

        const unlock = async () => {
            if (!canSubmit.value) return
            error.value = ''
            notice.value = ''
            results.value = []
            isLoading.value = true
            try {
                let mnemonic = await fetchMnemonicFromManager(managerUrl.value, password.value)
                // An Electrum-format seed is not BIP-39: only Bitcoin can derive from it.
                let platforms = selected.value
                if (!isBip39Phrase(mnemonic)) {
                    platforms = platforms.filter((p) => p === 'bitcoin')
                    if (!platforms.length) {
                        throw new Error(
                            'This is an Electrum-format seed, which only the Bitcoin platform can open. Tick Bitcoin and try again.'
                        )
                    }
                    notice.value = 'This is an Electrum-format seed, so only Bitcoin was opened.'
                }
                const settled = await platformStore.unlockWithMnemonic(mnemonic, password.value, platforms)
                mnemonic = ''
                results.value = settled
                const failed = settled.filter((r) => r.status === 'failed')
                const messages = new Set(failed.map((r) => r.error))
                if (failed.length === settled.length && messages.size === 1) {
                    error.value = Array.from(messages)[0] ?? 'Failed to open any platform.'
                    results.value = []
                    return
                }
                if (failed.length === 0) goToWallet()
            } catch (e: any) {
                error.value = e?.message || 'Failed to access the wallet via AVXTO Manager.'
            } finally {
                clearPassword()
                isLoading.value = false
            }
        }

        onBeforeUnmount(clearPassword)

        return {
            managerUrl,
            password,
            pw_in,
            isLoading,
            error,
            notice,
            choices,
            selected,
            canSubmit,
            submitLabel,
            opened,
            failures,
            platformName,
            goToWallet,
            unlock,
            cancelTo,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

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
    width: 440px;
    max-width: 100%;
    margin: 0 auto;
}

h1 {
    font-size: main.$m-size;
    font-weight: 400;
    margin-bottom: 8px;

    .manager_icon {
        margin-right: 6px;
        color: var(--secondary-color);
    }
}

.sub {
    font-size: 13px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin-bottom: 12px;
}

.warn {
    font-size: 12px;
    line-height: 1.5;
    color: var(--warning, #d08700);
    margin-bottom: 18px;
}

.mono {
    font-family: monospace;
}

.field_label {
    display: block;
    font-size: 13px;
    font-weight: bold;
    margin: 14px 0 6px;
}

.field {
    width: 100%;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--bg-wallet-light, transparent);
    background-color: var(--bg);
    color: var(--primary-color);
    font-size: 15px;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.platforms {
    margin-top: 18px;

    h4 {
        font-size: 13px;
        font-weight: bold;
        margin-bottom: 8px;
    }
}

.platform_row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    margin-bottom: 6px;
    border-radius: 6px;
    background-color: var(--bg);
    cursor: pointer;

    &.disabled {
        opacity: 0.6;
        cursor: default;
    }

    .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
    }

    .name {
        flex: 1;
    }

    .badge {
        font-size: 11px;
        color: var(--primary-color-light);
    }
}

.notice {
    font-size: 12px;
    color: var(--secondary-color);
    margin: 10px 0;
}

.note {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 10px 0;
}

.err {
    color: var(--error);
    font-size: 13px;
    margin: 8px 0;
}

.ava_button {
    width: 100%;
    margin-top: 12px;
}

.results {
    margin-top: 18px;

    .results_head {
        font-weight: bold;
        margin-bottom: 6px;
    }

    .result_row {
        font-size: 13px;
        margin-bottom: 4px;
    }
}

.link {
    display: block;
    margin-top: 18px;
    text-align: center;
    color: var(--secondary-color);
}
</style>
