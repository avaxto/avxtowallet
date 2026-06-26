<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="config_view">
        <div class="page_header">
            <h1>Configuration</h1>
        </div>

        <div class="grids">
            <!-- ── Rate Limiting ─────────────────────────────────────── -->
            <div class="grid_box">
                <h3>Rate Limiting</h3>
                <p class="description">
                    To preserve the Avalanche APIs, AVXTO applies rate limiting on network requests. 
                    
                    It is a fixed-window limit applied to all outgoing network requests (axios + fetch).
                    Excess requests are queued and released at the start of the next window.
                    If AVXTO feels slow when loading AVAX and token balances, you may tweak these values.
                    Increasing max requests per window and decreasing window size will speed the wallet up, but you may start receving HTTP 429 responses, meaning it has overwhelmed the API endpoints.
                </p>

                <div class="form_row">
                    <label>Max requests per window</label>
                    <input
                        type="number"
                        v-model.number="rlMaxRequests"
                        min="1"
                        max="1000"
                        class="field"
                    />
                </div>
                <div class="form_row">
                    <label>Window size (ms)</label>
                    <input
                        type="number"
                        v-model.number="rlWindowMs"
                        min="100"
                        max="60000"
                        class="field"
                    />
                </div>

                <p class="hint">Queue depth: {{ queueLength }}</p>
                <p class="form_error" v-if="rlErr">{{ rlErr }}</p>

                <v-btn
                    class="button_primary save_btn"
                    size="small"
                    @click="applyRateLimit"
                >
                    Apply
                </v-btn>
            </div>

            <!-- ── Network Endpoints ─────────────────────────────────── -->
            <div class="grid_box">
                <h3>Network Endpoints</h3>
                <p class="description">
                    Active network:
                    <strong>{{ currentNetworkName }}</strong>
                </p>

                <div class="form_row">
                    <label>RPC Endpoint URL</label>
                    <input
                        type="text"
                        v-model="netUrl"
                        placeholder="https://api.avax.network:443"
                        class="field"
                    />
                </div>
                <div class="form_row">
                    <label>Explorer API URL</label>
                    <input
                        type="text"
                        v-model="netExplorerApi"
                        placeholder="https://explorerapi.avax.network"
                        class="field"
                    />
                </div>
                <div class="form_row">
                    <label>Explorer Site URL</label>
                    <input
                        type="text"
                        v-model="netExplorerSite"
                        placeholder="https://explorer-xp.avax.network"
                        class="field"
                    />
                </div>

                <p class="hint warn" v-if="isBuiltinNetwork">
                    Built-in network — endpoint changes are session-only and will reset on reload.
                </p>
                <p class="form_error" v-if="netErr">{{ netErr }}</p>

                <v-btn
                    class="button_primary save_btn"
                    size="small"
                    :loading="netLoading"
                    @click="applyNetwork"
                >
                    Apply
                </v-btn>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { globalRateLimiter } from '@/providers/rate_limiter'
import { useNetworkStore } from '@/stores/network'
import { useStatusBarStore } from '@/stores'

export default defineComponent({
    name: 'Config',
    setup() {
        const networkStore = useNetworkStore()
        const statusBar = useStatusBarStore()

        // ── Rate limiting state ──────────────────────────────────────────────
        const rlMaxRequests = ref<number>(globalRateLimiter.currentMaxRequests)
        const rlWindowMs = ref<number>(globalRateLimiter.currentWindowMs)
        const rlErr = ref<string>('')
        const queueLength = computed(() => globalRateLimiter.queueLength)

        function applyRateLimit() {
            rlErr.value = ''
            if (!Number.isInteger(rlMaxRequests.value) || rlMaxRequests.value < 1) {
                rlErr.value = 'Max requests must be a positive integer.'
                return
            }
            if (!Number.isInteger(rlWindowMs.value) || rlWindowMs.value < 100) {
                rlErr.value = 'Window size must be at least 100 ms.'
                return
            }
            globalRateLimiter.configure({
                maxRequests: rlMaxRequests.value,
                windowMs: rlWindowMs.value,
            })
            globalRateLimiter.saveConfig()
            statusBar.success(`Rate limit updated: ${rlMaxRequests.value} req / ${rlWindowMs.value} ms`)
        }

        // ── Network endpoint state ───────────────────────────────────────────
        const currentNetwork = computed(() => networkStore.currentNetwork)
        const currentNetworkName = computed(() => currentNetwork.value?.name ?? '—')
        const isBuiltinNetwork = computed(() => currentNetwork.value?.readonly ?? false)

        const netUrl = ref<string>(currentNetwork.value?.url ?? '')
        const netExplorerApi = ref<string>(currentNetwork.value?.explorerUrl ?? '')
        const netExplorerSite = ref<string>(currentNetwork.value?.explorerSiteUrl ?? '')
        const netErr = ref<string>('')
        const netLoading = ref<boolean>(false)

        // Sync form fields when the active network changes (e.g., user switches network)
        watch(currentNetwork, (net) => {
            netUrl.value = net?.url ?? ''
            netExplorerApi.value = net?.explorerUrl ?? ''
            netExplorerSite.value = net?.explorerSiteUrl ?? ''
            netErr.value = ''
        })

        async function applyNetwork() {
            netErr.value = ''
            const net = currentNetwork.value
            if (!net) {
                netErr.value = 'No active network.'
                return
            }

            const url = netUrl.value.trim()
            if (!url) {
                netErr.value = 'RPC Endpoint URL is required.'
                return
            }
            if (!/^https?:\/\/.+/.test(url)) {
                netErr.value = 'URL must start with http:// or https://'
                return
            }

            netLoading.value = true
            try {
                // Mutate the live AvaNetwork object so setNetwork sees the new values
                net.url = url
                net.explorerUrl = netExplorerApi.value.trim() || undefined
                net.explorerSiteUrl = netExplorerSite.value.trim() || undefined

                await networkStore.setNetwork(net)
                statusBar.success(`Reconnected to ${net.name} with new endpoints.`)
            } catch (e: any) {
                netErr.value = e?.message ?? 'Failed to connect with new endpoints.'
                statusBar.error('Network reconnection failed.')
            } finally {
                netLoading.value = false
            }
        }

        return {
            // Rate limiting
            rlMaxRequests,
            rlWindowMs,
            rlErr,
            queueLength,
            applyRateLimit,

            // Network
            currentNetworkName,
            isBuiltinNetwork,
            netUrl,
            netExplorerApi,
            netExplorerSite,
            netErr,
            netLoading,
            applyNetwork,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

h1 {
    font-weight: normal;
}

.grids {
    display: grid;
    column-gap: 14px;
    row-gap: 14px;
    grid-template-columns: repeat(2, 1fr);
}

.grid_box {
    background-color: var(--bg-light);
    padding: 30px;
    border-radius: 4px;
    overflow: auto;

    h3 {
        margin: 0 0 8px;
        font-weight: 600;
        color: var(--primary-color);
    }

    .description {
        font-size: 13px;
        color: var(--primary-color-light);
    }
}

.form_row {

    margin-top: 18px;
    display: flex;
    flex-direction: column;
    margin-bottom: 14px;

    label {
        font-size: 13px;
        color: var(--primary-color-light);
        margin-bottom: 4px;
    }
}

.field {
    background-color: var(--bg);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 6px 10px;
    color: var(--primary-color);
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;

    &:focus {
        outline: none;
        border-color: var(--primary-color);
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 4px 0 12px;

    &.warn {
        color: var(--warning, #e6a817);
    }
}

.form_error {
    font-size: 12px;
    color: var(--error, #e84040);
    margin: 4px 0 10px;
}

.save_btn {
    margin-top: 4px;
}

@include main.mobile-device {
    .grids {
        grid-template-columns: none;
    }
}

@include main.medium-device {
    .grids {
        grid-template-columns: none;
    }
}
</style>
