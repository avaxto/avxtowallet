<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <v-menu offset-y>
        <template v-slot:activator="{ props }">
            <v-btn text v-bind="props" class="btc_net_but">
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
                    Switching networks logs out — mainnet and testnet derive from different
                    paths, so the keys do not carry over.
                </v-list-item-title>
            </v-list-item>
        </v-list>
    </v-menu>
</template>

<script lang="ts">
/**
 * Network switcher for the Bitcoin platform.
 *
 * Unlike Solana's cluster menu, this one disconnects: mainnet uses SLIP-44
 * coin type 0 and testnet uses 1, so the same phrase produces entirely
 * different keys and addresses on each. Silently keeping a mainnet wallet
 * attached while reading testnet would show a permanently empty balance with
 * no explanation, so the store logs out instead — and the menu says so before
 * the click rather than after.
 */
import { defineComponent, computed } from 'vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import { useNotificationsStore } from '@/stores'
import type { BitcoinNetwork } from '@/bitcoin/networks'

export default defineComponent({
    name: 'BitcoinNetworkMenu',
    setup() {
        const btc = useBitcoinStore()
        const notifications = useNotificationsStore()

        const activeNetwork = computed((): BitcoinNetwork => btc.network)
        const networks = computed((): BitcoinNetwork[] => btc.networks)

        const select = async (id: string) => {
            try {
                await btc.setNetwork(id)
            } catch (e: any) {
                console.error('[BitcoinNetworkMenu] Could not switch network:', e)
                notifications.add({
                    type: 'error',
                    title: 'Switch Network',
                    message: e?.message || 'Could not switch network.',
                })
            }
        }

        return { activeNetwork, networks, select }
    },
})
</script>

<style scoped lang="scss">
.btc_net_but {
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
