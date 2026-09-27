/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Watcher limit orders (js/LimitOrder). The property that makes it a LIMIT
 * order: a fill is only ever signed from a quote whose enforced minimum is at
 * or above the user's limit — so it cannot settle below their price.
 */
import { BN } from '@/avalanche'
import {
    LimitOrderWatcher,
    MIN_FILL_SLIPPAGE_PERCENT,
    fillSlippagePercent,
    guaranteesLimit,
    isUserRejection,
    limitMinOut,
    quoteRate,
    reachesLimit,
    type FillOutcome,
    type WatchSnapshot,
} from '@/js/LimitOrder'
import type { SwapQuote } from '@/js/ArenaSwap'

const AVAX = { decimals: 18 }
const USDC = { decimals: 6 }
const e18 = (n: string) => new BN(n).mul(new BN('1000000000000000000'))

const quote = (toAmount: string, toAmountMin = toAmount): SwapQuote => ({
    fromAmount: '0',
    toAmount,
    toAmountMin,
    fromAmountUSD: 0,
    toAmountUSD: 0,
    priceImpact: null,
    approvalAddress: null,
    gasLimit: 500000,
    transactionRequest: { to: '0x1', data: '0x', value: '0x0' },
})

describe('limit price maths', () => {
    it('sell side: at least P tokenOut per tokenIn', () => {
        // Sell 10 AVAX at >= 25.5 USDC each -> at least 255 USDC.
        expect(limitMinOut(e18('10'), '25.5', 'sell', AVAX, USDC).toString()).toBe('255000000')
    })

    it('buy side: pay at most P tokenIn per tokenOut', () => {
        // Spend 100 USDC buying AVAX at <= 25 USDC each -> at least 4 AVAX.
        expect(limitMinOut(new BN(100_000_000), '25', 'buy', USDC, AVAX).toString()).toBe(
            '4000000000000000000'
        )
    })

    it('rounds the minimum UP, never accepting a fraction below the limit', () => {
        // 1 base unit of AVAX at 1 USDC: 1e-18 USDC, which must round to 1 unit, not 0.
        expect(limitMinOut(new BN(1), '1', 'sell', AVAX, USDC).toString()).toBe('1')
        // 10 USDC buying at 3 USDC per AVAX: 3.333… AVAX, rounded up.
        expect(limitMinOut(new BN(10_000_000), '3', 'buy', USDC, AVAX).toString()).toBe(
            '3333333333333333334'
        )
    })

    it('refuses a zero or negative price', () => {
        expect(() => limitMinOut(e18('1'), '0', 'sell', AVAX, USDC)).toThrow(/greater than zero/)
    })

    it('reads a quote as tokenOut per tokenIn', () => {
        expect(quoteRate(e18('10'), '255000000', AVAX, USDC).toString()).toBe('25.5')
    })
})

describe('what triggers and what may be signed', () => {
    const minOut = new BN(1000)

    it('triggers on the expected output, signs only on the guaranteed minimum', () => {
        const q = quote('1010', '999')
        expect(reachesLimit(q, minOut)).toBe(true)
        expect(guaranteesLimit(q, minOut)).toBe(false)
        expect(guaranteesLimit(quote('1010', '1000'), minOut)).toBe(true)
    })

    it('tightens slippage to the gap above the limit, within bounds', () => {
        // 2% above the limit, user allows 5% -> ask for 1.96% (rounded down).
        expect(fillSlippagePercent(new BN(1020), minOut, 5)).toBe(1.96)
        // Never more than the user's maximum.
        expect(fillSlippagePercent(new BN(2000), minOut, 1)).toBe(1)
        // Never below what routes build.
        expect(fillSlippagePercent(new BN(1000_1), new BN(1000_0), 5)).toBe(MIN_FILL_SLIPPAGE_PERCENT)
    })

    it('recognises a user saying no', () => {
        expect(isUserRejection({ code: 4001 })).toBe(true)
        expect(isUserRejection(new Error('User rejected the request.'))).toBe(true)
        expect(isUserRejection(new Error('execution reverted'))).toBe(false)
    })
})

describe('LimitOrderWatcher', () => {
    const minOut = new BN(1000)

    function watcher(opts: {
        quotes: (SwapQuote | Error)[]
        fill?: (slip: number) => Promise<FillOutcome>
        expiresAt?: number | null
        now?: () => number
    }) {
        const snaps: WatchSnapshot[] = []
        const fills: number[] = []
        let i = 0
        const w = new LimitOrderWatcher({
            minOut,
            maxSlippagePercent: 5,
            expiresAt: opts.expiresAt ?? null,
            intervalMs: 1000,
            now: opts.now,
            quote: async () => {
                const q = opts.quotes[Math.min(i++, opts.quotes.length - 1)]
                if (q instanceof Error) throw q
                return q
            },
            fill: async (slip) => {
                fills.push(slip)
                return opts.fill ? opts.fill(slip) : { kind: 'filled', txHash: '0xabc', outRaw: new BN(1015) }
            },
            onUpdate: (s) => snaps.push(s),
        })
        return { w, snaps, fills }
    }

    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    /** Lets a tick's awaits run to completion. */
    const settle = async () => {
        for (let k = 0; k < 10; k++) await Promise.resolve()
    }

    it('keeps watching below the limit, then fills when it is reached', async () => {
        const { w, fills } = watcher({ quotes: [quote('900'), quote('990'), quote('1020')] })
        w.start()
        await settle()
        expect(w.snapshot.state).toBe('watching')
        expect(fills).toHaveLength(0)

        jest.advanceTimersByTime(1000)
        await settle()
        expect(fills).toHaveLength(0)

        jest.advanceTimersByTime(1000)
        await settle()
        expect(fills).toEqual([1.96])
        expect(w.snapshot.state).toBe('filled')
        expect(w.snapshot.txHash).toBe('0xabc')

        // Filled orders stop checking.
        jest.advanceTimersByTime(10_000)
        await settle()
        expect(w.snapshot.checks).toBe(3)
    })

    it('goes back to watching when the price moved away before the fill', async () => {
        const { w } = watcher({ quotes: [quote('1020')], fill: async () => ({ kind: 'not-met' }) })
        w.start()
        await settle()
        expect(w.snapshot.state).toBe('watching')
    })

    it('pauses, rather than prompting again, when the user declines', async () => {
        const { w, fills } = watcher({ quotes: [quote('1020')], fill: async () => ({ kind: 'declined' }) })
        w.start()
        await settle()
        expect(w.snapshot.state).toBe('paused')
        expect(w.snapshot.pausedReason).toMatch(/declined/)

        jest.advanceTimersByTime(10_000)
        await settle()
        expect(fills).toHaveLength(1)

        w.resume()
        await settle()
        expect(fills).toHaveLength(2)
    })

    it('pauses on a failed fill instead of retrying it every tick', async () => {
        const { w, fills } = watcher({
            quotes: [quote('1020')],
            fill: async () => ({ kind: 'failed', error: 'execution reverted', txHash: '0xdead' }),
        })
        w.start()
        await settle()
        jest.advanceTimersByTime(20_000)
        await settle()
        expect(fills).toHaveLength(1)
        expect(w.snapshot).toMatchObject({ state: 'paused', pausedReason: 'execution reverted', txHash: '0xdead' })
    })

    it('backs off while quotes fail, and keeps watching', async () => {
        const { w } = watcher({ quotes: [new Error('rate limited'), new Error('rate limited'), quote('900')] })
        w.start()
        await settle()
        expect(w.snapshot.lastError).toBe('rate limited')

        // After one failure the wait doubles: nothing at 1s, a check at 2s.
        jest.advanceTimersByTime(1000)
        await settle()
        expect(w.snapshot.checks).toBe(0)
        jest.advanceTimersByTime(1000)
        await settle()
        // Second failure: next wait is 4s.
        jest.advanceTimersByTime(4000)
        await settle()
        expect(w.snapshot.checks).toBe(1)
        expect(w.snapshot.lastError).toBe('')
        expect(w.snapshot.state).toBe('watching')
    })

    it('expires at its deadline without checking the market', async () => {
        let now = 0
        const { w } = watcher({ quotes: [quote('900')], expiresAt: 5000, now: () => now })
        w.start()
        await settle()
        now = 5000
        jest.advanceTimersByTime(1000)
        await settle()
        expect(w.snapshot.state).toBe('expired')
    })

    it('stops checking once cancelled', async () => {
        const { w } = watcher({ quotes: [quote('900')] })
        w.start()
        await settle()
        w.cancel()
        jest.advanceTimersByTime(10_000)
        await settle()
        expect(w.snapshot.state).toBe('cancelled')
        expect(w.snapshot.checks).toBe(1)
    })
})
