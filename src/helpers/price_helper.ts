/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * AVAX prices for the rest of the wallet, from whichever price service the
 * user chose in Settings (see @/prices). This module used to call CoinGecko
 * directly; its two exports are unchanged so existing callers keep working.
 */
import { getDailyHistoryUSD, getPriceUSD, onPriceServiceChange } from '@/prices'
import type { PricePoint } from '@/prices'

/** How many days of daily closes `getPriceAtUnixTime` can answer from. */
const HISTORY_DAYS = 1

export async function getAvaxPriceUSD(): Promise<number> {
    return getPriceUSD('AVAX')
}

let priceHistory: PricePoint[] = []
let generation = 0

async function loadPriceHistory(): Promise<void> {
    const mine = ++generation
    try {
        const points = await getDailyHistoryUSD('AVAX', HISTORY_DAYS)
        // A switch of service mid-request must not be overwritten by the old one.
        if (mine === generation) priceHistory = points
    } catch (e) {
        console.warn('[price_helper] could not load AVAX price history:', e)
        if (mine === generation) priceHistory = []
    }
}

/**
 * Round the UNIX time in ms and search the previously fetched price points
 * @param time
 */
export function getPriceAtUnixTime(time: number): number | undefined {
    const remainder = time % (24 * 60 * 60 * 1000)
    const dayTimestamp = time - remainder

    const pricePair = priceHistory.find((value) => {
        return value[0] == dayTimestamp
    })

    if (!pricePair) return undefined
    return pricePair[1]
}

onPriceServiceChange(() => {
    priceHistory = []
    loadPriceHistory()
})

loadPriceHistory()
