/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Watcher limit orders: swap `amountIn` of one token for at least `minOut`
 * of another, as soon as the market allows — for as long as the tab that
 * armed the order stays open.
 *
 * Not an exchange order. Nothing is placed anywhere: this polls LI.FI quotes
 * (the same routing js/ArenaSwap uses for swaps and iceberg orders) and, when
 * a quote reaches the limit, executes it. What makes it a LIMIT order rather
 * than a price alert is how the fill is priced:
 *
 *   A quote carries `toAmountMin` — the minimum output the transaction LI.FI
 *   builds will accept on-chain, otherwise it reverts. A fill is only sent
 *   when that minimum is at or above the limit, so the swap cannot settle
 *   below the user's price: it either fills at the limit or better, or it
 *   reverts (costing gas, not tokens). The slippage asked for is tightened
 *   to make room — see `fillSlippagePercent`.
 *
 * All-or-nothing: the whole amount is quoted and swapped in one transaction.
 *
 * The wallet signs at fill time, not when the order is armed. Session
 * authorization scopes are short on purpose (see js/security/session), and
 * holding one open for an order that may wait for hours would defeat them.
 * So a filling order asks — the extension shows its approval popup, a
 * phrase wallet its password prompt — and the fresh quote is taken AFTER the
 * password, inside the authorized call, so what is signed is current.
 */
import Big from 'big.js'

import { BN } from '@/avalanche'
import type { SwapQuote, SwapToken } from './ArenaSwap'

/** Which way the user typed the price. */
export type LimitSide =
    /** Price is tokenOut per 1 tokenIn — fill when it is AT LEAST this. */
    | 'sell'
    /** Price is tokenIn per 1 tokenOut — fill when it is AT MOST this. */
    | 'buy'

/** Never quote tighter than this: many routes refuse to build below it. */
export const MIN_FILL_SLIPPAGE_PERCENT = 0.1

const pow10 = (d: number) => Big(10).pow(d)

/**
 * The least `tokenOut` (base units) a fill may return, from the limit price.
 * Rounded UP: a limit is a floor, and rounding it down would accept a fill a
 * fraction below the user's price.
 */
export function limitMinOut(
    amountInRaw: BN,
    price: string,
    side: LimitSide,
    tokenIn: Pick<SwapToken, 'decimals'>,
    tokenOut: Pick<SwapToken, 'decimals'>
): BN {
    const p = Big(price)
    if (p.lte(0)) throw new Error('The limit price must be greater than zero.')
    const amountIn = Big(amountInRaw.toString()).div(pow10(tokenIn.decimals))
    const out = side === 'sell' ? amountIn.times(p) : amountIn.div(p)
    // round(0, 3) = ROUND_UP
    return new BN(out.times(pow10(tokenOut.decimals)).round(0, 3).toFixed(0))
}

/** tokenOut per 1 tokenIn, as a quote prices it. */
export function quoteRate(
    amountInRaw: BN,
    toAmountRaw: string | BN,
    tokenIn: Pick<SwapToken, 'decimals'>,
    tokenOut: Pick<SwapToken, 'decimals'>
): Big {
    const inHuman = Big(amountInRaw.toString()).div(pow10(tokenIn.decimals))
    if (inHuman.eq(0)) return Big(0)
    return Big(toAmountRaw.toString()).div(pow10(tokenOut.decimals)).div(inHuman)
}

/** Whether a quote's expected output reaches the limit — the trigger. */
export function reachesLimit(q: Pick<SwapQuote, 'toAmount'>, minOut: BN): boolean {
    return new BN(q.toAmount || '0').gte(minOut)
}

/**
 * Whether a quote is safe to SIGN: its enforced minimum is at or above the
 * limit, so the swap cannot settle below the user's price.
 */
export function guaranteesLimit(q: Pick<SwapQuote, 'toAmountMin'>, minOut: BN): boolean {
    return new BN(q.toAmountMin || '0').gte(minOut)
}

/**
 * The slippage to ask for when filling, given the quote that triggered it:
 * the gap between the expected output and the limit, so the quote's minimum
 * lands on or above the limit — never more than the user's maximum, never
 * below what routes will build. When the gap is thinner than that floor the
 * resulting minimum will sit under the limit, `guaranteesLimit` says no, and
 * the order simply keeps watching.
 */
export function fillSlippagePercent(expectedOut: BN, minOut: BN, maxPercent: number): number {
    if (expectedOut.lte(minOut) || expectedOut.isZero()) return MIN_FILL_SLIPPAGE_PERCENT
    const gap = Big(expectedOut.sub(minOut).toString()).div(expectedOut.toString()).times(100)
    // Down to 2 decimals (round(2, 0) = ROUND_DOWN), so rounding never widens it.
    const pct = Number(gap.round(2, 0).toString())
    return Math.min(maxPercent, Math.max(MIN_FILL_SLIPPAGE_PERCENT, pct))
}

// ─── The watcher ───────────────────────────────────────────────────────────

export type WatchState =
    | 'watching'
    /** The limit was reached; the fill is being authorized, signed or mined. */
    | 'filling'
    | 'filled'
    /** Offline signing captured the fill instead of broadcasting it. */
    | 'captured'
    /** Stopped by a declined prompt or a failed fill; resumable. */
    | 'paused'
    | 'expired'
    | 'cancelled'

export type FillOutcome =
    | { kind: 'filled'; txHash: string; outRaw: BN }
    | { kind: 'captured'; txHash: string }
    /** The fresh quote taken at fill time no longer met the limit. */
    | { kind: 'not-met' }
    /** The user dismissed the password prompt or rejected in the extension. */
    | { kind: 'declined' }
    | { kind: 'failed'; error: string; txHash?: string }

export interface WatchSnapshot {
    state: WatchState
    /** The last market quote, and when it was taken (ms). */
    lastQuote: SwapQuote | null
    lastCheckedAt: number
    checks: number
    /** Why the last check or fill went wrong, when it did. */
    lastError: string
    /** Why the order is paused, when it is. */
    pausedReason: string
    txHash: string
    outRaw: BN | null
}

export interface WatcherConfig {
    minOut: BN
    maxSlippagePercent: number
    /** Unix ms after which the order stops watching; null for never. */
    expiresAt: number | null
    intervalMs: number
    /** A market quote at the given slippage. */
    quote(slippagePercent: number): Promise<SwapQuote>
    /**
     * Authorize, re-quote at `slippagePercent`, check `guaranteesLimit`,
     * approve if needed, send and wait for the receipt — see the page.
     */
    fill(slippagePercent: number): Promise<FillOutcome>
    onUpdate(snapshot: WatchSnapshot): void
    now?: () => number
}

/** Longest wait between checks while quotes keep failing. */
const MAX_BACKOFF_FACTOR = 8

export class LimitOrderWatcher {
    private snap: WatchSnapshot = {
        state: 'watching',
        lastQuote: null,
        lastCheckedAt: 0,
        checks: 0,
        lastError: '',
        pausedReason: '',
        txHash: '',
        outRaw: null,
    }
    private timer: ReturnType<typeof setTimeout> | null = null
    private ticking = false
    private failures = 0
    private readonly now: () => number

    constructor(private readonly cfg: WatcherConfig) {
        this.now = cfg.now ?? (() => Date.now())
    }

    get snapshot(): WatchSnapshot {
        return { ...this.snap }
    }

    /** Starts watching, checking the market immediately. */
    start(): void {
        this.set({ state: 'watching', pausedReason: '' })
        void this.tick()
    }

    /** From `paused`, back to watching. */
    resume(): void {
        if (this.snap.state !== 'paused') return
        this.failures = 0
        this.start()
    }

    /** Stops for good. A fill already being signed cannot be recalled. */
    cancel(): void {
        this.clearTimer()
        if (this.snap.state === 'watching' || this.snap.state === 'paused') this.set({ state: 'cancelled' })
    }

    /** Whether the order still needs the tab (watching, or mid-fill). */
    get isLive(): boolean {
        return this.snap.state === 'watching' || this.snap.state === 'filling'
    }

    private set(patch: Partial<WatchSnapshot>): void {
        this.snap = { ...this.snap, ...patch }
        this.cfg.onUpdate(this.snapshot)
    }

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
    }

    private schedule(): void {
        this.clearTimer()
        if (this.snap.state !== 'watching') return
        const factor = Math.min(2 ** this.failures, MAX_BACKOFF_FACTOR)
        this.timer = setTimeout(() => void this.tick(), this.cfg.intervalMs * factor)
    }

    /** One check: quote, and fill when the limit is reached. Exposed for tests. */
    async tick(): Promise<void> {
        if (this.ticking || this.snap.state !== 'watching') return
        this.ticking = true
        try {
            if (this.cfg.expiresAt !== null && this.now() >= this.cfg.expiresAt) {
                this.clearTimer()
                this.set({ state: 'expired' })
                return
            }

            let q: SwapQuote
            try {
                q = await this.cfg.quote(this.cfg.maxSlippagePercent)
            } catch (e: any) {
                this.failures++
                this.set({ lastError: e?.message || 'Could not get a quote', lastCheckedAt: this.now() })
                return
            }
            this.failures = 0
            // Cancelled while the quote was in flight: drop it.
            if (this.snap.state !== 'watching') return
            this.set({ lastQuote: q, lastCheckedAt: this.now(), checks: this.snap.checks + 1, lastError: '' })

            if (!reachesLimit(q, this.cfg.minOut)) return

            const slippage = fillSlippagePercent(new BN(q.toAmount), this.cfg.minOut, this.cfg.maxSlippagePercent)
            this.clearTimer()
            this.set({ state: 'filling' })

            let outcome: FillOutcome
            try {
                outcome = await this.cfg.fill(slippage)
            } catch (e: any) {
                outcome = { kind: 'failed', error: e?.message || 'The fill failed' }
            }

            switch (outcome.kind) {
                case 'filled':
                    this.set({ state: 'filled', txHash: outcome.txHash, outRaw: outcome.outRaw })
                    return
                case 'captured':
                    this.set({ state: 'captured', txHash: outcome.txHash })
                    return
                case 'not-met':
                    // The price moved back between the check and the fill.
                    this.set({ state: 'watching' })
                    return
                case 'declined':
                    this.set({
                        state: 'paused',
                        pausedReason: 'You declined the fill. Resume to keep watching.',
                    })
                    return
                case 'failed':
                    // Paused, not retried: a fill that reverted or errored
                    // would most likely fail the same way next tick and burn
                    // gas each time.
                    this.set({
                        state: 'paused',
                        pausedReason: outcome.error,
                        txHash: outcome.txHash ?? this.snap.txHash,
                    })
                    return
            }
        } finally {
            this.ticking = false
            this.schedule()
        }
    }
}

/** Whether an error is the user saying no — a dismissed prompt or rejected popup. */
export function isUserRejection(e: any): boolean {
    if (!e) return false
    if (e.code === 4001 || e?.cause?.code === 4001) return true
    return /user (rejected|denied|cancel)/i.test(String(e.message ?? ''))
}
