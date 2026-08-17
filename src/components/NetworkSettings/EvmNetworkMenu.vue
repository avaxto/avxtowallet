<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="evm_net_but">
                <span class="net_dot" :style="{ backgroundColor: activeNetwork.color }"></span>
                {{ activeNetwork.shortName }}
                <span v-if="activeNetwork.isTestnet" class="testnet_tag">testnet</span>
            </v-btn>
        </template>
        <v-list>
            <v-list-item
                v-for="net in networks"
                :key="net.id"
                @click="select(net.id)"
                :active="net.evmChainId === activeNetwork.evmChainId"
            >
                <v-list-item-title>
                    <span class="net_dot" :style="{ backgroundColor: net.color }"></span>
                    {{ net.name }}
                    <span v-if="net.isTestnet" class="testnet_tag">testnet</span>
                </v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>

<script lang="ts">
/**
 * Network switcher for the unified EVM platform.
 *
 * Separate from `NetworkMenu.vue`, which is Avalanche's: that one edits
 * `AvaNetwork` objects (network id, /ext/info credentials, X/P/C endpoints) and
 * switching it re-points the Avalanche SDK. None of that applies here, where a
 * network is a plain entry in `src/evm/networks.json`.
 */
import { defineComponent, computed } from 'vue'
import { useEvmStore } from '@/platforms/evm/store'
import type { EvmNetwork } from '@/evm/networkRegistry'

export default defineComponent({
    name: 'EvmNetworkMenu',
    setup() {
        const evmStore = useEvmStore()

        const activeNetwork = computed((): EvmNetwork => evmStore.network)
        const networks = computed((): EvmNetwork[] => evmStore.networks)

        const select = async (id: string) => {
            try {
                await evmStore.setNetwork(id)
            } catch (e: any) {
                console.error('[EvmNetworkMenu] Could not switch network:', e)
                alert(e?.message || 'Could not switch network.')
            }
        }

        return { activeNetwork, networks, select }
    },
})
</script>

<style scoped lang="scss">
.evm_net_but {
    font-size: 14px !important;
    text-transform: none !important;
    box-shadow: none !important;
}

.net_dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    flex-shrink: 0;
}

.testnet_tag {
    margin-left: 6px;
    font-size: 10px;
    text-transform: uppercase;
    color: var(--warning);
    border: 1px solid var(--warning);
    border-radius: 3px;
    padding: 0 4px;
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
    font-size: 14px !important;
    display: flex;
    align-items: center;
}
</style>
