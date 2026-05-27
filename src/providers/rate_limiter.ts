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
     */
    async acquire(): Promise<void> {
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
        return this.queue.length
    }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const globalRateLimiter = new FixedWindowRateLimiter(
    PROVIDER_CONFIG.rateLimit.maxRequests,
    PROVIDER_CONFIG.rateLimit.windowMs,
)

// ── Interceptors ──────────────────────────────────────────────────────────────

let axiosInterceptorId: number | null = null
let originalFetch: typeof globalThis.fetch | null = null

/**
 * Install an axios request interceptor that acquires a rate-limit slot before
 * each request is dispatched.
 */
function installAxiosInterceptor(): void {
    if (axiosInterceptorId !== null) return
    axiosInterceptorId = axios.interceptors.request.use(async (config) => {
        await globalRateLimiter.acquire()
        return config
    })
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
        return originalFetch!(input, init)
    }
}

/**
 * Install both the axios interceptor and the fetch wrapper.
 * Safe to call multiple times (idempotent).
 */
export function installRateLimiter(): void {
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
