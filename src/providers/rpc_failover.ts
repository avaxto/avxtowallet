/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Public RPC endpoint failover for the Avalanche network APIs.
 *
 * api.avax.network rate-limits aggressively: Cloudflare returns HTTP 429
 * without CORS headers and penalty-boxes the client IP for up to an hour.
 * Instead of hard-blocking the app on the first penalty, this module rotates
 * through verified public RPC providers. Only when every endpoint has failed
 * in this session does the global hard block (and its modal) engage.
 *
 * Session semantics:
 *  - The active endpoints live in module-global state: once a working RPC is
 *    found it is used by default for the rest of the session.
 *  - A host that returned 429 (or failed opaquely) is marked dead for the
 *    session and never attempted again.
 *
 * Endpoint capabilities (verified live on 2026-07-02 with eth_chainId,
 * avm.getHeight and platform.getHeight; all send
 * `access-control-allow-origin: *`):
 *  - PublicNode and OnFinality serve the X/P/C node APIs by path.
 *  - dRPC and 1RPC are C-chain EVM only.
 *  - /ext/info and /ext/bc/C/avax exist ONLY on the official endpoint, so on
 *    a fallback those calls fail (degraded: no pending-import detection).
 *    Core balance and send flows keep working.
 */
import { ava } from '@/AVA'
import { web3, FetchHttpProvider } from '@/evm'
import { getRawFetch } from '@/providers/rate_limiter'

export interface RpcEndpoint {
    name: string
    /**
     * Base URL serving the node APIs (/ext/bc/X, /ext/bc/P, /ext/bc/C/rpc).
     * Null for EVM-only providers.
     */
    nodeApiBase: string | null
    /** Full URL of the C-chain EVM JSON-RPC endpoint. */
    evmRpcUrl: string
}

export const MAINNET_RPC_ENDPOINTS: RpcEndpoint[] = [
    {
        name: 'Avalanche Official',
        nodeApiBase: 'https://api.avax.network',
        evmRpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    },
    {
        name: 'PublicNode',
        nodeApiBase: 'https://avalanche-c-chain-rpc.publicnode.com',
        evmRpcUrl: 'https://avalanche-c-chain-rpc.publicnode.com/ext/bc/C/rpc',
    },
    {
        name: 'OnFinality',
        nodeApiBase: 'https://avalanche.api.onfinality.io/public',
        evmRpcUrl: 'https://avalanche.api.onfinality.io/public/ext/bc/C/rpc',
    },
    {
        name: 'dRPC',
        nodeApiBase: null,
        evmRpcUrl: 'https://avalanche.drpc.org',
    },
    {
        name: '1RPC',
        nodeApiBase: null,
        evmRpcUrl: 'https://1rpc.io/avax/c',
    },
]

export const FUJI_RPC_ENDPOINTS: RpcEndpoint[] = [
    {
        name: 'Avalanche Official (Fuji)',
        nodeApiBase: 'https://api.avax-test.network',
        evmRpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    },
    {
        name: 'PublicNode (Fuji)',
        nodeApiBase: 'https://avalanche-fuji-c-chain-rpc.publicnode.com',
        evmRpcUrl: 'https://avalanche-fuji-c-chain-rpc.publicnode.com/ext/bc/C/rpc',
    },
]

const PROBE_TIMEOUT_MS = 8_000

// ── Session state ────────────────────────────────────────────────────────────

/** Hosts that returned 429 / failed this session — never attempted again. */
const deadHosts = new Set<string>()

/** The endpoints currently in use (null = the network's own defaults). */
let activeEvmEndpoint: RpcEndpoint | null = null
let activeNodeEndpoint: RpcEndpoint | null = null

/** Serialize concurrent escalations into one failover run. */
let failoverPromise: Promise<boolean> | null = null

/** Reset all failover state — call when the user switches networks. */
export function resetRpcFailover(): void {
    deadHosts.clear()
    activeEvmEndpoint = null
    activeNodeEndpoint = null
    failoverPromise = null
}

/**
 * Node API base URL to use right now. Pollers and other node-API callers pass
 * their default (the selected network's URL) and get the failover override
 * when one is active.
 */
export function getNodeApiBase(defaultBase: string): string {
    return activeNodeEndpoint?.nodeApiBase ?? defaultBase
}

/** Name of the fallback provider currently in use, if any (for UI/status). */
export function getActiveFallbackName(): string | null {
    return activeEvmEndpoint?.name ?? activeNodeEndpoint?.name ?? null
}

/**
 * Rewrite a request URL that failed against a now-dead host to the endpoint
 * currently active for its track (EVM RPC vs node X/P/C/info API),
 * preserving the request's own path. Called by the rate limiter's fetch
 * wrapper to retry a failed request transparently once failover succeeds —
 * without this, a caller like setNetwork() would still see its ORIGINAL
 * request fail even though the very next request would have succeeded.
 *
 * Returns null if the URL isn't a known/current RPC host, or the relevant
 * track hasn't (yet) switched away from that host.
 */
export function rewriteUrlForActiveEndpoint(failedUrl: string): string | null {
    const endpoints = endpointsForNetwork()
    if (!endpoints) return null

    let parsed: URL
    try {
        parsed = new URL(failedUrl)
    } catch {
        return null
    }

    const knownHost =
        endpoints.some((e) => hostOf(e.evmRpcUrl) === parsed.host) ||
        endpoints.some((e) => e.nodeApiBase && hostOf(e.nodeApiBase) === parsed.host) ||
        isCurrentAvaHost(parsed.host)
    if (!knownHost) return null

    // The EVM RPC path is always exactly "/ext/bc/C/rpc" against the
    // official node, or the provider's bare root for single-purpose EVM
    // endpoints — use the PATH (not the host) to tell EVM calls apart from
    // node-API calls, since the official endpoint serves both from the same
    // host.
    const isEvmPath = parsed.pathname === '/ext/bc/C/rpc' || parsed.pathname === '/' || parsed.pathname === ''

    if (isEvmPath) {
        if (activeEvmEndpoint && hostOf(activeEvmEndpoint.evmRpcUrl) !== parsed.host) {
            return activeEvmEndpoint.evmRpcUrl
        }
        return null
    }

    if (activeNodeEndpoint?.nodeApiBase && hostOf(activeNodeEndpoint.nodeApiBase) !== parsed.host) {
        const extIdx = parsed.pathname.indexOf('/ext/')
        const suffix = extIdx >= 0 ? parsed.pathname.slice(extIdx) : parsed.pathname
        return `${activeNodeEndpoint.nodeApiBase}${suffix}${parsed.search}`
    }
    return null
}

// ── Internals ────────────────────────────────────────────────────────────────

function hostOf(url: string): string | null {
    try {
        return new URL(url).host
    } catch {
        return null
    }
}

function isCurrentAvaHost(host: string): boolean {
    try {
        return new URL(`${ava.getProtocol()}://${ava.getHost()}:${ava.getPort()}`).host === host
    } catch {
        return false
    }
}

function endpointsForNetwork(): RpcEndpoint[] | null {
    const netID = ava.getNetworkID()
    if (netID === 1) return MAINNET_RPC_ENDPOINTS
    if (netID === 5) return FUJI_RPC_ENDPOINTS
    // Custom/local networks have no public fallbacks.
    return null
}

function isAlive(e: RpcEndpoint): boolean {
    const evmHost = hostOf(e.evmRpcUrl)
    if (!evmHost || deadHosts.has(evmHost)) return false
    if (e.nodeApiBase) {
        const nodeHost = hostOf(e.nodeApiBase)
        if (nodeHost && deadHosts.has(nodeHost)) return false
    }
    return true
}

async function rpcProbe(url: string, body: object): Promise<any | null> {
    // Raw (unwrapped) fetch: the limiter may be paused during failover, and
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

async function probeEvm(e: RpcEndpoint): Promise<boolean> {
    const expected = ava.getNetworkID() === 5 ? '0xa869' : '0xa86a'
    const json = await rpcProbe(e.evmRpcUrl, {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
    })
    return json?.result === expected
}

async function probeNode(e: RpcEndpoint): Promise<boolean> {
    if (!e.nodeApiBase) return false
    const json = await rpcProbe(`${e.nodeApiBase}/ext/bc/X`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'avm.getHeight',
        params: {},
    })
    return !!json?.result?.height
}

function applyEvmEndpoint(e: RpcEndpoint): void {
    web3.setProvider(new FetchHttpProvider(e.evmRpcUrl) as any)
    activeEvmEndpoint = e
    console.warn(`[RpcFailover] C-chain EVM RPC switched to ${e.name} (${e.evmRpcUrl})`)
}

function applyNodeEndpoint(e: RpcEndpoint): void {
    if (!e.nodeApiBase) return
    const u = new URL(e.nodeApiBase)
    const port = u.port ? parseInt(u.port) : u.protocol === 'https:' ? 443 : 80
    const basePath = u.pathname !== '/' ? u.pathname : ''
    ava.setAddress(u.hostname, port, u.protocol.replace(':', ''), basePath)
    // The official endpoint reflects the specific Origin + sets
    // Access-Control-Allow-Credentials: true, so setNetwork() enables
    // withCredentials on the shared `ava` singleton. Public fallback
    // providers send Access-Control-Allow-Origin: * instead — a combination
    // browsers reject outright for credentialed requests — so every
    // avm/pChain/cChain/info call would fail with a CORS error unless this
    // is cleared here.
    ava.removeRequestConfig('withCredentials')
    activeNodeEndpoint = e
    console.warn(`[RpcFailover] Node API (X/P/C) switched to ${e.name} (${e.nodeApiBase})`)
}

async function notifyStatusBar(message: string): Promise<void> {
    try {
        const { pinia, useStatusBarStore } = await import('@/stores')
        useStatusBarStore(pinia).success(message)
    } catch {
        // Status bar is cosmetic — never fail the failover over it.
    }
}

/**
 * Called by the rate limiter when `failedUrl` was throttled (HTTP 429, or the
 * CORS-hidden equivalent). Marks the host dead for the session and moves the
 * affected API track(s) to the next live public endpoint.
 *
 * Returns true if a working endpoint was found (do NOT block), false when the
 * list is exhausted or failover doesn't apply (caller applies the block).
 */
export async function tryEndpointFailover(failedUrl: string | undefined): Promise<boolean> {
    const endpoints = endpointsForNetwork()
    if (!endpoints || !failedUrl) return false

    const failedHost = hostOf(failedUrl)
    if (!failedHost) return false

    // Only handle hosts we can actually replace: known endpoints or whatever
    // the app is currently pointed at. Anything else (e.g. Glacier) has no
    // fallback — the caller decides.
    const knownHosts = new Set<string>()
    for (const e of endpoints) {
        const h1 = hostOf(e.evmRpcUrl)
        if (h1) knownHosts.add(h1)
        if (e.nodeApiBase) {
            const h2 = hostOf(e.nodeApiBase)
            if (h2) knownHosts.add(h2)
        }
    }
    if (!knownHosts.has(failedHost) && !isCurrentAvaHost(failedHost)) return false

    deadHosts.add(failedHost)

    // One failover run at a time; concurrent escalations await the same result.
    if (!failoverPromise) {
        failoverPromise = runFailover().finally(() => {
            failoverPromise = null
        })
    }
    return failoverPromise
}

async function runFailover(): Promise<boolean> {
    const endpoints = endpointsForNetwork()
    if (!endpoints) return false

    // EVM track: any endpoint. Node track: only full node API endpoints.
    let evmOk = activeEvmEndpoint !== null && isAlive(activeEvmEndpoint)
    let nodeOk = activeNodeEndpoint !== null && isAlive(activeNodeEndpoint)

    // The default (pre-failover) endpoints count as the current selection.
    // If we're here, at least one track's current host is dead — re-point
    // every track whose current selection is dead or unset.
    for (const e of endpoints) {
        if (!evmOk && isAlive(e)) {
            if (await probeEvm(e)) {
                applyEvmEndpoint(e)
                evmOk = true
            } else {
                const h = hostOf(e.evmRpcUrl)
                if (h) deadHosts.add(h)
            }
        }
        if (!nodeOk && e.nodeApiBase && isAlive(e)) {
            if (await probeNode(e)) {
                applyNodeEndpoint(e)
                nodeOk = true
            } else {
                const h = hostOf(e.nodeApiBase)
                if (h) deadHosts.add(h)
            }
        }
        if (evmOk && nodeOk) break
    }

    if (evmOk && nodeOk) {
        const name = getActiveFallbackName()
        if (name) {
            void notifyStatusBar(`Primary RPC rate limited — switched to backup endpoint: ${name}`)
            // Reflect the new endpoint in useNetworkStore's selectedNetwork so
            // the UI (network menu, etc.) shows what's actually in use, and
            // re-affirm the store's connection status.
            applyFailoverToNetworkStore(name, activeNodeEndpoint?.nodeApiBase)
        }
        return true
    }

    console.warn('[RpcFailover] All public RPC endpoints exhausted for this session.')
    return false
}

async function applyFailoverToNetworkStore(providerName: string, nodeApiUrl?: string): Promise<void> {
    try {
        const { pinia, useNetworkStore } = await import('@/stores')
        useNetworkStore(pinia).applyFailoverEndpoint({ providerName, nodeApiUrl })
    } catch (e) {
        console.warn('[RpcFailover] Failed to update networkStore with the failover endpoint:', e)
    }
}
