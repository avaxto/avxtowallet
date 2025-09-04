<template>
    <div class="main_panel">
        <ConfirmLogout ref="logoutModal"></ConfirmLogout>
        <div class="panel_nav">
            <DayNightToggle class="hover_but"></DayNightToggle>
            <network-menu class="net_menu"></network-menu>
            <button @click="logout" class="logout">
                {{ $t('logout.button') }}
            </button>
        </div>
        <transition name="fade" mode="out-in">
            <transaction-history-panel class="panel_content"></transaction-history-panel>
        </transition>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

import NetworkMenu from '../NetworkSettings/NetworkMenu.vue'
import TransactionHistoryPanel from './TransactionHistoryPanel.vue'
import DayNightToggle from '@/components/misc/DayNightToggle.vue'
import ConfirmLogout from '@/components/modals/ConfirmLogout.vue'

export default defineComponent({
    name: 'MainPanel',
    components: {
        NetworkMenu,
        TransactionHistoryPanel,
        DayNightToggle,
        ConfirmLogout,
    },
    setup() {
        const logoutModal = ref<InstanceType<typeof ConfirmLogout>>()

        const logout = () => {
            logoutModal.value?.open()
        }

        return {
            logout,
            logoutModal
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.main_panel {
    display: grid;
    grid-template-rows: max-content 1fr;
    row-gap: 6px;
}
.panel_nav {
    background-color: var(--bg-wallet-light);
    /*display: flex;*/
    /*align-items: center;*/
    /*flex-direction: row;*/
    display: grid;
    grid-template-columns: max-content max-content 1fr;
    /*justify-content: space-between;*/
    padding: 24px 16px;
    font-size: 14px;

    > * {
        outline: none !important;
        padding: 4px 8px;
        border-radius: 4px;
    }
}

.hover_but {
    transition-duration: 0.2s;
    cursor: pointer;
    &:hover {
        box-shadow: 1px 1px 4px 1px rgba(0, 0, 0, 0.3);
    }
}

.panel_content {
    overflow: auto;
    background-color: var(--bg-wallet-light);
    height: 100%;
}

.logout {
    margin-left: auto;
}

@include main.medium-device {
    .panel_nav {
        padding: 12px 16px;
    }
}
</style>
