/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Global fixed-window rate limiter for all outgoing network requests.
 *
 * Strategy: Fixed window — up to `maxRequests` requests are allowed in each
 * `windowMs` window. Requests that arrive after the window is exhausted are
 * queued and released at the start of the next window (FIFO order).
 *
 * Usage:
 *   import { installRateLimiter } from '@/providers/rate_limiter'
 *   installRateLimiter()   // call once before app.mount()
 *
 * Configuration is read from PROVIDER_CONFIG.rateLimit and can be changed at
 * runtime via `globalRateLimiter.configure({ maxRequests, windowMs })`.
 */

import axios from 'axios'
import { PROVIDER_CONFIG } from './provider_config'

// ── Core limiter ─────────────────────────────────────────────────────────────

const RATE_LIMIT_STORAGE_KEY = 'avxto_rate_limit_config'

export class FixedWindowRateLimiter {
    private maxRequests: number
    private windowMs: number
    private count = 0
    private windowStart = Date.now()
    private queue: Array<() => void> = []
    private resetTimer: ReturnType<typeof setTimeout> | null = null

    constructor(maxRequests: number, windowMs: number) {
        this.maxRequests = maxRequests
        this.windowMs = windowMs
    }

    configure(opts: { maxRequests?: number; windowMs?: number }): void {
        if (opts.maxRequests !== undefined) this.maxRequests = opts.maxRequests
        if (opts.windowMs !== undefined) this.windowMs = opts.windowMs
    }

    get currentMaxRequests(): number {
        return this.maxRequests
    }

    get currentWindowMs(): number {
        return this.windowMs
    }

    saveConfig(): void {
        try {
            localStorage.setItem(
                RATE_LIMIT_STORAGE_KEY,
                JSON.stringify({ maxRequests: this.maxRequests, windowMs: this.windowMs }),
            )
        } catch (e) {
            console.warn('[RateLimiter] Failed to persist config:', e)
        }
    }

    loadConfig(): void {
        try {
            const stored = localStorage.getItem(RATE_LIMIT_STORAGE_KEY)
            if (!stored) return
            const cfg = JSON.parse(stored)
            if (typeof cfg.maxRequests === 'number' && cfg.maxRequests > 0) this.maxRequests = cfg.maxRequests
            if (typeof cfg.windowMs === 'number' && cfg.windowMs > 0) this.windowMs = cfg.windowMs
        } catch (e) {
            console.warn('[RateLimiter] Failed to load config:', e)
        }
    }

    // ── Pause / resume ─────────────────────────────────────────────────────

    private isPaused = false
    private pauseQueue: Array<() => void> = []

    /**
     * Halt all outgoing requests for `durationMs` ms.
     * Safe to call multiple times — subsequent calls while paused are no-ops.
     */
    pause(durationMs: number, code: number = 429): void {
        if (this.isPaused) return
        this.isPaused = true
        // Cancel any in-flight window timer so it doesn't flush while paused
        if (this.resetTimer !== null) {
            clearTimeout(this.resetTimer)
            this.resetTimer = null
        }
        // Move requests already waiting in the rate-limit queue into the pause queue
        this.pauseQueue.push(...this.queue.splice(0))
        window.dispatchEvent(new CustomEvent('avxto:network-paused', { detail: { durationMs, code } }))
        setTimeout(() => this.resume(), durationMs)
    }

    /** Resume traffic and drain queued requests through normal rate limiting. */
    resume(): void {
        if (!this.isPaused) return
        this.isPaused = false
        // Fresh window so the first batch of queued requests are released cleanly
        this.windowStart = Date.now()
        this.count = 0
        // Re-inject paused requests at the front of the rate-limit queue
        this.queue.unshift(...this.pauseQueue.splice(0))
        this.flushQueue()
        window.dispatchEvent(new CustomEvent('avxto:network-resumed'))
    }

    // ── Fixed-window internals ─────────────────────────────────────────────

    private scheduleReset(): void {
        if (this.resetTimer !== null) return
        const elapsed = Date.now() - this.windowStart
        const remaining = Math.max(0, this.windowMs - elapsed)
        this.resetTimer = setTimeout(() => {
            this.windowStart = Date.now()
            this.count = 0
            this.resetTimer = null
            this.flushQueue()
        }, remaining)
    }

    private flushQueue(): void {
        while (this.queue.length > 0 && this.count < this.maxRequests) {
            const resolve = this.queue.shift()!
            this.count++
            resolve()
        }
        if (this.queue.length > 0) {
            // More items remain; schedule another window reset
            this.scheduleReset()
        }
    }

    /**
     * Acquire a slot. Resolves immediately if a slot is available in the
     * current window, otherwise waits until the next window opens.
     * While the limiter is paused, the caller waits until resume() is called.
     */
    async acquire(): Promise<void> {
        if (this.isPaused) {
            return new Promise<void>((resolve) => {
                this.pauseQueue.push(resolve)
            })
        }

        const now = Date.now()
        if (now - this.windowStart >= this.windowMs) {
            // Current window has expired — start a fresh one
            this.windowStart = now
            this.count = 0
            if (this.resetTimer !== null) {
                clearTimeout(this.resetTimer)
                this.resetTimer = null
            }
        }

        if (this.count < this.maxRequests) {
            this.count++
            return
        }

        // Window is full — queue and wait
        this.scheduleReset()
        return new Promise<void>((resolve) => {
            this.queue.push(resolve)
        })
    }

    get queueLength(): number {
        return this.queue.length + this.pauseQueue.length
    }

    get paused(): boolean {
        return this.isPaused
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const globalRateLimiter = new FixedWindowRateLimiter(
    PROVIDER_CONFIG.rateLimit.maxRequests,
    PROVIDER_CONFIG.rateLimit.windowMs,
)

// ── Throttle helpers ──────────────────────────────────────────────────────────

const DEFAULT_BACKOFF: Record<number, number> = { 429: 30_000, 503: 60_000 }

/**
 * Parse a Retry-After response header into milliseconds.
 * Supports both a delay-seconds integer and an HTTP-date string.
 * Falls back to DEFAULT_BACKOFF for the given status code.
 */
function parseRetryAfter(header: string | null | undefined, status: number): number {
    if (header) {
        const seconds = Number(header)
        if (!Number.isNaN(seconds) && seconds > 0) return seconds * 1000
        const date = Date.parse(header)
        if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
    }
    return DEFAULT_BACKOFF[status] ?? 30_000
}

/**
 * Call this when an HTTP 429 or 503 is received.
 * Parses the Retry-After header and pauses the global rate limiter for
 * the appropriate duration.
 */
export function handleThrottleResponse(status: number, retryAfterHeader?: string | null): void {
    if (status !== 429 && status !== 503) return
    const durationMs = parseRetryAfter(retryAfterHeader, status)
    globalRateLimiter.pause(durationMs, status)
}

// ── Interceptors ──────────────────────────────────────────────────────────────

let axiosInterceptorId: number | null = null
let originalFetch: typeof globalThis.fetch | null = null

/**
 * Install an axios request interceptor that acquires a rate-limit slot before
 * each request is dispatched, and a response interceptor that pauses traffic
 * on HTTP 429 / 503 from bare `axios` calls.
 */
function installAxiosInterceptor(): void {
    if (axiosInterceptorId !== null) return
    axiosInterceptorId = axios.interceptors.request.use(async (config) => {
        await globalRateLimiter.acquire()
        return config
    })
    axios.interceptors.response.use(
        undefined,
        (error) => {
            const status: number | undefined = error.response?.status
            if (status === 429 || status === 503) {
                handleThrottleResponse(status, error.response?.headers?.['retry-after'])
            }
            return Promise.reject(error)
        },
    )
}

/**
 * Replace `globalThis.fetch` with a wrapper that acquires a rate-limit slot
 * before every call.  The original `fetch` is saved so it can be restored.
 */
function installFetchWrapper(): void {
    if (originalFetch !== null) return // already installed
    originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async function rateLimitedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        await globalRateLimiter.acquire()
        const response = await originalFetch!(input, init)
        if (response.status === 429 || response.status === 503) {
            handleThrottleResponse(response.status, response.headers.get('retry-after'))
        }
        return response
    }
}

/**
 * Install both the axios interceptor and the fetch wrapper.
 * Safe to call multiple times (idempotent).
 */
export function installRateLimiter(): void {
    globalRateLimiter.loadConfig()
    installAxiosInterceptor()
    installFetchWrapper()
}

/**
 * Remove the rate limiter from axios and restore the original fetch.
 * Primarily useful in tests.
 */
export function uninstallRateLimiter(): void {
    if (axiosInterceptorId !== null) {
        axios.interceptors.request.eject(axiosInterceptorId)
        axiosInterceptorId = null
    }
    if (originalFetch !== null) {
        globalThis.fetch = originalFetch
        originalFetch = null
    }
}
