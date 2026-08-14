/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { computed, watch, type Ref } from 'vue'
import { useCChainSdkAssetsStore } from '@/stores/cChainSdkAssets'

export type { CChainSdkAsset } from '@/stores/cChainSdkAssets'

/**
 * Thin per-component wrapper around the shared `useCChainSdkAssetsStore`.
 *
 * The fetch/state used to live here as local `ref`s, one independent copy per
 * call site — which meant a refresh triggered by one screen (Swap, a send)
 * never reached another showing the same data (Portfolio), especially since
 * several of them stay mounted behind `<keep-alive>` and never naturally
 * remount to refetch. Moving the state into a Pinia store fixed that; this
 * wrapper just keeps the existing call signature so nothing that already uses
 * it (`Fungibles.vue`, `useHeldErc20Tokens`) had to change.
 */
export function useCChainSdkBalances(address: Ref<string | null>, chainId: Ref<number>) {
    const store = useCChainSdkAssetsStore()

    const fetchBalances = () => store.fetch(address.value, chainId.value)

    watch([address, chainId], fetchBalances, { immediate: true })

    return {
        assets: computed(() => store.assets),
        loading: computed(() => store.loading),
        error: computed(() => store.error),
        fetchBalances,
    }
}
