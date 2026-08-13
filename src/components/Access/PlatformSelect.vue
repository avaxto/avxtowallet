<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="platform_select">
        <label class="platform_label">Platform</label>
        <div class="platform_options">
            <button
                v-for="p in platforms"
                :key="p.descriptor.id"
                type="button"
                class="platform_option"
                :class="{
                    active: p.descriptor.id === activePlatformId,
                    planned: p.descriptor.status !== 'available',
                }"
                :disabled="p.descriptor.status !== 'available'"
                :title="p.descriptor.description"
                @click="select(p.descriptor.id)"
            >
                <span class="platform_head">
                    <img v-if="p.descriptor.icon" :src="p.descriptor.icon" class="platform_icon" />
                    <span class="platform_name">{{ p.descriptor.name }}</span>
                </span>
                <span class="platform_meta">
                    {{ p.descriptor.status === 'available' ? p.descriptor.symbol : 'Coming soon' }}
                </span>
            </button>
        </div>
        <p v-if="error" class="platform_error">{{ error }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useActivePlatformStore } from '@/platforms'
import type { PlatformId } from '@/platforms'

export default defineComponent({
    name: 'PlatformSelect',
    setup() {
        const platformStore = useActivePlatformStore()
        const error = ref('')

        const platforms = computed(() => platformStore.platforms)
        const activePlatformId = computed(() => platformStore.activePlatformId)

        const select = async (id: PlatformId) => {
            error.value = ''
            try {
                await platformStore.setActivePlatform(id)
            } catch (e: any) {
                error.value = e?.message ?? 'Could not switch platform.'
            }
        }

        return { platforms, activePlatformId, error, select }
    },
})
</script>

<style scoped lang="scss">
.platform_select {
    margin-bottom: 24px;
}

.platform_label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--primary-color-light);
    margin-bottom: 8px;
}

.platform_options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
}

.platform_option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 10px 12px;
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    background-color: var(--bg-light);
    color: var(--primary-color);
    cursor: pointer;
    text-align: left;
    font-size: 14px;

    &:hover:not(:disabled) {
        border-color: var(--secondary-color);
    }

    &.active {
        border-color: var(--secondary-color);
        color: var(--secondary-color);
        font-weight: 600;
    }

    &.planned,
    &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }
}

.platform_head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
}

.platform_icon {
    width: 20px;
    height: 20px;
    border-radius: 20px;
    object-fit: contain;
    flex-shrink: 0;
}

.platform_name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.platform_meta {
    font-size: 11px;
    color: var(--primary-color-light);
}

.platform_error {
    margin-top: 8px !important;
    font-size: 13px;
    color: var(--error);
}
</style>
