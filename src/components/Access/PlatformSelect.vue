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
        <!--
          Some platforms cannot share a page with another live session (see
          `supportsConcurrentSession`), so selecting one has to end every
          session that is already open. That is a real loss — an in-memory
          vault means re-entering the phrase and password — so it is confirmed
          rather than done silently on the first click.
        -->
        <div v-if="pending" class="platform_confirm">
            <p class="confirm_text">
                Opening <b>{{ pending.name }}</b> closes your other open
                {{ pending.openCount === 1 ? 'session' : 'sessions' }}. You'll need to unlock
                {{ pending.openCount === 1 ? 'it' : 'them' }} again.
            </p>
            <div class="confirm_buts">
                <button type="button" class="confirm_but" @click="confirmPending">Continue</button>
                <button type="button" class="cancel_but" @click="pending = null">Cancel</button>
            </div>
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

        /** Set while a session-ending switch is waiting to be confirmed. */
        const pending = ref<{ id: PlatformId; name: string; openCount: number } | null>(null)

        const switchTo = async (id: PlatformId) => {
            error.value = ''
            try {
                await platformStore.setActivePlatform(id)
            } catch (e: any) {
                error.value = e?.message ?? 'Could not switch platform.'
            }
        }

        const select = async (id: PlatformId) => {
            error.value = ''
            pending.value = null

            if (platformStore.isDestructiveSwitch(id)) {
                pending.value = {
                    id,
                    name: platforms.value.find((p) => p.descriptor.id === id)?.descriptor.name ?? id,
                    openCount: platformStore.connectedPlatforms.length,
                }
                return
            }

            await switchTo(id)
        }

        const confirmPending = async () => {
            const target = pending.value
            if (!target) return
            pending.value = null
            await switchTo(target.id)
        }

        return { platforms, activePlatformId, error, pending, select, confirmPending }
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

.platform_confirm {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--secondary-color);
    border-radius: 6px;
    background-color: var(--bg-light);
}

.confirm_text {
    font-size: 12px;
    line-height: 1.5;
    color: var(--primary-color);
}

.confirm_buts {
    display: flex;
    gap: 8px;
    margin-top: 10px;
}

.confirm_but,
.cancel_but {
    padding: 5px 12px;
    border-radius: 4px;
    border: 1px solid transparent;
    font-size: 12px;
    cursor: pointer;
}

.confirm_but {
    background-color: var(--secondary-color);
    color: var(--bg);
    font-weight: 600;
}

.cancel_but {
    background-color: transparent;
    border-color: var(--bg);
    color: var(--primary-color-light);

    &:hover {
        color: var(--primary-color);
    }
}
</style>
