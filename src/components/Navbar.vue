<template>
    <div id="nav">
        
        <router-link to="/" class="logo">
            <PlatformLogo />
        </router-link>
        <v-spacer></v-spacer>

        <div class="buts_right">
            <button
                v-if="!isAuth"
                class="action_but connect_but"
                data-cy="connect_wallet"
                @click="connectWallet"
                :disabled="isConnecting"
            >
                <span class="connect_span" v-if="isConnecting">{{ $t('access.injected.waiting') }}</span>
                <span class="connect_span" v-else>{{ $t('access.but_connect_wallet') }}</span>
            </button>
            <template v-if="!isAuth">
                <router-link to="/access" class="action_but" data-cy="access">
                    {{ $t('nav.access') }}
                </router-link>
                <router-link to="/create" class="action_but" data-cy="create">
                    {{ $t('nav.create') }}
                </router-link>
            </template>
            <p v-if="avaxPriceText" class="avax_price">
                AVAX ${{ avaxPriceText }}
            </p>
            <network-menu></network-menu>
            
        </div>

        <div class="mobile_right">
            <v-btn @click="isDrawer = !isDrawer" icon class="mobile_drawer">
                <fa icon="bars"></fa>
            </v-btn>
        </div>

        <v-navigation-drawer
            ref="drawer"
            class="mobile_menu"
            :model-value="isDrawer"
            @update:model-value="isDrawer = $event"
            fixed
            style="z-index: 999"
            hide-overlay
        >
            <v-list dense nav>
                <div style="display: flex; justify-content: space-between; padding: 4px 8px">
                    <img src="@/assets/wallet_logo_dark.svg" />
                </div>
                <template v-if="isAuth">
                    <router-link to="/wallet">{{ $t('wallet.sidebar.portfolio') }}</router-link>
                    <router-link to="/wallet/transfer">{{ $t('wallet.sidebar.send') }}</router-link>
                    <router-link v-if="!isSingleton && canCrossChain" to="/wallet/cross_chain">
                        {{ $t('wallet.sidebar.export') }}
                    </router-link>
                    <router-link v-if="canStake" to="/wallet/earn">
                        {{ $t('wallet.sidebar.earn') }}
                    </router-link>
                    <router-link to="/wallet/activity">Activity</router-link>
                    <router-link to="/wallet/keys">{{ $t('wallet.sidebar.manage') }}</router-link>
                    <router-link v-if="isMultiChain" to="/wallet/advanced" data-cy="wallet_advanced">
                        {{ $t('wallet.sidebar.advanced') }}
                    </router-link>
                                        
                </template>

                <div class="mobile_bottom">
                    <AccountMenu></AccountMenu>
                </div>
            </v-list>
        </v-navigation-drawer>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import LanguageSelect from './misc/LanguageSelect/LanguageSelect.vue'

import NetworkMenu from './NetworkSettings/NetworkMenu.vue'

import AccountMenu from '@/components/wallet/sidebar/AccountMenu.vue'
import PlatformLogo from '@/components/misc/PlatformLogo.vue'
import { useActivePlatformStore } from '@/platforms'

export default defineComponent({
    name: 'Navbar',
    components: {
        AccountMenu,
        NetworkMenu,
        LanguageSelect,
        PlatformLogo
    },
    setup() {
        const mainStore = useMainStore()
        const platformStore = useActivePlatformStore()

        const isDrawer = ref(false)
        const popupOpen = ref(false)
        const isConnecting = ref(false)

        // Capability-gated nav, matching Sidebar.vue: a single-EVM-chain
        // platform shows no cross-chain / staking / X-P surfaces.
        const isMultiChain = computed(() => platformStore.isMultiChain)
        const canCrossChain = computed(() => platformStore.can('crossChain'))
        const canStake = computed(() => platformStore.can('stake'))

        const isAuth = computed((): boolean => {
            return mainStore.isAuth
        })

        const isSingleton = computed(() => mainStore.activeWallet?.type === 'singleton')

        const avaxPriceText = computed((): string | null => {
            // The price feed only tracks AVAX, so this must not render while a
            // platform with a different native asset is active — it would label
            // an AVAX price with that platform's ticker.
            if (platformStore.activePlatform?.descriptor.symbol !== 'AVAX') return null
            const usd = mainStore.prices.usd
            if (typeof usd !== 'number' || isNaN(usd) || usd <= 0) return null
            return usd.toFixed(2)
        })

        const togglePopup = (): void => {
            popupOpen.value = !popupOpen.value
        }

        const connectWallet = async () => {
            if (isConnecting.value) return
            isConnecting.value = true
            try {
                await mainStore.accessWalletInjected()
            } catch (e: any) {
                console.error('Wallet connection failed:', e)
                alert(e?.message || 'Failed to connect wallet.')
            } finally {
                isConnecting.value = false
            }
        }

        return {
            isDrawer,
            popupOpen,
            isAuth,
            isSingleton,
            avaxPriceText,
            isConnecting,
            isMultiChain,
            canCrossChain,
            canStake,
            togglePopup,
            connectWallet,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../main';
@use "../light_theme";

img {
    max-height: 25px;
}

a {
    text-decoration: none;
    font-weight: normal;
    white-space: nowrap;
    margin-right: 15px;
}

button {
    font-weight: normal;
}

.popup-wrapper {
    position: relative;
}

.popup {
    position: absolute;
    top: 18px;
    right: 0;
    padding: 8px;
    padding-bottom: 10px;
    box-shadow: 2px 2px 12px rgba(0, 0, 0, 0.4);
    min-width: 280px;
    border: 1px solid var(--bg-light);
    background: var(--bg);
    border-radius: 3px;
}

.daynight {
    margin-right: 15px;
}

.connect_span {
    color: var(--primary-color);
    font-size: var(--bs-body-font-size);
}

#nav {
    border-bottom: 1px solid #636363;
    .logo {
        display: flex;
        align-items: center;
        color: var(--primary-color-light) !important;
        font-size: 11px;
        font-weight: 700;

        &:hover {
            opacity: 0.7;
        }

        img {
            height: 50px;
            max-height: none !important;
            object-fit: contain;
            margin-right: 5px;
        }

        // The logo is now an inline SVG (PlatformLogo) so it can be tinted per
        // platform. It declares width:100% for the sidebar's fixed-width brand
        // slot, so here it needs an explicit height and an auto width or the
        // flex row would stretch it across the nav.
        :deep(.platform_logo) {
            height: 50px;
            width: auto;
            margin-right: 5px;
        }
    }
}

.buts_right {
    display: flex;
    align-items: center;
    justify-content: flex-end;

    a {
        margin: 0;
    }
}

.action_but {
    color: var(--primary-color) !important;
    padding: 0 12px;
    border-radius: 4px;
}

.avax_price {
    font-size: 14px;
    color: var(--primary-color);
    white-space: nowrap;
    margin: 0 12px !important;

    b {
        color: var(--secondary-color);
    }
}

.mobile_right {
    display: none;
}

.mobile_menu {
    display: none;
}

.mobile_bottom {
    position: absolute;
    bottom: 30px;

    > * {
        padding: 4px 8px;
    }
}

.lang_mobile,
.lang_web {
    width: max-content;
    margin: 0;
}

// A native <select> takes its intrinsic width from its widest <option>
// ("Nederlands, Vlaams", ~152px) rather than the selected one, so a short
// value like "English" (~58px) rendered left-aligned inside that box left a
// ~95px gap before the nav's right edge — even though the element itself is
// already flush. Right-align the rendered value so the visible text ends at
// the edge. Scoped to .lang_web so the drawer's .lang_mobile stays as-is.
.lang_web :deep(select) {
    text-align: right;
    text-align-last: right;
}

@include main.medium-device {
    img {
        max-height: 18px;
    }
    .buts_right {
        button {
            font-size: 11px;
        }
    }
}

@include main.mobile-device {
    .lang_web {
        display: none;
    }

    .buts_right {
        display: none;

        .router-link-exact-active {
            background-color: #42b983;
        }
    }

    .mobile_right {
        display: block;
    }

    .mobile_menu {
        display: block;
    }

    .mobile_drawer {
        color: var(--primary-color) !important;
    }
}
</style>
<style lang="scss">
.mobile_menu {
    overflow: visible !important;
    background-color: var(--bg-light) !important;

    .v-list-item,
    .v-list-item--link {
        color: var(--primary-color-light) !important;
    }

    .v-list-item--active {
        color: var(--primary-color) !important;
    }

    a {
        display: block;
        padding: 8px 8px;
        color: var(--primary-color-light) !important;
    }

    .router-link-exact-active {
        background-color: var(--bg);
        color: var(--primary-color) !important;
    }
}
</style>
