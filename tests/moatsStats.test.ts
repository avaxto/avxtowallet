/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Moats dashboard's data layer: the moats.app API and DexScreener parsers
 * against payloads captured from a real load of moats.app's dashboard
 * (tests/fixtures/moats), and the contract-points conversion.
 */
import { BN } from '@/avalanche'
import {
    parseConfig,
    parseLeaderboard,
    parseUserPoints,
    parseDexOrders,
    pickMarket,
    profileLinks,
    pointsAsTokens,
} from '@/js/MoatsStats'

import userPoints from './fixtures/moats/user-points.json'
import leaderboard from './fixtures/moats/leaderboard.json'
import config from './fixtures/moats/config.json'
import dexscreener from './fixtures/moats/dexscreener.json'
import liveToken from './fixtures/avxto/dexscreener-token.json'

describe('moats.app API parsers', () => {
    it('reads a user\'s points, breakdown and indexed token amounts', () => {
        const p = parseUserPoints(userPoints)
        expect(p.points).toBe(1719)
        expect(p.currentEpoch?.epochNumber).toBe(26)
        expect(p.boosted).toBe(false)
        expect(p.tokenAmounts).toEqual({ staked: 3345678, locked: 1234567, burnt: 2000000 })
        expect(p.breakdown.burnt).toBe(2000000)
        expect(p.breakdownPercent.burnt).toBeCloseTo(67.754, 2)
        expect(p.lockEndTimestamp).toBe(1853254303)
    })

    it('reads the leaderboard in rank order', () => {
        const lb = parseLeaderboard(leaderboard)!
        expect(lb.entries).toHaveLength(5)
        expect(lb.entries[0]).toMatchObject({ rank: 1, points: 7096 })
        expect(lb.entries[1].username).toBe('gator.degen')
        expect(lb.entries[2].address).toBe('0x5da60a5391bf349e64d4d2ae41c5e28896396fd9')
    })

    it('reads the moat config, keeping only hex tag colours', () => {
        const c = parseConfig(config)
        expect(c).toMatchObject({ status: 'Verified', moatVersion: 3, boostActive: false })
        expect(c.tags).toEqual([
            { name: 'Arena Launched', color: '#ffa305' },
            { name: 'Community', color: '#2bbf44' },
        ])
        const hostile = parseConfig({ tags: [{ name: 'x', color: 'red; background: url(//evil)' }] })
        expect(hostile.tags[0].color).toBe('')
    })

    it('survives an empty or malformed payload rather than throwing', () => {
        expect(parseUserPoints(null).points).toBe(0)
        expect(parseLeaderboard({})!.entries).toEqual([])
        expect(parseConfig(undefined).tags).toEqual([])
    })
})

describe('pickMarket', () => {
    it('prices AVXTO from the deepest pair, not a thin one', () => {
        const m = pickMarket(dexscreener)!
        // The capture's two pairs: ArenaTrade (~$9.7k liquidity) and a
        // Uniswap pair with about $1 that quotes a different price.
        expect(m.dex).toBe('arenatrade')
        expect(m.priceUsd).toBe(0.000001867)
        expect(m.liquidityUsd).toBeGreaterThan(9000)
        expect(m.pairUrl).toMatch(/^https:\/\/dexscreener\.com\//)
    })

    it('returns null when there is no AVXTO pair on Avalanche', () => {
        expect(pickMarket({ pairs: [] })).toBeNull()
        expect(pickMarket(null)).toBeNull()
    })

    it('carries every window, totals across pairs, and the pooled amounts', () => {
        const m = pickMarket(dexscreener)!
        expect(m.txns.h24).toEqual({ buys: 24, sells: 8 })
        expect(m.volumeUsd.h1).toBe(157.69)
        expect(m.priceChange.m5).toBe(-4.12)
        expect(m.quoteSymbol).toBe('WAVAX')
        expect(m.pairCount).toBe(2)
        expect(m.totalLiquidityUsd).toBeCloseTo(9760.36 + 1.12, 2)
        expect(m.pooledBase).toBe(2612792428)
    })

    it('reads the live token payload: quiet windows are unknown, not 0%, and profile links are kept', () => {
        const m = pickMarket(liveToken)!
        // DexScreener leaves out m5/h1 price change when nothing traded in them.
        expect(m.priceChange.m5).toBeNull()
        expect(m.priceChange.h24).toBe(8.29)
        expect(m.headerImage).toMatch(/^https:\/\/cdn\.dexscreener\.com\//)
        expect(m.links.map((l) => l.label)).toEqual(['Website', 'Docs', 'X', 'Telegram'])
    })
})

describe('profileLinks', () => {
    it('keeps https links only, since they become hrefs', () => {
        const links = profileLinks({
            websites: [{ label: 'Site', url: 'https://ok.example' }, { label: 'Bad', url: 'javascript:alert(1)' }],
            socials: [{ type: 'twitter', url: 'http://x.com/insecure' }, { type: 'telegram', url: 'https://t.me/x' }],
        })
        expect(links).toEqual([
            { label: 'Site', url: 'https://ok.example' },
            { label: 'Telegram', url: 'https://t.me/x' },
        ])
    })
})

describe('parseDexOrders', () => {
    it('finds the token profile order', () => {
        const p = parseDexOrders({
            orders: [{ type: 'tokenProfile', status: 'approved', paymentTimestamp: 1750913420995 }],
            boosts: [],
        })
        expect(p).toEqual({ status: 'approved', since: 1750913420995 })
        expect(parseDexOrders({ orders: [] })).toEqual({ status: '', since: 0 })
    })
})

describe('pointsAsTokens', () => {
    it('turns raw contract points into AVXTO-weighted units', () => {
        // The live figure for the capture's address: 3,345,678 staked x1 +
        // 1,234,567 locked x5 + 2,000,000 burned x10 = 29,518,513, stored as
        // amount / POINTS_SCALING_FACTOR (1e12) with 18 decimals.
        const raw = new BN('29518513').mul(new BN('1000000'))
        expect(pointsAsTokens(raw, new BN('1000000000000'), 18)).toBe(29518513)
    })
})
