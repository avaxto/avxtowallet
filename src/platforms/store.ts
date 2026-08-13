/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import type { Platform, PlatformCapabilities, PlatformId } from './types'
import {
    DEFAULT_PLATFORM_ID,
    getPlatform,
    isPlatformAvailable,
    listAvailablePlatforms,
    listPlatforms,
} from './registry'

const STORAGE_KEY = 'activePlatform'

/**
 * Which platform the wallet is currently operating on.
 *
 * Named `useActivePlatformStore`, NOT `usePlatformStore` — the latter already
 * exists (`@/stores/platform`) and is Avalanche's P-Chain / platformvm store.
 * The two are unrelated; keeping the names distinct avoids importing the wrong
 * one by autocomplete.
 */
export const useActivePlatformStore = defineStore('activePlatform', () => {
    const activePlatformId = ref<PlatformId>(DEFAULT_PLATFORM_ID)

    const activePlatform = computed((): Platform | undefined =>
        getPlatform(activePlatformId.value)
    )

    /**
     * Capabilities of the active platform. Falls back to everything-off so a
     * capability-gated feature never renders while no platform is resolved.
     */
    const capabilities = computed((): PlatformCapabilities | null =>
        activePlatform.value?.capabilities ?? null
    )

    const can = (capability: keyof PlatformCapabilities): boolean =>
        capabilities.value?.[capability] ?? false

    /** Every registered platform, including ones that aren't built yet. */
    const platforms = computed((): Platform[] => listPlatforms())
    /** Only the ones that can actually be logged into. */
    const availablePlatforms = computed((): Platform[] => listAvailablePlatforms())

    /**
     * Switch platforms. Rejects unknown or not-yet-implemented ids rather than
     * leaving the app pointing at a platform with no implementation behind it.
     */
    const setActivePlatform = async (id: PlatformId): Promise<void> => {
        if (id === activePlatformId.value) return

        if (!isPlatformAvailable(id)) {
            throw new Error(`Platform "${id}" is not available yet.`)
        }

        const previous = activePlatform.value
        if (previous) {
            await previous.deactivate?.()
        }

        activePlatformId.value = id
        localStorage.setItem(STORAGE_KEY, id)

        await getPlatform(id)?.activate?.()
    }

    /**
     * Restore the previously chosen platform. A saved id that is no longer
     * available (removed, or renamed between releases) silently falls back to
     * the default rather than leaving the app unusable.
     */
    const initPlatform = (): void => {
        const saved = localStorage.getItem(STORAGE_KEY)
        activePlatformId.value =
            saved && isPlatformAvailable(saved) ? saved : DEFAULT_PLATFORM_ID
    }

    return {
        activePlatformId,
        activePlatform,
        capabilities,
        can,
        platforms,
        availablePlatforms,
        setActivePlatform,
        initPlatform,
    }
})
