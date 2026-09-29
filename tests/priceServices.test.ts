/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Price services: every provider parses its own live response into the same
 * shape; the registry remembers the user's choice and falls back safely; and
 * the wallet's AVAX price follows whichever service is chosen.
 */
import live from './fixtures/prices/live.json'

const requests: { url: string; params?: any }[] = []
let route: (url: string, params?: any) => any

jest.mock('axios', () => {
    const get = jest.fn(async (url: string, cfg?: { params?: any }) => {
        requests.push({ url, params: cfg?.params })
        return { data: route(url, cfg?.params) }
    })
    return { __esModule: true, default: { create: () => ({ get }), get }, create: () => ({ get }), get }
})

/** Answers each provider's endpoint with its captured live response. */
function liveRoute(url: string): any {
    if (url.includes('coingecko.com') && url.includes('simple/price')) return { 'avalanche-2': { usd: 11.4549 } }
    if (url.includes('coingecko.com')) return live.coingecko_hist
    if (url.includes('api.binance.com/api/v3/ticker')) return live.binance
    if (url.includes('api.binance.com/api/v3/klines')) return live.binance_hist
    if (url.includes('api.coinbase.com')) return live.coinbase
    if (url.includes('exchange.coinbase.com')) return live.coinbase_hist
    if (url.includes('kraken.com/0/public/Ticker')) return live.kraken
    if (url.includes('kraken.com/0/public/OHLC')) return live.kraken_hist
    if (url.includes('coinpaprika.com') && url.includes('historical')) return live.coinpaprika_hist
    if (url.includes('coinpaprika.com')) return live.coinpaprika
    if (url.includes('okx.com/api/v5/market/ticker')) return live.okx
    if (url.includes('okx.com')) return live.okx_hist
    if (url.includes('bybit.com/v5/market/tickers')) return live.bybit
    if (url.includes('bybit.com')) return live.bybit_hist
    if (url.includes('gateio.ws/api/v4/spot/tickers')) return live.gateio
    if (url.includes('gateio.ws')) return live.gate_hist
    throw new Error('unexpected ' + url)
}

import { PRICE_SERVICES, checkPrice, normaliseHistory } from '@/prices/providers'

beforeEach(() => {
    requests.length = 0
    route = liveRoute
})

describe('every provider', () => {
    it.each(PRICE_SERVICES.map((s) => [s.name, s] as const))(
        '%s reads a sane AVAX price from its live response',
        async (_name, service) => {
            const price = await service.getPriceUSD('AVAX')
            // All captured within minutes of each other at ~$11.45.
            expect(price).toBeGreaterThan(10)
            expect(price).toBeLessThan(13)
        }
    )

    it.each(PRICE_SERVICES.map((s) => [s.name, s] as const))(
        '%s reads daily closes, oldest first, on UTC day starts',
        async (_name, service) => {
            const points = await service.getDailyHistoryUSD('AVAX', 3)
            expect(points.length).toBeGreaterThan(0)
            expect(points.length).toBeLessThanOrEqual(3)
            for (let i = 0; i < points.length; i++) {
                const [ms, price] = points[i]
                expect(ms % 86_400_000).toBe(0)
                expect(price).toBeGreaterThan(5)
                expect(price).toBeLessThan(40)
                if (i) expect(ms).toBeGreaterThan(points[i - 1][0])
            }
        }
    )

    it('rejects a response without a usable price rather than returning 0', async () => {
        route = () => ({})
        for (const s of PRICE_SERVICES) await expect(s.getPriceUSD('AVAX')).rejects.toThrow(/no usable price/)
    })
})

describe('provider details', () => {
    it("reads Kraken's renamed pair (BTC answers as XXBTZUSD)", async () => {
        route = (url) => (url.includes('Ticker') ? live.kraken_btc : liveRoute(url))
        const kraken = PRICE_SERVICES.find((s) => s.id === 'kraken')!
        expect(await kraken.getPriceUSD('BTC')).toBeGreaterThan(50_000)
        expect(requests[0].params).toEqual({ pair: 'XBTUSD' })
    })

    it('asks each provider in its own vocabulary', async () => {
        for (const s of PRICE_SERVICES) await s.getPriceUSD('AVAX')
        const asked = requests.map((r) => `${r.url} ${JSON.stringify(r.params ?? {})}`).join('\n')
        expect(asked).toContain('"ids":"avalanche-2"')
        expect(asked).toContain('"symbol":"AVAXUSDT"')
        expect(asked).toContain('/v2/prices/AVAX-USD/spot')
        expect(asked).toContain('"instId":"AVAX-USDT"')
        expect(asked).toContain('"currency_pair":"AVAX_USDT"')
        expect(asked).toContain('/tickers/avax-avalanche')
    })

    it('labels USDT-quoted exchanges as such', () => {
        const quotes = Object.fromEntries(PRICE_SERVICES.map((s) => [s.id, s.quote]))
        expect(quotes).toMatchObject({ coingecko: 'USD', coinbase: 'USD', kraken: 'USD', binance: 'USDT', okx: 'USDT' })
    })
})

describe('checkPrice / normaliseHistory', () => {
    it('accepts numeric strings and refuses junk', () => {
        expect(checkPrice('11.45', 'x')).toBe(11.45)
        for (const bad of [undefined, null, '', 'abc', 0, -1, NaN, Infinity]) expect(() => checkPrice(bad, 'x')).toThrow()
    })

    it('keeps one point per day, the last N, dropping bad rows', () => {
        const d = 86_400_000
        const pts = normaliseHistory(
            [
                [3 * d + 5000, '3'],
                [1 * d, 1],
                [2 * d, 'bad'],
                [3 * d + 9000, 3.5], // later same day wins
                [4 * d, 4],
            ],
            2
        )
        expect(pts).toEqual([
            [3 * d, 3.5],
            [4 * d, 4],
        ])
    })
})

describe('the chosen service', () => {
    beforeEach(() => {
        localStorage.clear()
        jest.resetModules()
    })

    it('defaults to CoinGecko, remembers a choice, and ignores an unknown saved id', async () => {
        let prices = await import('@/prices')
        expect(prices.priceServiceId.value).toBe('coingecko')

        prices.setPriceService('kraken')
        expect(localStorage.getItem('price_service')).toBe('kraken')

        jest.resetModules()
        prices = await import('@/prices')
        expect(prices.priceServiceId.value).toBe('kraken')

        localStorage.setItem('price_service', 'no-such-service')
        jest.resetModules()
        prices = await import('@/prices')
        expect(prices.priceServiceId.value).toBe('coingecko')
    })

    it('routes the wallet AVAX price and history through the chosen service', async () => {
        const helper = await import('@/helpers/price_helper')
        const prices = await import('@/prices')

        requests.length = 0
        await helper.getAvaxPriceUSD()
        expect(requests[0].url).toContain('coingecko.com')

        requests.length = 0
        prices.setPriceService('coinbase')
        // Switching reloads the history from the new service straight away.
        await new Promise((r) => setTimeout(r, 0))
        expect(requests.some((r) => r.url.includes('exchange.coinbase.com'))).toBe(true)

        requests.length = 0
        await helper.getAvaxPriceUSD()
        expect(requests[0].url).toContain('api.coinbase.com')
    })

    it('tells listeners only when the service actually changes', async () => {
        const prices = await import('@/prices')
        const seen: string[] = []
        const off = prices.onPriceServiceChange((s) => seen.push(s.id))
        prices.setPriceService('okx')
        prices.setPriceService('okx')
        prices.setPriceService('bybit')
        off()
        prices.setPriceService('gateio')
        expect(seen).toEqual(['okx', 'bybit'])
    })
})
