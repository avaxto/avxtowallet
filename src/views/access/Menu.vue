<template>
    <div class="access_card">
        <!--
          Reached from the platform tabs' "+" with ?add=1, meaning existing
          sessions are still open behind this screen. Say so, and offer the way
          back — without this the user has no route to the wallet they are
          still logged into.
        -->
        <div v-if="isAddingSession" class="add_banner">
            <span>Connecting an additional platform — your open sessions stay signed in.</span>
            <router-link to="/wallet" class="link">Back to wallet</router-link>
        </div>

        <h1>{{ $t('access.title') }}</h1>
        <router-link to="/create" class="link">{{ $t('access.create') }}</router-link>
        <div class="menus">
            <!--
              Offered above the platform picker, and only when more than one
              platform could actually be opened by one phrase — with a single
              candidate this is just that platform's own mnemonic screen with
              extra steps.
            -->
            <router-link v-if="canUnlockMultiple" :to="multiUnlockTo" class="multi_option">
                <span class="multi_title">Open every platform with one phrase</span>
                <span class="multi_sub">{{ multiPlatformNames }} — one recovery phrase</span>
            </router-link>

            <PlatformSelect></PlatformSelect>
            <!--
                Saved accounts are keystore-encrypted local keys, so they only
                mean anything on a platform that can be accessed by a local key.
                Gated on that rather than on a platform id.
            -->
            <AccountsFound v-if="hasLocalKeyAccess" class="accounts_menu"></AccountsFound>
            <!--
                Login options come from the active platform's `accessMethods`
                rather than being hardcoded here, so adding a platform doesn't
                mean editing this view.
            -->
            <div class="options">
                <template v-for="method in accessMethods" :key="method.id">
                    <template v-if="method.kind === 'action'">
                        <button
                            class="menu_option button_primary"
                            @click="runAction(method)"
                            :disabled="isConnecting"
                        >
                            <!--
                              A multi-platform pass approves one platform at a
                              time, so name the one the extension is asking
                              about — otherwise the second and third popups look
                              like the first one failing.
                            -->
                            <span v-if="isConnecting && connectingPlatformName">
                                Connecting {{ connectingPlatformName }}…
                            </span>
                            <span v-else-if="isConnecting">
                                {{ $t('access.injected.waiting') }}
                            </span>
                            <span v-else>{{ methodLabel(method) }}</span>
                            <ImageDayNight
                                v-if="method.icon"
                                :day="method.icon.day"
                                :night="method.icon.night"
                            ></ImageDayNight>
                        </button>
                        <p v-if="connectError" class="connect_error">{{ connectError }}</p>
                    </template>

                    <LedgerButton
                        v-else-if="method.component === 'LedgerButton'"
                        class="menu_option button_primary"
                    ></LedgerButton>

                    <router-link
                        v-else-if="method.kind === 'route' && method.route"
                        :to="method.route"
                        class="menu_option button_primary"
                    >
                        {{ methodLabel(method) }}
                        <ImageDayNight
                            v-if="method.icon"
                            :day="method.icon.day"
                            :night="method.icon.night"
                        ></ImageDayNight>
                        <span v-else-if="method.readonly"><fa icon="glasses"></fa></span>
                    </router-link>
                </template>

                <p v-if="!accessMethods.length" class="connect_error">
                    This platform has no login methods available yet.
                </p>

                <!--
                  Said before the click, not after: connecting opens a session
                  on each of these, and that is worth knowing in advance rather
                  than discovering as a row of new tabs. Describes the
                  extension, not any one login button, so it sits outside the
                  access-method loop.
                -->
                <p
                    v-if="hasInjectedMethod && canConnectMultiple && !isConnecting"
                    class="injected_hint"
                >
                    Opens {{ injectedPlatformNames }}
                </p>

                <!--
                  Outside the access-method loop: this is the outcome of one
                  multi-platform pass, not a property of any one login button,
                  and rendering it per method would repeat it.

                  Shown only when the pass was partial. A clean sweep navigates
                  straight to the wallet, and reporting three successes to
                  someone about to look at three tabs would be noise. Mirrors
                  the one-phrase unlock's results box.
                -->
                <div v-if="partialFailures.length" class="results">
                    <p class="results_head">
                        Opened {{ openedCount }} of {{ openedCount + partialFailures.length }}.
                    </p>
                    <p v-for="failure in partialFailures" :key="failure.name" class="result_row">
                        <b>{{ failure.name }}</b> — {{ failure.error }}
                    </p>
                    <button class="menu_option button_secondary" @click="goToWallet">
                        Continue to wallet
                    </button>
                </div>
            </div>
        </div>

        <ToS style="margin: 20px !important"></ToS>
        <router-link to="/" class="link">{{ $t('access.cancel') }}</router-link>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LedgerButton from '@/components/Ledger/LedgerButton.vue'
import AccountsFound from '@/components/Access/AccountsFound.vue'
import PlatformSelect from '@/components/Access/PlatformSelect.vue'
import ToS from '@/components/misc/ToS.vue'
import ImageDayNight from '@/components/misc/ImageDayNight.vue'
import { getPlatform, useActivePlatformStore } from '@/platforms'
import type { AccessMethodDescriptor, PlatformId } from '@/platforms'

export default defineComponent({
    name: 'Menu',
    components: {
        ImageDayNight,
        ToS,
        LedgerButton,
        AccountsFound,
        PlatformSelect,
    },
    setup() {
        const platformStore = useActivePlatformStore()
        const route = useRoute()
        const router = useRouter()
        const { t, te } = useI18n()
        const isConnecting = ref(false)
        const connectError = ref('')

        // A multi-platform connect that opened some platforms and had others
        // declined. Held rather than navigated past — see `runAction`.
        const partialFailures = ref<{ name: string; error: string }[]>([])
        const openedCount = ref(0)
        const goToWallet = () => router.push('/wallet')

        /** Set by the platform tabs' "+" — see the banner in the template. */
        const isAddingSession = computed(() => route.query.add !== undefined)

        const accessMethods = computed(
            (): AccessMethodDescriptor[] => platformStore.activePlatform?.accessMethods ?? []
        )

        /**
         * The one-phrase multi-platform unlock, offered only when it would open
         * more than one platform. Which platforms qualify is the store's call —
         * see `mnemonicUnlockablePlatforms`.
         */
        const unlockablePlatforms = computed(() => platformStore.mnemonicUnlockablePlatforms)
        const canUnlockMultiple = computed((): boolean => unlockablePlatforms.value.length > 1)
        const multiPlatformNames = computed((): string =>
            unlockablePlatforms.value.map((p) => p.descriptor.name).join(', ')
        )
        // Carries the add-another-session marker through, so cancelling out of
        // that screen returns to this one rather than bouncing to the wallet.
        const multiUnlockTo = computed(() =>
            isAddingSession.value ? '/access/multi?add=1' : '/access/multi'
        )

        /**
         * Whether this platform can be accessed by a locally-held key, which is
         * what a saved account stores. Platforms that only connect through an
         * extension (or a remote session) have nothing to save locally.
         */
        const hasLocalKeyAccess = computed((): boolean =>
            accessMethods.value.some((m) =>
                ['mnemonic', 'privatekey', 'keystore'].includes(m.id)
            )
        )

        // Prefer the translated label, but fall back to the descriptor's plain
        // one so a platform that hasn't added translations still renders.
        const methodLabel = (method: AccessMethodDescriptor): string =>
            method.labelKey && te(method.labelKey) ? t(method.labelKey) : method.label

        const platformName = (id: PlatformId): string =>
            getPlatform(id)?.descriptor.name ?? id

        /** Whether this platform offers an extension login at all. */
        const hasInjectedMethod = computed((): boolean =>
            accessMethods.value.some((m) => m.id === 'injected')
        )

        /**
         * Platforms the installed extension can open in one pass — sampled
         * from the store's `injectedConnectablePlatforms()`, which is a plain
         * function rather than a cached `computed` precisely because it reads
         * live `window.*` provider state with nothing Vue-reactive to key a
         * cache off (see the note on it in platforms/store.ts). Held in a
         * `ref` here rather than wrapped in another `computed` for the same
         * reason: a `computed` over a plain-function call would itself cache
         * on no reactive dependency and go stale the same way the store's
         * used to.
         *
         * Refreshed on mount, with two short retries, and again immediately
         * before every connect decision in `runAction` — Core injects its
         * provider asynchronously from its own service worker into the page's
         * MAIN world, a real race against this component's first render, not
         * a hypothetical one. The retries are bounded, not a poll: a
         * still-empty result after ~1s means genuinely nothing is installed.
         */
        const injectedPlatforms = ref(platformStore.injectedConnectablePlatforms())
        const refreshInjectedPlatforms = () => {
            injectedPlatforms.value = platformStore.injectedConnectablePlatforms()
        }
        onMounted(() => {
            refreshInjectedPlatforms()
            setTimeout(refreshInjectedPlatforms, 200)
            setTimeout(refreshInjectedPlatforms, 800)
        })

        const canConnectMultiple = computed((): boolean => injectedPlatforms.value.length > 1)
        const injectedPlatformNames = computed((): string =>
            injectedPlatforms.value.map((p) => p.descriptor.name).join(', ')
        )

        /** Names the platform whose approval prompt is currently open. */
        const connectingPlatformName = computed((): string => {
            const id = platformStore.injectedConnectingId
            if (!id) return ''
            return injectedPlatforms.value.find((p) => p.descriptor.id === id)?.descriptor.name ?? ''
        })

        const runAction = async (method: AccessMethodDescriptor) => {
            if (isConnecting.value || !method.run) return
            connectError.value = ''
            partialFailures.value = []
            isConnecting.value = true
            try {
                // "Connect Wallet" means connect the extension — and one
                // extension is usually credentials for several platforms at
                // once (Core holds Bitcoin, EVM and Solana keys behind a single
                // unlock). So open every platform it can speak for, the way one
                // recovery phrase opens every platform it derives — otherwise
                // connecting Core lights up one tab and leaves the others dark
                // until the user comes back here and picks them one at a time.
                //
                // The method's own single-platform `run()` still handles the
                // ordinary case, so a platform whose extension speaks only for
                // it behaves exactly as before.
                //
                // Re-sampled right here, not trusted from render: this is the
                // moment that actually decides whether Bitcoin/EVM/Solana get
                // opened, and it must not act on a snapshot taken before the
                // extension had injected — see the note on `injectedPlatforms`.
                if (method.id === 'injected') refreshInjectedPlatforms()
                if (method.id === 'injected' && canConnectMultiple.value) {
                    const settled = await platformStore.connectWithInjected()
                    const failed = settled.filter((r) => r.status === 'failed')

                    if (failed.length === settled.length) {
                        // Nothing opened. One extension refusing every platform
                        // is one fact, usually "the user clicked Reject" — say
                        // it once rather than listing it per platform.
                        const messages = new Set(failed.map((r) => r.error))
                        connectError.value =
                            messages.size === 1
                                ? [...messages][0] ?? 'Failed to connect wallet.'
                                : failed
                                      .map((r) => `${platformName(r.platformId)}: ${r.error}`)
                                      .join(' ')
                        isConnecting.value = false
                        return
                    }

                    // A partial pass has sessions worth keeping AND something to
                    // say. Navigating straight to the wallet would throw the
                    // second away — the user would land on two tabs with no
                    // account of why the third is missing — so hold here and
                    // let them read it, the way the one-phrase unlock does.
                    if (failed.length) {
                        partialFailures.value = failed.map((r) => ({
                            name: platformName(r.platformId),
                            error: r.error ?? 'Failed to connect.',
                        }))
                        openedCount.value = settled.length - failed.length
                        isConnecting.value = false
                        return
                    }

                    router.push('/wallet')
                    return
                }

                await method.run()
            } catch (e: any) {
                connectError.value = e?.message || 'Failed to connect wallet.'
                isConnecting.value = false
            }
        }

        return {
            accessMethods,
            isAddingSession,
            canUnlockMultiple,
            multiPlatformNames,
            multiUnlockTo,
            hasLocalKeyAccess,
            methodLabel,
            platformName,
            isConnecting,
            connectError,
            hasInjectedMethod,
            canConnectMultiple,
            injectedPlatformNames,
            connectingPlatformName,
            partialFailures,
            openedCount,
            goToWallet,
            runAction,
        }
    },
})
</script>

<style scoped lang="scss">
@use "../../main";
@use '/src/components/Access/menu';

.access_card {
    margin: 0px auto;
    display: flex;
    flex-direction: column;
    align-items: center;
}

img {
    width: main.$img-size;
    height: main.$img-size;
    margin-bottom: main.$vertical-padding;
}

h1 {
    font-size: main.$l-size;
    font-weight: 400;
}

hr {
    max-width: 67% !important;
    margin: main.$vertical-padding auto 0;
    color: main.$primary-color-light;
    opacity: 0.2;
}

.accounts_menu {
    margin-bottom: 30px;
}

.options {
    display: flex;
    flex-direction: column;
}

.menu_option {
    justify-content: space-between;
    align-items: center;
    img {
        width: 24px;
        height: 24px;
        margin: 0;
        object-fit: contain;
    }
}

.connect_error {
    font-size: 13px;
    color: var(--error);
    margin: 6px 0 0;
}

.injected_hint {
    font-size: 12px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin: 6px 0 0;
    text-align: center;
}

.results {
    margin: 10px 0 4px;
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

.multi_option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    margin-bottom: 18px;
    border-radius: 6px;
    background-color: var(--bg-light);
    border: 1px solid var(--secondary-color);
    text-decoration: none;
    color: var(--primary-color);
}

.multi_title {
    font-size: 14px;
    font-weight: bold;
}

.multi_sub {
    font-size: 12px;
    color: var(--primary-color-light);
}

.menus {
    width: 440px;
    max-width: 100%;
    margin-top: 1em;
}

.add_banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    width: 440px;
    max-width: 100%;
    margin-bottom: 18px;
    padding: 10px 14px;
    border-radius: 6px;
    background-color: var(--bg-light);
    color: var(--primary-color-light);
    font-size: 12px;
    line-height: 1.5;
}

@include main.mobile-device {
    img {
        width: main.$img-size-mobile;
        height: main.$img-size-mobile;
        margin-bottom: main.$vertical-padding-mobile;
    }

    h1 {
        font-size: main.$l-size-mobile;
    }

    .card {
        padding: main.$container-padding-mobile;
    }

    .options {
        display: block;
        grid-template-columns: none;
    }
}
</style>
