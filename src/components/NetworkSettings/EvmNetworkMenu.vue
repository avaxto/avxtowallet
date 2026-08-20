<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="evm_net_but">
                <span class="signing_label">Now signing for:</span>
                {{ activeNetwork.shortName }}
                <span v-if="activeNetwork.isTestnet" class="testnet_tag">testnet</span>
            </v-btn>
        </template>
        <v-list>
            <v-list-item class="menu_note" disabled>
                <v-list-item-title>
                    Which network your wallet signs on. Your portfolio always
                    includes every network below, regardless of this choice.
                </v-list-item-title>
            </v-list-item>
            <v-list-item
                v-for="net in networks"
                :key="net.id"
                @click="select(net.id)"
                :active="net.evmChainId === activeNetwork.evmChainId"
            >
                <v-list-item-title>
                    {{ net.name }}
                    <span v-if="net.isTestnet" class="testnet_tag">testnet</span>
                </v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>

<script lang="ts">
/**
 * Signing-network switcher for the unified EVM platform.
 *
 * Deliberately NOT styled like `NetworkMenu.vue` (Avalanche's): that one
 * shows a single "connected to network X" indicator with a health dot, which
 * is the right model for Avalanche — one network, one RPC, one connection to
 * be up or down. It is the wrong model here. This platform's portfolio scans
 * every registry network in parallel regardless of what this control is set
 * to (see stores/evmPortfolio.ts) — per-network reachability is already
 * surfaced there (EvmFungibles.vue's degraded-networks banner), not here.
 *
 * What this control actually is: which single chain the injected wallet will
 * sign transactions on when you send — a real, unavoidably single-value
 * choice (a wallet is only ever on one chain at a time), but a narrower one
 * than "the network", so it is labelled and framed as exactly that rather
 * than reusing Avalanche's broader "this is my connection" framing.
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

.signing_label {
    color: var(--primary-color-light);
    font-size: 12px;
    margin-right: 4px;
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

.menu_note {
    max-width: 260px;
    white-space: normal !important;
    opacity: 1 !important;

    :deep(.v-list-item-title) {
        font-size: 11px !important;
        color: var(--primary-color-light) !important;
        line-height: 1.4;
        white-space: normal;
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
    font-size: 14px !important;
    display: flex;
    align-items: center;
}
</style>
