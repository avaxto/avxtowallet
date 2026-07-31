/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Public RPC endpoint failover.
 *
 * api.avax.network rate-limits aggressively: Cloudflare returns HTTP 429
 * without CORS headers and penalty-boxes the client IP for up to an hour.
 * Instead of hard-blocking the app on the first penalty, this module switches
 * to the next public backup network. Only when every candidate has failed in
 * this session does the global hard block (and its modal) engage.
 *
 * The candidate pool IS networkStore.allNetworks: every registered network
 * with the same networkId as the current one (built-in official + public
 * backup providers + any custom networks the user added) is a failover
 * candidate. A switch goes through networkStore.setNetwork(net, true) — a
 * full reconnect, exactly as if the user had picked that network by hand
 * (balances, history, pollers, SDK all refresh), except the session's
 * dead-host list is kept and the fallback is not persisted as the user's
 * saved network choice.
 *
 * Session semantics:
 *  - A host that returned 429 (or failed opaquely) is marked dead for the
 *    session and never attempted again.
 *  - The switched-to network stays selected for the rest of the session
 *    (or until it, too, gets throttled).
 *
 * Capability note (live-verified 2026-07-03): the public backup providers
 * serve /ext/bc/X, /ext/bc/P and /ext/bc/C/rpc but NOT /ext/info or
 * /ext/bc/C/avax — setNetwork uses compile-time constants for those on
 * known networks, and pending-import detection degrades gracefully.
 */
import { AvaNetwork } from '@/js/AvaNetwork'
import { getRawFetch, globalRateLimiter } from '@/providers/rate_limiter'

const PROBE_TIMEOUT_MS = 8_000

// ── Session state ────────────────────────────────────────────────────────────

/** Hosts that returned 429 / failed this session — never attempted again. */
const deadHosts = new Set<string>()

/** Serialize concurrent escalations into one failover run. */
let failoverPromise: Promise<boolean> | null = null

/** Reset all failover state — called when the USER switches networks. */
export function resetRpcFailover(): void {
    deadHosts.clear()
    failoverPromise = null
}

// ── Internals ────────────────────────────────────────────────────────────────

function hostOf(url: string): string | null {
    try {
        return new URL(url).host
    } catch {
        return null
    }
}

function networkHost(net: AvaNetwork): string | null {
    return hostOf(net.getFullURL())
}

async function rpcProbe(url: string, body: object): Promise<any | null> {
    // Raw (unwrapped) fetch: the limiter is paused during failover, and
    // probe failures must not feed the opaque-failure counters.
    const rawFetch = getRawFetch()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
        const res = await rawFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
        if (!res.ok) return null
        return await res.json()
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** A candidate must serve both the X-chain node API and the C-chain EVM RPC. */
async function probeNetwork(net: AvaNetwork): Promise<boolean> {
    const base = net.getFullURL()

    const xJson = await rpcProbe(`${base}/ext/bc/X`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'avm.getHeight',
        params: {},
    })
    if (!xJson?.result?.height) return false

    const cJson = await rpcProbe(`${base}/ext/bc/C/rpc`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
    })
    if (!cJson?.result) return false

    // Enforce the EVM chain id on the known public networks; custom
    // networks may legitimately use other ids.
    if (net.networkId === 1 && cJson.result !== '0xa86a') return false
    if (net.networkId === 5 && cJson.result !== '0xa869') return false

    return true
}

async function notify(message: string, type: 'warning' | 'success'): Promise<void> {
    try {
        const { pinia, useNotificationsStore } = await import('@/stores')
        useNotificationsStore(pinia).add({ title: 'RPC Failover', message, type })
    } catch {
        // Notification is cosmetic — never fail the failover over it.
    }
}

/**
 * Called by the rate limiter when `failedUrl` was throttled (HTTP 429, or the
 * CORS-hidden equivalent). Marks the host dead for the session and switches
 * to the next live network from networkStore.allNetworks via a full
 * setNetwork() reconnect.
 *
 * Returns true if a working network was connected (do NOT block), false when
 * every candidate is exhausted (caller applies the hard block).
 */
export async function tryEndpointFailover(failedUrl: string | undefined): Promise<boolean> {
    if (!failedUrl) return false
    const failedHost = hostOf(failedUrl)
    if (!failedHost) return false

    const { pinia, useNetworkStore } = await import('@/stores')
    const networkStore = useNetworkStore(pinia)

    const current: AvaNetwork | null = networkStore.selectedNetwork
    if (!current) return false

    // Candidates: every registered network on the SAME network id, in
    // registration order (official endpoints first, then public backups,
    // then the user's custom networks).
    const candidates: AvaNetwork[] = networkStore.allNetworks.filter(
        (n: AvaNetwork) => n.networkId === current.networkId
    )

    // Only handle hosts we can actually replace: one of the candidate
    // networks. Anything else (e.g. Glacier) has no fallback — the caller
    // decides what to do.
    const knownHosts = new Set<string>()
    for (const n of candidates) {
        const h = networkHost(n)
        if (h) knownHosts.add(h)
    }
    if (!knownHosts.has(failedHost)) return false

    deadHosts.add(failedHost)

    // One failover run at a time; concurrent escalations await the same result.
    if (!failoverPromise) {
        failoverPromise = runFailover(networkStore, candidates).finally(() => {
            failoverPromise = null
        })
    }
    return failoverPromise
}

async function runFailover(
    networkStore: { selectedNetwork: AvaNetwork | null; setNetwork: (n: AvaNetwork, isFailover?: boolean) => Promise<boolean | undefined> },
    candidates: AvaNetwork[]
): Promise<boolean> {
    // Already on a live host? Then a stale/queued request to a previously
    // dead host triggered this escalation — nothing to do.
    const current = networkStore.selectedNetwork
    const currentHost = current ? networkHost(current) : null
    if (currentHost && !deadHosts.has(currentHost)) {
        return true
    }

    for (const net of candidates) {
        const host = networkHost(net)
        if (!host || deadHosts.has(host)) continue

        // Verify the candidate actually works (raw fetch, limiter-exempt)
        // before committing to it.
        if (!(await probeNetwork(net))) {
            deadHosts.add(host)
            continue
        }

        void notify(`Primary RPC rate limited — switching to ${net.name}.`, 'warning')

        // The limiter was paused when escalation started. setNetwork()'s
        // reconnect traffic runs through the wrapped fetch/axios, so the
        // limiter MUST be flowing again before the switch or every one of
        // those requests would queue behind the pause forever (deadlock).
        globalRateLimiter.resume()

        try {
            // Full reconnect, as if the user had picked this network.
            // isFailover=true keeps the session's dead-host list and does
            // not persist the fallback as the saved network choice.
            await networkStore.setNetwork(net, true)
            void notify(`Connected to ${net.name}.`, 'success')
            console.warn(`[RpcFailover] Switched network to ${net.name} (${net.getFullURL()})`)
            return true
        } catch (e) {
            console.warn(`[RpcFailover] setNetwork(${net.name}) failed:`, e)
            deadHosts.add(host)
        }
    }

    console.warn('[RpcFailover] All candidate networks exhausted for this session.')
    return false
}
