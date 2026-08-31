<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Opens a session on several platforms from ONE recovery phrase.

  The per-platform screens next to this one (bitcoin/Mnemonic.vue,
  solana/Mnemonic.vue) each take the same phrase and open exactly one platform,
  then navigate. This one is not a replacement for them — it exists because the
  same BIP-39 phrase is a valid credential on every seed-based chain, so making
  the user type it once per platform was asking them to re-enter their most
  sensitive secret for no derivation reason.

  Which platforms appear is not decided here: the store derives them from what
  each platform declares (see `mnemonicUnlockablePlatforms`), so this view needs
  no edit when a platform joins or leaves that set.
-->
<template>
    <div class="access_card">
        <div class="content">
            <h1>Open Every Platform</h1>
            <p class="sub">
                One BIP-39 recovery phrase opens a session on each platform below, all at
                once. Each keeps its own tab and its own address — the phrase is the only
                thing they share.
            </p>

            <form @submit.prevent="unlock" autocomplete="off">
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

                <div class="platforms">
                    <h4>Platforms to open</h4>

                    <!--
                      An already-connected platform is shown but not offered:
                      the store leaves live sessions strictly alone, and a
                      checkbox implying this pass would re-open it would be
                      lying about what happens.
                    -->
                    <label
                        v-for="platform in choices"
                        :key="platform.descriptor.id"
                        class="platform_row"
                        :class="{ disabled: isLoading || platform.connected }"
                    >
                        <input
                            type="checkbox"
                            :value="platform.descriptor.id"
                            v-model="selected"
                            :disabled="isLoading || platform.connected"
                        />
                        <span class="dot" :style="{ backgroundColor: platform.accent }"></span>
                        <span class="name">{{ platform.descriptor.name }}</span>
                        <span class="symbol">{{ platform.descriptor.symbol }}</span>
                        <span v-if="platform.connected" class="badge">Already connected</span>
                    </label>

                    <p v-if="!choices.length" class="err">
                        No platform on this build can be opened from a recovery phrase alone.
                    </p>
                </div>

                <SessionPasswordFields
                    v-model="sessionPassword"
                    :show-error="pwTouched"
                    @validity="isSessionPwValid = $event"
                ></SessionPasswordFields>

                <!--
                  Stated plainly rather than buried: this is the one real
                  tradeoff of the feature. The vaults stay separate (each has
                  its own salt and AAD, so no ciphertext moves between them),
                  but the password that authorizes signing no longer covers one
                  platform.
                -->
                <p class="warn">
                    This password will authorize signing on every platform you open here,
                    not just one.
                </p>

                <p class="err" v-if="error">{{ error }}</p>

                <v-btn
                    class="ava_button button_primary"
                    @click="unlock"
                    :loading="isLoading"
                    :disabled="!canSubmit"
                    depressed
                >
                    {{ isLoading ? 'Opening platforms…' : submitLabel }}
                </v-btn>
            </form>

            <!--
              Shown only when the pass was partial. A clean sweep navigates
              straight to the wallet, and reporting three successes to someone
              who is already looking at three tabs would be noise.
            -->
            <div v-if="failures.length" class="results">
                <p class="results_head">
                    <span v-if="opened.length">
                        Opened {{ opened.length }} of {{ opened.length + failures.length }}.
                    </span>
                    <span v-else>Nothing could be opened.</span>
                </p>
                <p v-for="failure in failures" :key="failure.platformId" class="result_row">
                    <b>{{ platformName(failure.platformId) }}</b> — {{ failure.error }}
                </p>
                <v-btn
                    v-if="opened.length"
                    class="ava_button button_secondary"
                    @click="goToWallet"
                    depressed
                >
                    Continue to wallet
                </v-btn>
            </div>

            <router-link :to="cancelTo" class="link">Cancel</router-link>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SessionPasswordFields from '@/components/misc/SessionPasswordFields.vue'
import MaskedSecretTextarea from '@/components/misc/MaskedSecretTextarea.vue'
import { useActivePlatformStore } from '@/platforms'
import type { MnemonicUnlockResult, PlatformId } from '@/platforms'

export default defineComponent({
    name: 'MultiPlatformAccess',
    components: { SessionPasswordFields, MaskedSecretTextarea },
    setup() {
        const platformStore = useActivePlatformStore()
        const router = useRouter()
        const route = useRoute()

        const phrase = ref('')
        const phrase_in = ref<InstanceType<typeof MaskedSecretTextarea> | null>(null)
        const sessionPassword = ref('')
        const isSessionPwValid = ref(false)
        const pwTouched = ref(false)
        const isLoading = ref(false)
        const error = ref('')
        const results = ref<MnemonicUnlockResult[]>([])

        /** Reached from the platform tabs' "+", which keeps open sessions alive. */
        const isAddingSession = computed(() => route.query.add !== undefined)
        const cancelTo = computed(() => (isAddingSession.value ? '/access?add=1' : '/access'))

        const choices = computed(() =>
            platformStore.mnemonicUnlockablePlatforms.map((p) => ({
                descriptor: p.descriptor,
                accent: p.descriptor.theme?.accent ?? 'var(--primary-color-light)',
                connected: platformStore.isPlatformConnected(p.descriptor.id),
            }))
        )

        // Everything not already open, pre-ticked: opening all of them is the
        // reason to be on this screen rather than a per-platform one.
        const selected = ref<PlatformId[]>(
            choices.value.filter((c) => !c.connected).map((c) => c.descriptor.id)
        )

        const wordCount = computed(() => phrase.value.trim().split(/\s+/).filter(Boolean).length)
        const isPlausibleLength = computed(() => [12, 15, 18, 21, 24].includes(wordCount.value))

        const canSubmit = computed(
            () =>
                isPlausibleLength.value &&
                isSessionPwValid.value &&
                selected.value.length > 0 &&
                !isLoading.value
        )

        const submitLabel = computed(() =>
            selected.value.length === 1
                ? 'Open 1 Platform'
                : `Open ${selected.value.length} Platforms`
        )

        const opened = computed(() => results.value.filter((r) => r.status === 'connected'))
        const failures = computed(() => results.value.filter((r) => r.status === 'failed'))

        const platformName = (id: PlatformId): string =>
            choices.value.find((c) => c.descriptor.id === id)?.descriptor.name ?? id

        /** The phrase is the wallet — drop every copy, refs and DOM nodes alike. */
        const clearSecrets = () => {
            phrase.value = ''
            phrase_in.value?.clear()
            sessionPassword.value = ''
        }

        const goToWallet = () => router.push('/wallet')

        const unlock = async () => {
            if (!canSubmit.value) return
            pwTouched.value = true
            error.value = ''
            results.value = []
            isLoading.value = true

            try {
                const settled = await platformStore.unlockWithMnemonic(
                    phrase.value,
                    sessionPassword.value,
                    selected.value
                )
                results.value = settled

                // Held only as long as it takes to derive; not until navigation.
                clearSecrets()

                const failed = settled.filter((r) => r.status === 'failed')

                // Every platform rejecting the same phrase is one fact about the
                // phrase, not N facts about the platforms — say it once, where
                // the form's own errors appear, and leave the per-platform list
                // for the case where they genuinely differ.
                const messages = new Set(failed.map((r) => r.error))
                if (failed.length === settled.length && messages.size === 1) {
                    error.value = [...messages][0] ?? 'Failed to open any platform.'
                    results.value = []
                    return
                }

                if (failed.length === 0) goToWallet()
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        onBeforeUnmount(clearSecrets)

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
            results,
            opened,
            failures,
            choices,
            selected,
            canSubmit,
            submitLabel,
            cancelTo,
            platformName,
            goToWallet,
            unlock,
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
    width: 420px;
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

.platforms {
    margin-top: 6px;

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
    font-size: 13px;
    cursor: pointer;

    &.disabled {
        opacity: 0.6;
        cursor: default;
    }

    input {
        margin: 0;
    }
}

.dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
}

.name {
    font-weight: bold;
}

.symbol {
    color: var(--primary-color-light);
    font-size: 12px;
}

.badge {
    margin-left: auto;
    font-size: 11px;
    color: var(--primary-color-light);
}

.warn {
    font-size: 12px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin: 12px 0 16px;
}

.ava_button {
    width: 100%;
    margin-bottom: 12px;
}

.results {
    margin: 4px 0 16px;
    padding: 12px 14px;
    border-radius: 6px;
    background-color: var(--bg);
}

.results_head {
    font-size: 13px;
    margin-bottom: 8px;
}

.result_row {
    font-size: 12px;
    color: var(--error);
    line-height: 1.5;
    margin-bottom: 6px;
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
