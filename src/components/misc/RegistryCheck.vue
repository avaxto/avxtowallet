<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <span v-if="entry" class="registry_check" :title="titleText">
        <fa icon="circle-check"></fa>
    </span>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useAssetsStore } from '@/stores'
import { useActivePlatformStore } from '@/platforms'
import { useEvmStore } from '@/platforms/evm/store'
import { findRegistryEntry } from '@/helpers/registry_token'

// Green checkmark shown next to a token whose contract address is one of the
// registry's pinned tokens. Renders nothing for any other address.
export default defineComponent({
    name: 'RegistryCheck',
    props: {
        address: {
            type: String,
            default: '',
        },
        /**
         * EVM chain the address lives on. Defaults to the chain the active
         * platform is on; pass it whenever the token carries its own network
         * (the EVM portfolio spans several at once).
         */
        chainId: {
            type: Number,
            default: undefined,
        },
    },
    setup(props) {
        const assetsStore = useAssetsStore()
        const platformStore = useActivePlatformStore()
        const evmStore = useEvmStore()

        const resolvedChainId = computed((): number => {
            if (props.chainId !== undefined) return props.chainId
            return platformStore.activePlatform?.descriptor.id === 'evm'
                ? evmStore.network.evmChainId
                : assetsStore.evmChainId
        })

        const entry = computed(() => findRegistryEntry(props.address, resolvedChainId.value))

        const titleText = computed(() =>
            entry.value ? `Verified: ${entry.value.name} is in the wallet's token registry` : ''
        )

        return { entry, titleText }
    },
})
</script>
<style scoped lang="scss">
.registry_check {
    display: inline-flex;
    align-items: center;
    margin-left: 4px;
    margin-right: 6px;
    font-size: 0.85em;
    vertical-align: middle;
    cursor: help;

    // Colour lives on the icon, not the wrapper: the wrapper is this
    // component's root, so a parent's scoped rule (e.g. the portfolio rows'
    // `.col_name span { color: var(--secondary-color) }`) also matches it and
    // would override a colour set here.
    :deep(svg) {
        color: #2ecc71 !important;
    }
}
</style>
