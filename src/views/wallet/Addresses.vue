<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Dispatches to a per-platform address view — same shape as Portfolio.vue's
  Fungibles dispatch, and for the same reason: what an "address" even means
  differs by platform, not just what data fills a shared template.

  Bitcoin gets a real HD receive/change listing (BitcoinAddresses.vue) because
  its addresses genuinely rotate — a fresh one per payment, scanned to the
  BIP-44 gap limit. Solana and EVM get one fixed address (SolanaAddresses.vue,
  EvmAddresses.vue): both ARE HD-derived from a seed, but neither ecosystem
  rotates the resulting address the way Bitcoin does — Phantom and MetaMask
  both show one address per account, reused forever, so a receive/change list
  would be showing addresses that do not exist. See each component's own doc
  comment for the platform-specific reasoning. Avalanche keeps its original,
  more elaborate page (X external/internal + P chain, private-key/xpub reveal)
  unchanged, in AvalancheAddresses.vue.
-->
<template>
    <evm-addresses v-if="isEvm"></evm-addresses>
    <solana-addresses v-else-if="isSolana"></solana-addresses>
    <bitcoin-addresses v-else-if="isBitcoin"></bitcoin-addresses>
    <avalanche-addresses v-else></avalanche-addresses>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useActivePlatformStore } from '@/platforms'
import AvalancheAddresses from '@/components/wallet/addresses/AvalancheAddresses.vue'
import EvmAddresses from '@/components/wallet/addresses/EvmAddresses.vue'
import SolanaAddresses from '@/components/wallet/addresses/SolanaAddresses.vue'
import BitcoinAddresses from '@/components/wallet/addresses/BitcoinAddresses.vue'

export default defineComponent({
    name: 'Addresses',
    components: {
        AvalancheAddresses,
        EvmAddresses,
        SolanaAddresses,
        BitcoinAddresses,
    },
    setup() {
        const platformStore = useActivePlatformStore()

        const isEvm = computed(() => platformStore.activePlatformId === 'evm')
        const isSolana = computed(() => platformStore.activePlatformId === 'solana')
        const isBitcoin = computed(() => platformStore.activePlatformId === 'bitcoin')

        return { isEvm, isSolana, isBitcoin }
    },
})
</script>
