<template>
    <div class="navbar-menu">
        <SaveAccountModal ref="saveModal"></SaveAccountModal>
        <ConfirmLogout ref="logoutRef"></ConfirmLogout>
        <AboutModal ref="aboutModal"></AboutModal>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">File</v-btn>
            </template>
            <v-list>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/config">Settings</router-link>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item v-if="isAuth && !isInjected" @click="saveAccount">
                    <v-list-item-title>Save Account</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth">
                    <v-list-item-title>
                        <router-link to="/wallet/log">Log</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth" @click="logout">
                    <v-list-item-title>Exit</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <!--
            Unconditional, not gated on the active platform: every item below
            is EITHER platform-gated individually (the Avalanche X/P/staking
            tools) OR meaningful on any platform at all (Token Launcher, Solana
            Address Shape) — so there is no platform for which this menu would
            be genuinely empty, and no reason to hide the whole menu while
            deciding that per item. This also means a future platform this
            file has never heard of still gets the ungated tools for free,
            with no edit needed here.
        -->
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Toolbox</v-btn>
            </template>
            <v-list>
                <!--
                    Addresses / Address Derivation / Unify Chains / Quick
                    Delegate are X/P-chain and staking concepts, so they are
                    gated per-item on `isAvalanche` — there is nothing for them
                    to do on a single-chain platform. Token Launcher is the
                    opposite: it deploys a plain ERC-20, which is equally
                    meaningful on either EVM-capable platform (see
                    js/TokenLauncher.ts — chain-neutral via EvmSigner), so it
                    carries no gate of its own. Decode Solana Address is the
                    same story again: a plain base58 decode of a pasted
                    address, meaningful regardless of which platform is
                    active, so it is likewise ungated.
                -->
                <v-list-item v-if="isAvalanche">
                    <v-list-item-title>
                        <router-link to="/wallet/addresses">Addresses</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche">
                    <v-list-item-title>
                        <router-link to="/wallet/addresses/derive">Address Derivation</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche">
                    <v-list-item-title>
                        <router-link to="/wallet/unifychains">Unify Chains</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche">
                    <v-list-item-title>
                        <router-link to="/wallet/quickdelegate">Quick Delegate</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche">
                    <v-list-item-title>
                        <router-link to="/wallet/psat">Multisig / PSAT</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/launcher">Token Launcher</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/soladdr">Decode Solana Address</router-link>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Trading</v-btn>
            </template>
            <v-list>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/iceberg">Iceberg Order</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/swap">Token Swap</router-link>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Arena</v-btn>
            </template>
            <v-list>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/bridge">ARENA Bridge</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://arenatrade.ai/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            ArenaTrade
                        </a>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <AvxtoMenu></AvxtoMenu>

        <v-menu offset-y v-if="isAvalanche">
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Avalanche</v-btn>
            </template>
            <v-list>
                <v-list-item>
                    <v-list-item-title>
                        <router-link to="/wallet/earn/rewards">Estimated Rewards</router-link>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://notify.avax.network/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            Validator Monitoring
                        </a>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://core.app/download"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            Download Core App
                        </a>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Help</v-btn>
            </template>
            <v-list>
                <v-list-item @click="openAbout">
                    <v-list-item-title>About</v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://avax.to/telegram"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            AVXTO Telegram Group
                        </a>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://avax.to/avxto/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            AVXTO Manual and Blog
                        </a>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://avax.to/avxto/quick-start/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            AVXTO Quick Start
                        </a>
                    </v-list-item-title>
                </v-list-item>

                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://avax.to/avxto/faq/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            AVXTO FAQ
                        </a>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://avax.to/avxto/privacy/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            AVXTO Privacy
                        </a>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://github.com/avaxto/avxtowallet/issues/new"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            Report Issue
                        </a>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a
                            href="https://github.com/avaxto/avxtowallet/issues"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="wallet_link"
                        >
                            Check Issues
                        </a>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-spacer></v-spacer>
        <p v-if="avaxPriceText" class="avax_price">AVAX ${{ avaxPriceText }}</p>
        <network-menu v-if="isAvalanche" class="net_menu"></network-menu>
        <evm-network-menu v-else-if="isEvm" class="net_menu"></evm-network-menu>
        <solana-network-menu v-else-if="isSolana" class="net_menu"></solana-network-menu>
        <bitcoin-network-menu v-else-if="isBitcoin" class="net_menu"></bitcoin-network-menu>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore, useNotificationsStore } from '@/stores'
import { useActivePlatformStore } from '@/platforms'
import SaveAccountModal from '@/components/modals/SaveAccount/SaveAccountModal.vue'
import ConfirmLogout from '@/components/modals/ConfirmLogout.vue'
import AboutModal from '@/components/modals/AboutModal.vue'
import NetworkMenu from '@/components/NetworkSettings/NetworkMenu.vue'
import EvmNetworkMenu from '@/components/NetworkSettings/EvmNetworkMenu.vue'
import SolanaNetworkMenu from '@/components/NetworkSettings/SolanaNetworkMenu.vue'
import BitcoinNetworkMenu from '@/components/NetworkSettings/BitcoinNetworkMenu.vue'
import AvxtoMenu from '@/components/AvxtoMenu.vue'

export default defineComponent({
    name: 'NavbarMenu',
    components: {
        SaveAccountModal,
        ConfirmLogout,
        AboutModal,
        NetworkMenu,
        EvmNetworkMenu,
        SolanaNetworkMenu,
        BitcoinNetworkMenu,
        AvxtoMenu,
    },
    setup() {
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const platformStore = useActivePlatformStore()
        const saveModal = ref<InstanceType<typeof SaveAccountModal>>()
        const logoutRef = ref<InstanceType<typeof ConfirmLogout>>()
        const aboutModal = ref<InstanceType<typeof AboutModal>>()

        // `mainStore.isAuth`/`activeWallet` only ever reflect Avalanche access —
        // each platform keeps its own session store (see
        // platforms/evm/store.ts), so a menu gated on those alone stays
        // permanently "logged out" on any other platform. `platformStore.
        // activeWallet` is the generic, platform-agnostic equivalent (backed by
        // mainStore.activeWallet for Avalanche, so behaviour there is unchanged).
        const isAuth = computed(() => platformStore.activeWallet !== null)

        const isInjected = computed(() => platformStore.activeWallet?.accessMethodId === 'injected')

        // Avalanche's network switcher is not generic — switching it re-points
        // the Avalanche SDK and both web3 singletons, so it must only render
        // while Avalanche is the active platform. See Navbar.vue.
        const isAvalanche = computed(
            () => platformStore.hasChainKind('utxo') || platformStore.hasChainKind('staking')
        )
        const isEvm = computed(() => platformStore.activePlatformId === 'evm')
        const isSolana = computed(() => platformStore.activePlatformId === 'solana')
        const isBitcoin = computed(() => platformStore.activePlatformId === 'bitcoin')

        const avaxPriceText = computed((): string | null => {
            const usd = mainStore.prices.usd
            if (typeof usd !== 'number' || isNaN(usd) || usd <= 0) return null
            return usd.toFixed(2)
        })

        const saveAccount = () => {
            if (isInjected.value) {
                notificationsStore.add({
                    title: 'Cannot Save Account',
                    message:
                        'Extension wallets like Core App and Metamask cannot be backed up using AVXTO Wallet because the private keys are stored in the extension only.',
                    type: 'warning',
                })
                return
            }
            saveModal.value?.open()
        }

        const logout = () => {
            logoutRef.value?.open()
        }

        const openAbout = () => {
            aboutModal.value?.open()
        }

        return {
            isAuth,
            isInjected,
            isAvalanche,
            isEvm,
            isSolana,
            isBitcoin,
            avaxPriceText,
            saveModal,
            logoutRef,
            aboutModal,
            saveAccount,
            logout,
            openAbout,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../main';
@use '../light_theme';

.wallet_link {
    font-size: 14px !important;
    color: var(--primary-color) !important;
    text-decoration: none;
}

// Vuetify applies its own text color straight to the <a>/router-link
// rendered inside .v-list-item-title, so color:inherit from the title
// wrapper (see the :deep(.v-list-item-title) rule below) never actually
// reached it — same fix as Sidebar.vue's nav links: set the theme-aware
// color explicitly, right on the link itself.
:deep(.v-list-item-title a),
:deep(.v-list-item-title .router-link-active) {
    color: var(--primary-color) !important;
    text-decoration: none;
}

.menu-btn {
    font-size: 14px !important;
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

.v-list-item-title {
    font-size: 14px !important;
}

.navbar-menu {
    display: flex;
    align-items: center;
    margin-left: 0px;
    margin-right: 20px;
}

.menu-btn {
    box-shadow: none !important;
    text-transform: none !important;

    &:hover,
    &:focus-visible,
    &:active {
        background-color: rgba(0, 0, 0, 0.05) !important;
    }
}

@include main.night-mode {
    .menu-btn {
        &:hover,
        &:focus-visible,
        &:active {
            background-color: rgba(255, 255, 255, 0.07) !important;
        }
    }
}

:deep(.v-overlay__content .v-list) {
    background-color: var(--bg-light) !important;
    color: var(--primary-color) !important;
    border: 1px solid var(--bg-light);
}

:deep(.v-list-item:hover) {
    background-color: var(--bg) !important;
}

:deep(.v-list-item--density-default) {
    min-height: 25px !important;
}

:deep(.v-list-item-title) {
    color: var(--primary-color) !important;
    text-transform: none !important;
    font-weight: normal;
}
</style>
