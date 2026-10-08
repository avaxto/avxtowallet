/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The bridge providers, and which of them are switched on.
 *
 * Every route the bridge page offers comes from asking each enabled provider
 * that `supports` the pair for a quote. Swapping Wormhole for another
 * provider is: implement `BridgeProvider`, add it to `PROVIDERS`, and switch
 * the old one off in Settings (or remove it here).
 */
import { ref } from 'vue'

import type { BridgeAsset, BridgeChain, BridgeProvider, BridgeQuote, BridgeQuoteRequest } from './types'
import { wormholeProvider } from './wormhole/provider'
import { thorchainProvider } from './thorchain/provider'
import { avalancheBridgeProvider } from './avalancheBridge/provider'
import { lombardProvider } from './lombard/provider'

const PROVIDERS: BridgeProvider[] = [avalancheBridgeProvider, lombardProvider, wormholeProvider, thorchainProvider]

const DISABLED_KEY = 'bridge_disabled_providers'

function readDisabled(): string[] {
    try {
        const raw = JSON.parse(localStorage.getItem(DISABLED_KEY) ?? '[]')
        return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
    } catch {
        return []
    }
}

/** Ids of providers the user switched off. Reactive for the settings page. */
export const disabledProviders = ref<string[]>(readDisabled())

export function listProviders(): BridgeProvider[] {
    return PROVIDERS
}

export function getProvider(id: string): BridgeProvider | undefined {
    return PROVIDERS.find((p) => p.id === id)
}

export function isProviderEnabled(id: string): boolean {
    return !disabledProviders.value.includes(id)
}

export function setProviderEnabled(id: string, enabled: boolean): void {
    const next = disabledProviders.value.filter((x) => x !== id)
    if (!enabled) next.push(id)
    disabledProviders.value = next
    try {
        localStorage.setItem(DISABLED_KEY, JSON.stringify(next))
    } catch {
        /* not remembered; applies for this session */
    }
}

/** Enabled providers that can move `from` to `toChain`. */
export function providersFor(from: BridgeAsset, toChain: BridgeChain): BridgeProvider[] {
    if (from.chainId === toChain.id) return []
    const serving = PROVIDERS.filter((p) => isProviderEnabled(p.id) && p.supports(from, toChain))
    // A provider that supersedes another for this pair takes its place (only while it is enabled).
    const replaced = new Set(serving.flatMap((p) => p.supersedes ?? []))
    return serving.filter((p) => !replaced.has(p.id))
}

export interface QuoteResults {
    quotes: BridgeQuote[]
    /** Providers that support the pair but could not quote it, and why. */
    errors: { providerId: string; providerName: string; message: string }[]
}

/**
 * Asks every enabled provider that supports the pair, in parallel. One
 * provider failing never hides another's quote. Quotes come back best first:
 * most received, then soonest.
 */
export async function quoteAll(req: BridgeQuoteRequest): Promise<QuoteResults> {
    const providers = providersFor(req.from, req.toChain)
    const settled = await Promise.allSettled(providers.map((p) => p.quote(req)))
    const quotes: BridgeQuote[] = []
    const errors: QuoteResults['errors'] = []
    settled.forEach((r, i) => {
        if (r.status === 'fulfilled') quotes.push(r.value)
        else
            errors.push({
                providerId: providers[i].id,
                providerName: providers[i].name,
                message: r.reason instanceof Error ? r.reason.message : String(r.reason),
            })
    })
    quotes.sort((a, b) => {
        // Compare received amounts only when the same asset arrives; otherwise keep provider order.
        const sameAsset =
            a.receive.asset.address.toLowerCase() === b.receive.asset.address.toLowerCase() &&
            a.receive.asset.decimals === b.receive.asset.decimals
        if (sameAsset && a.receive.amount !== b.receive.amount) return a.receive.amount > b.receive.amount ? -1 : 1
        return a.etaSeconds - b.etaSeconds
    })
    return { quotes, errors }
}
