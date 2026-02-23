<template>
    <div class="navbar-menu">
        <SaveAccountModal ref="saveModal"></SaveAccountModal>
        <ConfirmLogout ref="logoutRef"></ConfirmLogout>
        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    File
                </v-btn>
            </template>
            <v-list>
                <v-list-item v-if="isAuth && !isInjected" @click="saveAccount">
                    <v-list-item-title>Save Account</v-list-item-title>
                </v-list-item>
                <v-list-item v-if="isAuth" @click="logout">
                    <v-list-item-title>{{ $t('logout.button') }}</v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Wallet
                </v-btn>
            </template>
            <v-list>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Toolbox
                </v-btn>
            </template>
            <v-list>
            </v-list>
        </v-menu>

        <v-menu offset-y>
            <template v-slot:activator="{ props }">
                <v-btn text v-bind="props" class="menu-btn">
                    Help
                </v-btn>
            </template>
            <v-list>
                <v-list-item>
                    <v-list-item-title>
                        <a 
                        href="https://lfj.gg/avalanche/trade/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="wallet_link">
                            Buy AVXTO at LFJ
                        </a>
                    </v-list-item-title>
                </v-list-item>


                <v-list-item>
                    <v-list-item-title>
                        <a 
                        href="https://arenatrade.ai/token/0xf56cecc07d97ac50630022cf84c19e612ae8c93d" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="wallet_link"> 
                            Buy AVXTO at ArenaTrade
                        </a>
                    </v-list-item-title>
                </v-list-item>
                <v-list-item>
                    <v-list-item-title>
                        <a 
                        href="https://avax.to/telegram" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        class="wallet_link">
                            Join AVXTO Telegram Group
                        </a>
                    </v-list-item-title>
                </v-list-item>
            </v-list>
        </v-menu>
        <v-spacer></v-spacer>
        <network-menu class="net_menu"></network-menu>
        &nbsp;        &nbsp;
        <DayNightToggle class="hover_but"></DayNightToggle>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore, useNotificationsStore } from '@/stores'
import SaveAccountModal from '@/components/modals/SaveAccount/SaveAccountModal.vue'
import ConfirmLogout from '@/components/modals/ConfirmLogout.vue'
import NetworkMenu from '@/components/NetworkSettings/NetworkMenu.vue'
import DayNightToggle from '@/components/misc/DayNightToggle.vue'

export default defineComponent({
    name: 'NavbarMenu',
    components: {
        SaveAccountModal,
        ConfirmLogout,
        NetworkMenu,
        DayNightToggle,
    },
    setup() {
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const saveModal = ref<InstanceType<typeof SaveAccountModal>>()
        const logoutRef = ref<InstanceType<typeof ConfirmLogout>>()

        const isAuth = computed(() => mainStore.isAuth)

        const isInjected = computed(() => mainStore.activeWallet?.type === 'injected')

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

        return { isAuth, isInjected, saveModal, logoutRef, saveAccount, logout }
    },
})
</script>

<style scoped lang="scss">
@use '../main';
@use '../light_theme';

.navbar-menu {
    display: flex;
    align-items: center;
    margin-left: 0px;
    margin-right: 20px;
}

.menu-btn {
    box-shadow: none !important;
    color: var(--primary-color) !important;
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

:deep(.v-list-item-title) {
    color: var(--primary-color) !important;
    text-transform: none !important;
    font-weight: normal;
}


</style>
