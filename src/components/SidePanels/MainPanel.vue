<template>
    <div class="main_panel">
        <transition name="fade" mode="out-in">
            <transaction-history-panel class="panel_content"></transaction-history-panel>
        </transition>
    </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import TransactionHistoryPanel from './TransactionHistoryPanel.vue'

export default defineComponent({
    name: 'MainPanel',
    components: {
        TransactionHistoryPanel,
    },
    setup() {
        return {}
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.main_panel {
    display: grid;
    grid-template-rows: 1fr;
    row-gap: 6px;
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
