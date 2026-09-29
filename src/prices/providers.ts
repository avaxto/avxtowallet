/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Public price APIs behind the PriceService interface (./types.ts).
 *
 * Every one here is free, needs no API key, and answers browser requests from
 * any origin — checked live against each endpoint below, since a provider the
 * browser cannot call is no provider at all. Left out after the same check:
 * KuCoin (no CORS headers), CryptoCompare (now requires a key) and CoinCap
 * (v2 retired).
 *
 * Response shapes were taken from live responses. Exchanges quote USDT where
 * they have no USD market (see `quote`); history is daily closes, normalised
 * to UTC day starts so every provider's points line up.
 */
import axios from 'axios'

import type { PriceAsset, PricePoint, PriceService } from './types'

const TIMEOUT_MS = 10_000
const DAY_MS = 86_400_000

const http = axios.create({ timeout: TIMEOUT_MS })

async function get(url: string, params?: Record<string, string | number>): Promise<any> {
    const { data } = await http.get(url, { params })
    return data
}

/** A price is only usable if it's a finite positive number; anything else is a broken response. */
export function checkPrice(value: unknown, source: string): number {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${source} returned no usable price.`)
    return n
}

export const dayStart = (ms: number) => ms - (ms % DAY_MS)

/** Oldest first, one point per day, the last `days` of them, bad rows dropped. */
export function normaliseHistory(points: [number, unknown][], days: number): PricePoint[] {
    const byDay = new Map<number, number>()
    for (const [ms, price] of points) {
        const p = Number(price)
        if (!Number.isFinite(ms) || !Number.isFinite(p) || p <= 0) continue
        byDay.set(dayStart(ms), p)
    }
    return Array.from(byDay.entries())
        .sort((a, b) => a[0] - b[0])
        .slice(-days)
}

const ids = <T extends string>(map: Record<PriceAsset, T>) => (asset: PriceAsset) => map[asset]

// ─── Aggregators ───────────────────────────────────────────────────────────

const coingeckoId = ids({ AVAX: 'avalanche-2', BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana' })
export const coingecko: PriceService = {
    id: 'coingecko',
    name: 'CoinGecko',
    quote: 'USD',
    homepage: 'https://www.coingecko.com',
    async getPriceUSD(asset) {
        const id = coingeckoId(asset)
        const d = await get('https://api.coingecko.com/api/v3/simple/price', { ids: id, vs_currencies: 'usd' })
        return checkPrice(d?.[id]?.usd, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        const d = await get(`https://api.coingecko.com/api/v3/coins/${coingeckoId(asset)}/market_chart`, {
            vs_currency: 'usd',
            days,
            interval: 'daily',
        })
        return normaliseHistory(Array.isArray(d?.prices) ? d.prices : [], days)
    },
}

const paprikaId = ids({ AVAX: 'avax-avalanche', BTC: 'btc-bitcoin', ETH: 'eth-ethereum', SOL: 'sol-solana' })
export const coinpaprika: PriceService = {
    id: 'coinpaprika',
    name: 'CoinPaprika',
    quote: 'USD',
    homepage: 'https://coinpaprika.com',
    async getPriceUSD(asset) {
        const d = await get(`https://api.coinpaprika.com/v1/tickers/${paprikaId(asset)}`, { quotes: 'USD' })
        return checkPrice(d?.quotes?.USD?.price, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        const start = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)
        const d = await get(`https://api.coinpaprika.com/v1/tickers/${paprikaId(asset)}/historical`, {
            start,
            interval: '1d',
        })
        const rows: any[] = Array.isArray(d) ? d : []
        return normaliseHistory(
            rows.map((r) => [Date.parse(r?.timestamp), r?.price]),
            days
        )
    },
}

// ─── Exchanges, USD markets ────────────────────────────────────────────────

export const coinbase: PriceService = {
    id: 'coinbase',
    name: 'Coinbase',
    quote: 'USD',
    homepage: 'https://www.coinbase.com',
    async getPriceUSD(asset) {
        const d = await get(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`)
        return checkPrice(d?.data?.amount, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [time (s), low, high, open, close, volume], newest first; at most 300 per call.
        const d = await get(`https://api.exchange.coinbase.com/products/${asset}-USD/candles`, { granularity: 86_400 })
        const rows: any[] = Array.isArray(d) ? d : []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]) * 1000, r[4]]),
            days
        )
    },
}

const krakenPair = ids({ AVAX: 'AVAXUSD', BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD' })
/** Kraken answers under its own pair name (XBTUSD comes back as XXBTZUSD), so take the one result. */
function krakenResult(d: any): any {
    if (Array.isArray(d?.error) && d.error.length) throw new Error(`Kraken: ${d.error.join(', ')}`)
    const key = Object.keys(d?.result ?? {}).find((k) => k !== 'last')
    return key ? d.result[key] : undefined
}
export const kraken: PriceService = {
    id: 'kraken',
    name: 'Kraken',
    quote: 'USD',
    homepage: 'https://www.kraken.com',
    async getPriceUSD(asset) {
        const d = await get('https://api.kraken.com/0/public/Ticker', { pair: krakenPair(asset) })
        // `c` is [last trade price, lot volume].
        return checkPrice(krakenResult(d)?.c?.[0], this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [time (s), open, high, low, close, vwap, volume, count], oldest first; the last 720.
        const d = await get('https://api.kraken.com/0/public/OHLC', { pair: krakenPair(asset), interval: 1440 })
        const rows: any[] = krakenResult(d) ?? []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]) * 1000, r[4]]),
            days
        )
    },
}

// ─── Exchanges, USDT markets ───────────────────────────────────────────────

export const binance: PriceService = {
    id: 'binance',
    name: 'Binance',
    quote: 'USDT',
    homepage: 'https://www.binance.com',
    async getPriceUSD(asset) {
        const d = await get('https://api.binance.com/api/v3/ticker/price', { symbol: `${asset}USDT` })
        return checkPrice(d?.price, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [open time (ms), open, high, low, close, …], oldest first.
        const d = await get('https://api.binance.com/api/v3/klines', {
            symbol: `${asset}USDT`,
            interval: '1d',
            limit: Math.min(days, 1000),
        })
        const rows: any[] = Array.isArray(d) ? d : []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]), r[4]]),
            days
        )
    },
}

export const okx: PriceService = {
    id: 'okx',
    name: 'OKX',
    quote: 'USDT',
    homepage: 'https://www.okx.com',
    async getPriceUSD(asset) {
        const d = await get('https://www.okx.com/api/v5/market/ticker', { instId: `${asset}-USDT` })
        return checkPrice(d?.data?.[0]?.last, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [ts (ms), open, high, low, close, …], newest first; at most 100 per call.
        const d = await get('https://www.okx.com/api/v5/market/history-candles', {
            instId: `${asset}-USDT`,
            bar: '1Dutc',
            limit: Math.min(days, 100),
        })
        const rows: any[] = Array.isArray(d?.data) ? d.data : []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]), r[4]]),
            days
        )
    },
}

export const bybit: PriceService = {
    id: 'bybit',
    name: 'Bybit',
    quote: 'USDT',
    homepage: 'https://www.bybit.com',
    async getPriceUSD(asset) {
        const d = await get('https://api.bybit.com/v5/market/tickers', { category: 'spot', symbol: `${asset}USDT` })
        return checkPrice(d?.result?.list?.[0]?.lastPrice, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [start (ms), open, high, low, close, …], newest first.
        const d = await get('https://api.bybit.com/v5/market/kline', {
            category: 'spot',
            symbol: `${asset}USDT`,
            interval: 'D',
            limit: Math.min(days, 1000),
        })
        const rows: any[] = Array.isArray(d?.result?.list) ? d.result.list : []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]), r[4]]),
            days
        )
    },
}

export const gateio: PriceService = {
    id: 'gateio',
    name: 'Gate.io',
    quote: 'USDT',
    homepage: 'https://www.gate.io',
    async getPriceUSD(asset) {
        const d = await get('https://api.gateio.ws/api/v4/spot/tickers', { currency_pair: `${asset}_USDT` })
        return checkPrice(Array.isArray(d) ? d[0]?.last : undefined, this.name)
    },
    async getDailyHistoryUSD(asset, days) {
        // [time (s), quote volume, close, high, low, open, base volume, closed], oldest first.
        const d = await get('https://api.gateio.ws/api/v4/spot/candlesticks', {
            currency_pair: `${asset}_USDT`,
            interval: '1d',
            limit: Math.min(days, 1000),
        })
        const rows: any[] = Array.isArray(d) ? d : []
        return normaliseHistory(
            rows.map((r) => [Number(r[0]) * 1000, r[2]]),
            days
        )
    },
}

/** In the order the settings dropdown lists them; the first is the default. */
export const PRICE_SERVICES: PriceService[] = [coingecko, coinbase, kraken, coinpaprika, binance, okx, bybit, gateio]
