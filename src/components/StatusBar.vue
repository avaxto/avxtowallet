<template>
    <div class="status-bar" :class="store.visible ? store.type : 'idle'">
        <span v-if="store.visible && store.loading" class="status-bar__spinner"></span>
        <span v-else class="status-bar__dot" :style="{ backgroundColor: dotColor }"></span>
        <span class="status-bar__message">{{ displayMessage }}</span>
        <button
            v-if="store.visible"
            class="status-bar__close"
            @click="store.clear"
            aria-label="Dismiss"
        >
            &#x2715;
        </button>
        <span v-if="store.rightMessage" class="status-bar__right">{{ store.rightMessage }}</span>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStatusBarStore } from '@/stores/statusbar'
import { useNetworkStore } from '@/stores'

export default defineComponent({
    name: 'StatusBar',
    setup() {
        const store = useStatusBarStore()
        const networkStore = useNetworkStore()

        // When there's no active transient message, the bar falls back to
        // showing live connection status — so it always reads something,
        // like a native app's persistent status line, instead of just
        // vanishing when idle.
        const idleMessage = computed(() => {
            const net = networkStore.selectedNetwork
            switch (networkStore.status) {
                case 'connected':
                    return net ? `Connected — ${net.name}` : 'Connected'
                case 'connecting':
                    return 'Connecting…'
                default:
                    return 'Disconnected'
            }
        })

        const dotColor = computed(() => {
            if (store.visible) {
                return {
                    info: '#2196f3',
                    success: '#4caf50',
                    warning: '#ff9800',
                    error: '#f44336',
                }[store.type]
            }
            switch (networkStore.status) {
                case 'connected':
                    return '#4caf50'
                case 'connecting':
                    return '#ff9800'
                default:
                    return '#f44336'
            }
        })

        const displayMessage = computed(() => (store.visible ? store.message : idleMessage.value))

        return { store, displayMessage, dotColor }
    },
})
</script>

<style scoped lang="scss">
.status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 20px;
    font-size: 12px;
    min-height: 26px;

    // Always the same subtle, native-status-line look — no colored ribbon.
    // Severity (info/success/warning/error) is conveyed only by the small
    // dot next to the message, not by the bar's background.
    background-color: var(--bg-light);
    color: var(--primary-color-light);
}

.status-bar__message {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.status-bar__close {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 4px;
    opacity: 0.8;

    &:hover { opacity: 1; }
}

// Far-right status slot — like the clock in a Windows taskbar. Always the
// last item, so .status-bar__message's flex:1 pushes it to the far edge.
.status-bar__right {
    flex-shrink: 0;
    white-space: nowrap;
    padding-left: 10px;
    margin-left: 4px;
    border-left: 1px solid currentColor;
    opacity: 0.85;
}

.status-bar__dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* Spinner (only shown while an active message is loading) */
.status-bar__spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid currentColor;
    border-top-color: transparent;
    opacity: 0.7;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
</style>
