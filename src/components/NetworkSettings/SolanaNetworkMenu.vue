<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="sol_net_but">
                {{ activeNetwork.name }}
                <span v-if="activeNetwork.isTestnet" class="testnet_tag">testnet</span>
            </v-btn>
        </template>
        <v-list>
            <v-list-item
                v-for="net in networks"
                :key="net.id"
                @click="select(net.id)"
                :active="net.id === activeNetwork.id"
            >
                <v-list-item-title>
                    {{ net.name }}
                    <span v-if="net.isTestnet" class="testnet_tag">testnet</span>
                </v-list-item-title>
            </v-list-item>
            <v-list-item class="menu_note" disabled>
                <v-list-item-title>
                    Public Solana RPCs are rate-limited. Set a custom endpoint in Settings for
                    reliable use.
                </v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>

<script lang="ts">
/**
 * Cluster switcher for the Solana platform.
 *
 * Simpler than `EvmNetworkMenu.vue` because the switch is purely local:
 * changing an EVM network has to move the *extension* to that chain (its
 * `eth_sendTransaction` goes wherever the extension currently points), whereas
 * a Solana provider signs whatever transaction it is handed — the cluster is a
 * property of the RPC this app talks to, not of the wallet. So this only
 * re-points the app, and there is no switch to fail or be rejected.
 */
import { defineComponent, computed } from 'vue'
import { useSolanaStore } from '@/platforms/solana/store'
import { useNotificationsStore } from '@/stores'
import type { SolanaNetwork } from '@/solana/networks'

export default defineComponent({
    name: 'SolanaNetworkMenu',
    setup() {
        const solanaStore = useSolanaStore()
        const notifications = useNotificationsStore()

        const activeNetwork = computed((): SolanaNetwork => solanaStore.network)
        const networks = computed((): SolanaNetwork[] => solanaStore.networks)

        const select = async (id: string) => {
            try {
                await solanaStore.setNetwork(id)
            } catch (e: any) {
                console.error('[SolanaNetworkMenu] Could not switch cluster:', e)
                notifications.add({
                    type: 'error',
                    title: 'Switch Cluster',
                    message: e?.message || 'Could not switch cluster.',
                })
            }
        }

        return { activeNetwork, networks, select }
    },
})
</script>

<style scoped lang="scss">
.sol_net_but {
    font-size: 14px !important;
    text-transform: none !important;
    box-shadow: none !important;
}

.testnet_tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--bg-light);
    color: var(--primary-color-light);
    border-radius: 3px;
    padding: 1px 5px;
    margin-left: 6px;
}

.menu_note {
    max-width: 280px;

    :deep(.v-list-item-title) {
        font-size: 11px;
        white-space: normal;
        line-height: 1.4;
        color: var(--primary-color-light);
    }
}
</style>
