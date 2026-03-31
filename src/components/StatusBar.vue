<template>
    <transition name="statusbar-slide">
        <div v-if="store.visible" class="status-bar" :class="store.type">
            <span v-if="store.loading" class="status-bar__spinner"></span>
            <span class="status-bar__message">{{ store.message }}</span>
            <button class="status-bar__close" @click="store.clear" aria-label="Dismiss">&#x2715;</button>
        </div>
    </transition>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import { useStatusBarStore } from '@/stores/statusbar'

export default defineComponent({
    name: 'StatusBar',
    setup() {
        const store = useStatusBarStore()
        return { store }
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
    padding: 6px 20px;
    font-size: 13px;
    min-height: 30px;
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.2);

    &.info    { background-color: #2196f3; color: #fff; }
    &.success { background-color: #4caf50; color: #fff; }
    &.warning { background-color: #ff9800; color: #fff; }
    &.error   { background-color: #f44336; color: #fff; }
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

/* Spinner */
.status-bar__spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid rgba(255, 255, 255, 0.4);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    flex-shrink: 0;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

/* Slide-up / slide-down transition */
.statusbar-slide-enter-active,
.statusbar-slide-leave-active {
    transition: transform 0.25s ease, opacity 0.25s ease;
}
.statusbar-slide-enter-from,
.statusbar-slide-leave-to {
    transform: translateY(100%);
    opacity: 0;
}
</style>
