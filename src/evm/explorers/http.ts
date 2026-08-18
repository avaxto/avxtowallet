/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Shared HTTP for explorer adapters.
 *
 * Two things every adapter must do and none should reimplement:
 *
 *  - **Respect the per-host circuit breaker.** Explorers rate limit
 *    aggressively, and this layer fans out across many of them at once. A host
 *    that just returned 429 is skipped outright rather than hammered (see
 *    `isHostThrottled` in providers/rate_limiter).
 *  - **Time out.** A hung explorer must not hold the whole portfolio open;
 *    aggregation waits on every network, so one endpoint that never answers
 *    would stall the entire list.
 */
import { isHostThrottled } from '@/providers/rate_limiter'
import { ExplorerThrottledError } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

export { ExplorerThrottledError }

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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: controller.signal,
        })
        if (!res.ok) {
            throw new Error(`Explorer request failed: HTTP ${res.status}`)
        }
        return (await res.json()) as T
    } finally {
        clearTimeout(timer)
    }
}
