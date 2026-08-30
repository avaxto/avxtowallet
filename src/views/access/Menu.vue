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
                            <span v-if="isConnecting">{{ $t('access.injected.waiting') }}</span>
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
            </div>
        </div>

        <ToS style="margin: 20px !important"></ToS>
        <router-link to="/" class="link">{{ $t('access.cancel') }}</router-link>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LedgerButton from '@/components/Ledger/LedgerButton.vue'
import AccountsFound from '@/components/Access/AccountsFound.vue'
import PlatformSelect from '@/components/Access/PlatformSelect.vue'
import ToS from '@/components/misc/ToS.vue'
import ImageDayNight from '@/components/misc/ImageDayNight.vue'
import { useActivePlatformStore } from '@/platforms'
import type { AccessMethodDescriptor } from '@/platforms'

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
        const { t, te } = useI18n()
        const isConnecting = ref(false)
        const connectError = ref('')

        /** Set by the platform tabs' "+" — see the banner in the template. */
        const isAddingSession = computed(() => route.query.add !== undefined)

        const accessMethods = computed(
            (): AccessMethodDescriptor[] => platformStore.activePlatform?.accessMethods ?? []
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

        const runAction = async (method: AccessMethodDescriptor) => {
            if (isConnecting.value || !method.run) return
            connectError.value = ''
            isConnecting.value = true
            try {
                await method.run()
            } catch (e: any) {
                connectError.value = e?.message || 'Failed to connect wallet.'
                isConnecting.value = false
            }
        }

        return {
            accessMethods,
            isAddingSession,
            hasLocalKeyAccess,
            methodLabel,
            isConnecting,
            connectError,
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
