/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Shared HTTP for explorer adapters.
 *
 * Three things every adapter must do and none should reimplement:
 *
 *  - **Respect the per-host circuit breaker.** Explorers rate limit
 *    aggressively, and this layer fans out across many of them at once. A host
 *    that just returned 429 is skipped outright rather than hammered (see
 *    `isHostThrottled` in providers/rate_limiter).
 *  - **Time out.** A hung explorer must not hold the whole portfolio open;
 *    aggregation waits on every network, so one endpoint that never answers
 *    would stall the entire list.
 *  - **Absorb a transient 5xx.** Public Blockscout/Etherscan-family instances
 *    are free, unauthenticated and frequently overloaded — a burst of curl
 *    requests against `polygon.blockscout.com`'s v2 endpoint measured roughly
 *    every other request failing with a plain HTTP 500 for no
 *    address-specific reason, recovering on the very next attempt. A single
 *    blip of that kind should not be reported as "this network is down".
 */
import { isHostThrottled } from '@/providers/rate_limiter'
import { ExplorerThrottledError } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

// 429/503 are excluded on purpose — those already get dedicated handling from
// the global rate limiter (cooldown/failover, see providers/rate_limiter.ts)
// the moment the wrapped `fetch` below sees the response; retrying them here
// too would just be hammering a host that has already been told to back off.
// A 5xx outside that pair (500, 502, 504, 524 — the Cloudflare-gateway code
// seen against the same flaky host during investigation) has no other layer
// watching for it, so this is where a transient one gets absorbed.
const RETRYABLE_STATUSES = new Set([500, 502, 504, 524])
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = [300, 800]

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * GETs JSON from an explorer API.
 *
 * Deliberately goes through the global `fetch` (not a raw one) so these
 * requests stay inside the app's rate limiter — but note the limiter no longer
 * escalates a third-party 429 to a global block; it backs that host off
 * instead, which is what makes fanning out across explorers safe at all.
 */
export async function fetchExplorerJson<T>(
    url: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
    if (isHostThrottled(url)) {
        throw new ExplorerThrottledError(url)
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        // A prior attempt this call may itself have tripped the 429 cooldown
        // (the global fetch wrapper runs regardless of how many times we call
        // it) — stop retrying into a host that just asked to be left alone.
        if (attempt > 0 && isHostThrottled(url)) {
            throw new ExplorerThrottledError(url)
        }

        const isLastAttempt = attempt === MAX_ATTEMPTS - 1
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const res = await fetch(url, {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
            })
            if (res.ok) {
                return (await res.json()) as T
            }
            // Falling through (rather than returning/throwing) here means
            // "retry" — anything else throws immediately.
            if (isLastAttempt || !RETRYABLE_STATUSES.has(res.status)) {
                throw new Error(`Explorer request failed: HTTP ${res.status}`)
            }
        } finally {
            clearTimeout(timer)
        }

        // A timeout (AbortError) or any other fetch-level failure propagates
        // immediately, above — a hung endpoint is more likely to hang again
        // than a genuinely overloaded one is to recover within a second, so
        // retrying it would just double the wait before this network is
        // reported as failed. Only a retryable HTTP status reaches here.
        await sleep(RETRY_DELAY_MS[Math.min(attempt, RETRY_DELAY_MS.length - 1)])
    }

    // Unreachable: MAX_ATTEMPTS >= 1, so the loop always returns on success or
    // throws on the last attempt's failure. Kept for a well-typed return.
    throw new Error('Explorer request failed.')
}
