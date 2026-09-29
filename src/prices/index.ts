/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The wallet's one door to prices: which PriceService (./types.ts) answers is
 * the user's choice in Settings, remembered in this browser. Everything that
 * needs a price — the AVAX price in the main store, the daily history the
 * staking and CSV views use — asks here, never a provider directly.
 */
import { ref } from 'vue'

import type { PriceAsset, PricePoint, PriceService } from './types'
import { PRICE_SERVICES } from './providers'

export type { PriceAsset, PricePoint, PriceService }
export { PRICE_SERVICES }

const STORAGE_KEY = 'price_service'
export const DEFAULT_PRICE_SERVICE_ID = PRICE_SERVICES[0].id

function readSaved(): string {
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved && PRICE_SERVICES.some((s) => s.id === saved)) return saved
    } catch {
        /* storage unavailable — the default */
    }
    return DEFAULT_PRICE_SERVICE_ID
}

/** The chosen service's id. Reactive, so a settings page can bind to it. */
export const priceServiceId = ref<string>(readSaved())

const listeners = new Set<(service: PriceService) => void>()

export function getPriceService(id: string = priceServiceId.value): PriceService {
    return PRICE_SERVICES.find((s) => s.id === id) ?? PRICE_SERVICES[0]
}

/** Switches service, remembers it, and tells anyone holding prices to refetch. */
export function setPriceService(id: string): PriceService {
    const service = getPriceService(id)
    if (service.id === priceServiceId.value) return service
    priceServiceId.value = service.id
    try {
        localStorage.setItem(STORAGE_KEY, service.id)
    } catch {
        /* not remembered; still used for this session */
    }
    listeners.forEach((fn) => fn(service))
    return service
}

/** Runs `fn` whenever the service changes. Returns an unsubscribe. */
export function onPriceServiceChange(fn: (service: PriceService) => void): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function getPriceUSD(asset: PriceAsset): Promise<number> {
    return getPriceService().getPriceUSD(asset)
}

export function getDailyHistoryUSD(asset: PriceAsset, days: number): Promise<PricePoint[]> {
    return getPriceService().getDailyHistoryUSD(asset, days)
}
