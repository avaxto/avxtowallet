/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Statistics for the AVXTO activity page, computed from the token transfers it
 * already loads (see views/wallet/Avxto.vue). Pure, so it can be tested
 * without the network: the page does the fetching, this does the counting.
 *
 * Everything here describes the loaded window only — the page scans a bounded
 * block range and page count — which is why the window's own start and end are
 * part of the result, and the page shows them next to the figures.
 */
import Big from 'big.js'

export interface ActivityTransfer {
    txHash: string
    logIndex: number
    /** Unix seconds. */
    blockTimestamp: number
    from: { address: string; name?: string }
    to: { address: string; name?: string }
    /** Raw token units. */
    value: string
}

export interface AddressActivity {
    address: string
    name?: string
    transfers: number
    /** Whole tokens moved in or out. */
    volume: number
}

export interface ActivitySummary {
    transfers: number
    /** Unix seconds; 0 when there are no transfers. */
    windowStart: number
    windowEnd: number
    /** Whole tokens. */
    volume: number
    transactions: number
    uniqueAddresses: number
    largest: ActivityTransfer | null
    last24h: { transfers: number; volume: number }
    burned: { transfers: number; volume: number }
    minted: { transfers: number; volume: number }
    toMoats: { transfers: number; volume: number }
    mostActive: AddressActivity[]
}

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead'

const lower = (a: string | undefined) => String(a ?? '').toLowerCase()

export function summarizeTransfers(
    transfers: ActivityTransfer[],
    opts: { nowSec: number; decimals: number; moatsAddress?: string; topN?: number }
): ActivitySummary {
    const scale = new Big(10).pow(opts.decimals)
    const whole = (raw: string) => {
        try {
            return Number(new Big(raw).div(scale).toString())
        } catch {
            return 0
        }
    }
    const moats = lower(opts.moatsAddress)
    const dayAgo = opts.nowSec - 86_400

    const empty = () => ({ transfers: 0, volume: 0 })
    const summary: ActivitySummary = {
        transfers: transfers.length,
        windowStart: 0,
        windowEnd: 0,
        volume: 0,
        transactions: new Set(transfers.map((t) => t.txHash)).size,
        uniqueAddresses: 0,
        largest: null,
        last24h: empty(),
        burned: empty(),
        minted: empty(),
        toMoats: empty(),
        mostActive: [],
    }

    const byAddress = new Map<string, AddressActivity>()
    const touch = (party: { address: string; name?: string }, amount: number) => {
        const key = lower(party.address)
        if (!key || key === ZERO_ADDRESS || key === DEAD_ADDRESS) return
        const entry = byAddress.get(key) ?? { address: party.address, name: party.name, transfers: 0, volume: 0 }
        entry.transfers++
        entry.volume += amount
        byAddress.set(key, entry)
    }
    let largestAmount = -1

    for (const t of transfers) {
        const amount = whole(t.value)
        const from = lower(t.from?.address)
        const to = lower(t.to?.address)

        summary.volume += amount
        if (!summary.windowStart || t.blockTimestamp < summary.windowStart) summary.windowStart = t.blockTimestamp
        if (t.blockTimestamp > summary.windowEnd) summary.windowEnd = t.blockTimestamp
        if (amount > largestAmount) {
            largestAmount = amount
            summary.largest = t
        }
        if (t.blockTimestamp >= dayAgo) {
            summary.last24h.transfers++
            summary.last24h.volume += amount
        }
        if (to === DEAD_ADDRESS || to === ZERO_ADDRESS) {
            summary.burned.transfers++
            summary.burned.volume += amount
        }
        if (from === ZERO_ADDRESS) {
            summary.minted.transfers++
            summary.minted.volume += amount
        }
        if (moats && to === moats) {
            summary.toMoats.transfers++
            summary.toMoats.volume += amount
        }
        touch(t.from, amount)
        touch(t.to, amount)
    }

    summary.uniqueAddresses = byAddress.size
    summary.mostActive = Array.from(byAddress.values())
        .sort((a, b) => b.transfers - a.transfers || b.volume - a.volume)
        .slice(0, opts.topN ?? 5)
    return summary
}
