<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  One tab per connected platform, plus a button to open another session.

  Only renders platforms that actually have a wallet — see `connectedPlatforms`
  in platforms/store.ts. Switching between two platforms that both declare
  `supportsConcurrentSession` is instant and lossless (no logout, no reload),
  which is the whole point of the strip; the store decides that, not this
  component.

  The close button appears only on the ACTIVE tab. Disconnecting drops an
  in-memory vault — the phrase and session password would both have to be
  entered again — so it deliberately takes two deliberate clicks (switch to the
  tab, then close it) rather than one stray click on a background tab.
-->
<template>
    <div v-if="tabs.length" class="platform_tabs">
        <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="tab"
            :class="{ active: tab.active }"
            :title="tab.address || tab.name"
            @click="select(tab.id)"
        >
            <span class="dot" :style="{ backgroundColor: tab.color }"></span>
            <span class="labels">
                <span class="name">{{ tab.name }}</span>
                <span v-if="tab.address" class="addr">{{ tab.address }}</span>
            </span>
            <span
                v-if="tab.active"
                class="close"
                role="button"
                :aria-label="`Disconnect ${tab.name}`"
                :title="`Disconnect ${tab.name}`"
                @click.stop="disconnect(tab.id)"
            >
                &#x2715;
            </span>
        </button>

        <router-link
            to="/access?add=1"
            class="add_tab"
            title="Connect another platform"
            aria-label="Connect another platform"
        >
            +
        </router-link>

        <p v-if="error" class="tabs_error">{{ error }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { getPlatform, useActivePlatformStore } from '@/platforms'
import type { PlatformId } from '@/platforms'

interface PlatformTab {
    id: PlatformId
    name: string
    address: string
    color: string
    active: boolean
}

/** Enough of an address to recognise, short enough to sit in a tab. */
function truncate(address: string): string {
    if (address.length <= 14) return address
    return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export default defineComponent({
    name: 'PlatformTabs',
    setup() {
        const platformStore = useActivePlatformStore()
        const error = ref('')

        const tabs = computed((): PlatformTab[] =>
            platformStore.connectedPlatforms.map((p) => ({
                id: p.descriptor.id,
                name: p.descriptor.name,
                // Not every platform declares a theme (Avalanche doesn't), so
                // fall back to the app accent rather than rendering no dot.
                color: p.descriptor.theme?.logo ?? 'var(--secondary-color)',
                address: truncate(p.getActiveWallet()?.getPrimaryAddress() ?? ''),
                active: p.descriptor.id === platformStore.activePlatformId,
            }))
        )

        const select = async (id: PlatformId) => {
            if (id === platformStore.activePlatformId) return
            error.value = ''
            try {
                await platformStore.setActivePlatform(id)
            } catch (e: any) {
                error.value = e?.message ?? 'Could not switch platform.'
            }
        }

        const disconnect = async (id: PlatformId) => {
            error.value = ''
            try {
                // Looked up by id rather than assuming the active platform:
                // the close button only renders on the active tab today, but a
                // logout that silently targets something else if that ever
                // changes is the wrong kind of bug to leave available.
                // The platform's own logout tears down its store and then hands
                // off to `finishDisconnect`, which moves to a remaining session
                // or resets the app when this was the last one.
                await getPlatform(id)?.logout()
            } catch (e: any) {
                error.value = e?.message ?? 'Could not disconnect.'
            }
        }

        return { tabs, error, select, disconnect }
    },
})
</script>

<style scoped lang="scss">
.platform_tabs {
    display: flex;
    align-items: stretch;
    gap: 4px;
    padding: 0 12px;
    background-color: var(--bg);
    border-bottom: 1px solid var(--bg-light);
    overflow-x: auto;
    // A tab strip that wraps stops reading as tabs; scroll it instead.
    white-space: nowrap;
}

.tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    max-width: 220px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--primary-color-light);
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;

    &:hover {
        background-color: var(--bg-light);
    }

    &.active {
        color: var(--primary-color);
        border-bottom-color: var(--secondary-color);
        background-color: var(--bg-light);
    }
}

.dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

.labels {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
    line-height: 1.25;
}

.name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
}

.addr {
    font-family: monospace;
    font-size: 10px;
    opacity: 0.75;
}

.close {
    margin-left: 2px;
    padding: 0 3px;
    font-size: 11px;
    line-height: 1;
    opacity: 0.6;
    cursor: pointer;

    &:hover {
        opacity: 1;
        color: var(--error);
    }
}

.add_tab {
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 16px;
    line-height: 1;
    color: var(--primary-color-light);
    text-decoration: none;
    flex-shrink: 0;

    &:hover {
        color: var(--secondary-color);
        background-color: var(--bg-light);
    }
}

.tabs_error {
    align-self: center;
    margin-left: 12px !important;
    font-size: 11px;
    color: var(--error);
}
</style>
