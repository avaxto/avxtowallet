<!--
  Menu items that go somewhere put the link ON the row — `<v-list-item to=…>`
  or `href=…` — never on a <router-link>/<a> inside its title. The row is
  full-width and highlights on hover, so it reads as the thing to click, but a
  link wrapping only the text left most of it dead: a click there closed the
  menu and went nowhere, which users met as items that "do nothing the first
  time" and then work when a later click happens to land on the words.
  tests/navbarMenuClicks pins it.
-->
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
                <v-list-item to="/wallet/config">
                    <v-list-item-title>Settings</v-list-item-title>
                </v-list-item>

                <v-list-item v-if="isAuth && !isInjected" @click="saveAccount">
                    <v-list-item-title>Save Account</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth" to="/wallet/log">
                    <v-list-item-title>Log</v-list-item-title>
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
                    Address Derivation / Unify Chains / Quick Delegate are
                    X/P-chain and staking concepts, so they stay gated on
                    `isAvalanche` — there is nothing for them to do on a
                    single-chain platform. Addresses used to be gated the same
                    way; it no longer is, because `/wallet/addresses` now
                    dispatches per platform (see Addresses.vue) instead of
                    being the Avalanche X/P page alone — Bitcoin gets its own
                    HD receive/change listing there, Solana and EVM their fixed
                    address, so the item is meaningful everywhere now. Token
                    Launcher is ungated for its own, older reason: it deploys a
                    plain ERC-20, equally meaningful on either EVM-capable
                    platform (see js/TokenLauncher.ts — chain-neutral via
                    EvmSigner). Decode Solana Address is the same story again:
                    a plain base58 decode of a pasted address, meaningful
                    regardless of which platform is active. Bitcoin Derived
                    Addresses goes back to the Avalanche-item pattern instead
                    — it only means anything for a Bitcoin mnemonic wallet's
                    own seed, so it is gated on `isBitcoin` the same way those
                    are gated on `isAvalanche`.
                -->
                <v-list-item to="/wallet/addresses">
                    <v-list-item-title>Addresses</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche" to="/wallet/addresses/derive">
                    <v-list-item-title>Address Derivation</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche" to="/wallet/broadcast">
                    <v-list-item-title>Broadcast Signed TX</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche" to="/wallet/wizard">
                    <v-list-item-title>Wallet Wizard</v-list-item-title>
                </v-list-item>
                
                <v-list-item v-if="isAvalanche" to="/wallet/unifychains">
                    <v-list-item-title>Unify Chains</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche" to="/wallet/quickdelegate">
                    <v-list-item-title>Quick Delegate</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAvalanche" to="/wallet/psat">
                    <v-list-item-title>Multisig / PSAT</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/launcher">
                    <v-list-item-title>Token Launcher</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/soladdr">
                    <v-list-item-title>Decode Solana Address</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isBitcoin" to="/wallet/btcderive">
                    <v-list-item-title>Bitcoin Derived Addresses</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Trading</v-btn>
            </template>
            <v-list>
                <v-list-item to="/wallet/iceberg">
                    <v-list-item-title>Iceberg Order</v-list-item-title>
                </v-list-item>
                <v-list-item to="/wallet/swap">
                    <v-list-item-title>Token Swap</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <AvxtoMenu></AvxtoMenu>

        <v-menu offset-y v-if="isAvalanche">
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Avalanche</v-btn>
            </template>
            <v-list>
                <v-list-item to="/wallet/earn/rewards">
                    <v-list-item-title>Estimated Rewards</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://notify.avax.network/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>Validator Monitoring</v-list-item-title>
                </v-list-item>

                <v-list-item
                    href="https://core.app/download"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>Download Core App</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">Arena</v-btn>
            </template>
            <v-list>
                <v-list-item to="/wallet/bridge">
                    <v-list-item-title>ARENA Bridge</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://arenatrade.ai/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>ArenaTrade</v-list-item-title>
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
                <v-list-item
                    href="https://avax.to/telegram"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO Telegram Group</v-list-item-title>
                </v-list-item>

                <v-list-item
                    href="https://avax.to/avxto/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO Manual and Blog</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://avax.to/avxto/quick-start/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO Quick Start</v-list-item-title>
                </v-list-item>

                <v-list-item
                    href="https://avax.to/avxto/faq/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO FAQ</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://avax.to/avxto/privacy/"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>AVXTO Privacy</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://github.com/avaxto/avxtowallet/issues/new"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>Report Issue</v-list-item-title>
                </v-list-item>
                <v-list-item
                    href="https://github.com/avaxto/avxtowallet/issues"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <v-list-item-title>Check Issues</v-list-item-title>
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

// Link rows render as <a class="v-list-item"> (see the note atop the
// template). Bootstrap styles every <a> as an underlined link-coloured one,
// and Vuetify tints the row for the current route; neither is how these menus
// have ever looked, so both are put back to a plain item.
:deep(a.v-list-item) {
    color: var(--primary-color) !important;
    text-decoration: none !important;
}

:deep(.v-list-item--active > .v-list-item__overlay) {
    opacity: 0 !important;
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
