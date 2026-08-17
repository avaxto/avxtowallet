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

interface QueueEntry {
    resolve: () => void
    reject: (e: Error) => void
}

export class FixedWindowRateLimiter {
    private maxRequests: number
    private windowMs: number
    private count = 0
    private windowStart = Date.now()
    private queue: QueueEntry[] = []
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

    // ── Hard block (HTTP 429) ────────────────────────────────────────────

    private isBlocked = false

    /**
     * Permanently halt all outgoing requests. Unlike `pause()`, this never
     * auto-resumes — the only way out is a full page reload. Used when the
     * server responds with HTTP 429 (rate limited), signalling that retrying
     * from this tab would only make things worse.
     */
    block(code: number = 429): void {
        if (this.isBlocked) return
        this.isBlocked = true
        if (this.resetTimer !== null) {
            clearTimeout(this.resetTimer)
            this.resetTimer = null
        }
        // Reject everyone already waiting for a slot — leaving them queued
        // forever would hang their callers silently.
        const blockError = new Error(
            'Network requests are blocked: the server rate limited this app (HTTP 429). ' +
                'Close this tab and try again later.'
        )
        const waiters = [...this.queue.splice(0), ...this.pauseQueue.splice(0)]
        waiters.forEach((w) => w.reject(blockError))
        window.dispatchEvent(new CustomEvent('avxto:network-blocked', { detail: { code } }))
    }

    get blocked(): boolean {
        return this.isBlocked
    }

    // ── Pause / resume ─────────────────────────────────────────────────────

    private isPaused = false
    private pauseQueue: QueueEntry[] = []

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
            const entry = this.queue.shift()!
            this.count++
            entry.resolve()
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
        if (this.isBlocked) {
            throw new Error(
                'Network requests are blocked: the server returned HTTP 429 (rate limited). ' +
                    'Close this tab and try again later.'
            )
        }

        if (this.isPaused) {
            return new Promise<void>((resolve, reject) => {
                this.pauseQueue.push({ resolve, reject })
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
        return new Promise<void>((resolve, reject) => {
            this.queue.push({ resolve, reject })
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
 * A 429 (rate limited) escalates: first try to fail over to a public backup
 * RPC endpoint; only when all endpoints are exhausted does the permanent
 * hard block (and its modal) engage. A 503 (temporarily unavailable) is
 * treated as transient and pauses traffic for the parsed/default backoff
 * duration before auto-resuming.
 */
export function handleThrottleResponse(
    status: number,
    retryAfterHeader?: string | null,
    url?: string
): void {
    if (status === 429) {
        void escalateThrottle(url)
        return
    }
    if (status !== 503) return
    const durationMs = parseRetryAfter(retryAfterHeader, status)
    globalRateLimiter.pause(durationMs, status)
}

// Single in-flight escalation; concurrent 429s share the same run and result
// instead of racing independent failover attempts.
let escalationPromise: Promise<boolean> | null = null

// ── Third-party host throttling ──────────────────────────────────────────────
//
// Escalation exists for the Avalanche RPC endpoints the wallet cannot run
// without, and it ends in a PERMANENT global block when every endpoint is
// exhausted. The app also talks to hosts that are not those endpoints and
// have no failover candidates — block explorers, indexers, price feeds,
// swap aggregators. A 429 from one of those must never reach escalation:
// taking the whole wallet down (Avalanche included) because a third-party
// explorer rate limited a background refresh is a far worse outcome than
// that one feature degrading.
//
// Instead those hosts get a plain per-host cooldown. Callers that can
// degrade gracefully check `isHostThrottled()` and skip the host until it
// expires.

const FOREIGN_HOST_COOLDOWN_MS = 120_000

/** host -> timestamp (ms) after which the host may be tried again. */
const throttledHosts: { [host: string]: number } = {}

function noteHostThrottled(url: string | undefined): void {
    const host = hostOf(url)
    if (!host) return
    throttledHosts[host] = Date.now() + FOREIGN_HOST_COOLDOWN_MS
    console.warn(
        `[RateLimiter] ${host} rate limited — backing off that host for ` +
            `${FOREIGN_HOST_COOLDOWN_MS / 1000}s. Other hosts are unaffected.`
    )
}

/**
 * True while `url`'s host is in its post-429 cooldown.
 *
 * Multi-network features that fan out across many third-party endpoints
 * should consult this and skip a throttled host rather than hammering it,
 * degrading that one network instead of the whole feature.
 */
export function isHostThrottled(url: string | undefined): boolean {
    const host = hostOf(url)
    if (!host) return false
    const until = throttledHosts[host]
    if (until === undefined) return false
    if (Date.now() >= until) {
        delete throttledHosts[host]
        return false
    }
    return true
}

/**
 * A request to `url` was rate limited (explicit 429 or the CORS-hidden
 * equivalent). For a replaceable Avalanche RPC host: pause traffic, switch to
 * the next backup network via the failover module (a full
 * networkStore.setNetwork reconnect), and only hard-block when no candidates
 * are left. For any other host: back that host off on its own and leave
 * global state alone entirely.
 */
async function escalateThrottle(url: string | undefined): Promise<boolean> {
    if (globalRateLimiter.blocked) return false

    // Eligibility is resolved OUTSIDE the single-flight below, for two
    // reasons: a third-party 429 must not stall the app even briefly, and it
    // must not occupy the escalation slot — doing so would make a genuine
    // Avalanche 429 arriving at the same moment silently inherit the
    // third-party result and skip its failover.
    let eligible = false
    try {
        // Dynamic import to avoid a static dependency cycle
        // (rpc_failover imports this module for getRawFetch).
        const { isFailoverEligibleHost } = await import('./rpc_failover')
        eligible = await isFailoverEligibleHost(url)
    } catch (e) {
        // Fail open, not closed: without a reliable answer, back the single
        // host off rather than risk a permanent global block on a host that
        // may not even be ours.
        console.error('[RateLimiter] Could not classify throttled host:', e)
        noteHostThrottled(url)
        return false
    }

    if (!eligible) {
        noteHostThrottled(url)
        return false
    }

    return runEndpointEscalation(url)
}

/**
 * The original escalate-or-block path, now reached only for hosts failover
 * can actually replace. Single-flight: concurrent 429s share one run.
 */
function runEndpointEscalation(url: string | undefined): Promise<boolean> {
    if (escalationPromise) return escalationPromise

    // Hold all traffic while probing backup candidates. The failover module
    // resumes the limiter itself right before its setNetwork() reconnect
    // (that traffic must flow); the resume() below is a no-op in that case
    // and only matters for the "already recovered, nothing to do" path.
    // Long timeout — we exit via resume() or block(), not the timer.
    globalRateLimiter.pause(600_000, 429)

    escalationPromise = (async () => {
        try {
            const { tryEndpointFailover } = await import('./rpc_failover')
            const switched = await tryEndpointFailover(url)
            if (switched) {
                globalRateLimiter.resume()
            } else {
                globalRateLimiter.block(429)
            }
            return switched
        } catch (e) {
            console.error('[RateLimiter] RPC failover failed:', e)
            globalRateLimiter.block(429)
            return false
        } finally {
            escalationPromise = null
        }
    })()

    return escalationPromise
}

// ── Opaque (CORS-blocked) throttle detection ─────────────────────────────────
//
// When api.avax.network rate-limits a client, Cloudflare returns the 429
// WITHOUT CORS headers. The browser then hides the response from JavaScript
// entirely: fetch() rejects with a bare TypeError and axios reports a network
// error with no `error.response`. The status check above never sees the 429,
// which is exactly what a captured HAR showed — 41 429s on the wire, zero
// visible to the app, so the hard-block never engaged.
//
// Since the status is unreadable, infer throttling instead: N consecutive
// opaque network failures to the SAME host, while the browser is online,
// with no success from that host in between, is treated as a 429 and
// triggers the global hard block.

const OPAQUE_FAILURE_THRESHOLD = 3
const OPAQUE_FAILURE_WINDOW_MS = 60_000

const opaqueFailures: { [host: string]: { count: number; last: number } } = {}

function hostOf(url: string | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url, window.location.href).host
    } catch {
        return null
    }
}

/**
 * Call when a request to `url` failed at the network/CORS level (no readable
 * response). Returns the escalation promise when this failure crossed the
 * streak threshold, or null when it didn't — a lone failure could just be a
 * transient blip, not a 429.
 */
export function registerOpaqueNetworkFailure(url: string | undefined): Promise<boolean> | null {
    // A real connectivity loss also rejects fetches — don't punish that.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return null

    const host = hostOf(url)
    if (!host) return null

    const now = Date.now()
    const entry = opaqueFailures[host]
    if (!entry || now - entry.last > OPAQUE_FAILURE_WINDOW_MS) {
        opaqueFailures[host] = { count: 1, last: now }
        return null
    }

    entry.count++
    entry.last = now

    if (entry.count >= OPAQUE_FAILURE_THRESHOLD) {
        console.warn(
            `[RateLimiter] ${entry.count} consecutive opaque network failures for ${host} — ` +
                'treating as a CORS-hidden HTTP 429.'
        )
        delete opaqueFailures[host]
        return escalateThrottle(url)
    }
    return null
}

/** Call when a request to `url` succeeded — resets that host's failure streak. */
export function registerNetworkSuccess(url: string | undefined): void {
    const host = hostOf(url)
    if (host && opaqueFailures[host]) {
        delete opaqueFailures[host]
    }
}

// ── Interceptors ──────────────────────────────────────────────────────────────

let axiosInterceptorId: number | null = null
let originalFetch: typeof globalThis.fetch | null = null

/** Resolve the full request URL from an axios config (url may be relative to baseURL). */
function axiosRequestUrl(config?: { url?: string; baseURL?: string }): string | undefined {
    if (!config?.url) return undefined
    try {
        return config.baseURL ? new URL(config.url, config.baseURL).href : config.url
    } catch {
        return config.url
    }
}

/** Extract a URL string from the fetch input argument. */
function fetchInputUrl(input: RequestInfo | URL): string | undefined {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.href
    return input?.url
}

/**
 * Install an axios request interceptor that acquires a rate-limit slot before
 * each request is dispatched, and a response interceptor that pauses traffic
 * on HTTP 429 / 503 from bare `axios` calls.
 */
function installAxiosInterceptor(): void {
    if (axiosInterceptorId !== null) return
    axiosInterceptorId = axios.interceptors.request.use(async (config) => {
        // Requests with a custom adapter (avalanchejs sets the fetch adapter)
        // are executed through the wrapped global fetch, which acquires its
        // own slot — acquiring here too would double-count every request.
        if (!config.adapter) {
            await globalRateLimiter.acquire()
        }
        return config
    })
    axios.interceptors.response.use(
        (response) => {
            registerNetworkSuccess(axiosRequestUrl(response.config))
            return response
        },
        (error) => {
            const status: number | undefined = error.response?.status
            if (status === 429 || status === 503) {
                handleThrottleResponse(
                    status,
                    error.response?.headers?.['retry-after'],
                    axiosRequestUrl(error.config)
                )
            } else if (!error.response && error.request) {
                // Network-level failure with no readable response — possibly a
                // CORS-hidden 429 (see registerOpaqueNetworkFailure).
                registerOpaqueNetworkFailure(axiosRequestUrl(error.config))
            }
            return Promise.reject(error)
        },
    )
}

/**
 * Replace `globalThis.fetch` with a wrapper that acquires a rate-limit slot
 * before every call.  The original `fetch` is saved so it can be restored.
 *
 * No per-request retry here: a 429 (or an opaque-failure streak) escalates
 * into a full network failover — networkStore.setNetwork() re-runs the whole
 * data pipeline (balances, history, pollers) against the new endpoint, which
 * recovers whatever the failed request was trying to do.
 */
function installFetchWrapper(): void {
    if (originalFetch !== null) return // already installed
    originalFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = async function rateLimitedFetch(
        input: RequestInfo | URL,
        init?: RequestInit,
    ): Promise<Response> {
        await globalRateLimiter.acquire()

        const url = fetchInputUrl(input)
        let response: Response
        try {
            response = await originalFetch!(input, init)
        } catch (err) {
            // fetch rejected without a readable response. When the server's
            // rate limiter answers 429 without CORS headers, the browser
            // reports exactly this — a streak of them escalates into failover.
            registerOpaqueNetworkFailure(url)
            throw err
        }

        if (response.status === 429 || response.status === 503) {
            handleThrottleResponse(response.status, response.headers.get('retry-after'), url)
        } else {
            registerNetworkSuccess(url)
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
 * The unwrapped `fetch` — bypasses the rate limiter and all throttle
 * tracking. Used by the RPC failover probes, which must run while the
 * limiter is paused and must not feed the opaque-failure counters.
 */
export function getRawFetch(): typeof globalThis.fetch {
    return originalFetch ?? globalThis.fetch.bind(globalThis)
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
