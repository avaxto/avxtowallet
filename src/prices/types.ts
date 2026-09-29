/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The price-query interface every price provider implements. The rest of the
 * wallet asks for prices only through this (see ./index.ts), so which service
 * answers is a setting, not a code change.
 */

/** Assets a provider can be asked about. Each provider maps them to its own ids. */
export type PriceAsset = 'AVAX' | 'BTC' | 'ETH' | 'SOL'

/** [UTC day start in ms, closing price in USD]. */
export type PricePoint = [number, number]

export interface PriceService {
    /** Stable id, persisted as the user's choice. */
    id: string
    name: string
    /**
     * What the price is quoted against. Exchanges without a USD market quote
     * USDT, which tracks the dollar closely but is not the dollar.
     */
    quote: 'USD' | 'USDT'
    homepage: string
    /** Current price of one `asset`, in USD (or USDT, see `quote`). */
    getPriceUSD(asset: PriceAsset): Promise<number>
    /** Daily closes for the last `days` days, oldest first. */
    getDailyHistoryUSD(asset: PriceAsset, days: number): Promise<PricePoint[]>
}
