/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { summarizeTransfers, DEAD_ADDRESS, ZERO_ADDRESS, type ActivityTransfer } from '@/js/avxtoActivity'

const E18 = (n: number) => `${n}000000000000000000`
const NOW = 2_000_000_000
const MOATS = '0xebe5fbacb882fd313d05684bef591c31f83b0524'
const A = '0xaaaa000000000000000000000000000000000001'
const B = '0xbbbb000000000000000000000000000000000002'
const C = '0xcccc000000000000000000000000000000000003'

let n = 0
const t = (from: string, to: string, amount: number, agoSec: number, tx?: string): ActivityTransfer => ({
    txHash: tx ?? `0x${++n}`,
    logIndex: n,
    blockTimestamp: NOW - agoSec,
    from: { address: from },
    to: { address: to },
    value: E18(amount),
})

describe('summarizeTransfers', () => {
    const transfers = [
        t(A, B, 100, 60),
        t(A, MOATS, 1000, 3_600, '0xburn'),
        t(MOATS, DEAD_ADDRESS, 1000, 3_600, '0xburn'), // same tx: Moats forwards the burn
        t(B, C, 50, 2 * 86_400),
        t(ZERO_ADDRESS, A, 5000, 3 * 86_400),
    ]
    const s = summarizeTransfers(transfers, { nowSec: NOW, decimals: 18, moatsAddress: MOATS, topN: 3 })

    it('counts transfers, transactions and volume over the window', () => {
        expect(s.transfers).toBe(5)
        expect(s.transactions).toBe(4)
        expect(s.volume).toBe(100 + 1000 + 1000 + 50 + 5000)
        expect(s.windowStart).toBe(NOW - 3 * 86_400)
        expect(s.windowEnd).toBe(NOW - 60)
    })

    it('separates the last 24 hours, burns, mints and flows into Moats', () => {
        expect(s.last24h).toEqual({ transfers: 3, volume: 2100 })
        expect(s.burned).toEqual({ transfers: 1, volume: 1000 })
        expect(s.minted).toEqual({ transfers: 1, volume: 5000 })
        expect(s.toMoats).toEqual({ transfers: 1, volume: 1000 })
    })

    it('finds the largest transfer and the most active addresses, ignoring burn/mint addresses', () => {
        expect(s.largest?.value).toBe(E18(5000))
        // A: 3 transfers, Moats: 2, B: 2 (B moved less than Moats).
        expect(s.mostActive.map((a) => a.address)).toEqual([A, MOATS, B])
        expect(s.uniqueAddresses).toBe(4) // A, B, C, Moats
    })

    it('handles an empty window', () => {
        const e = summarizeTransfers([], { nowSec: NOW, decimals: 18 })
        expect(e.transfers).toBe(0)
        expect(e.largest).toBeNull()
        expect(e.mostActive).toEqual([])
    })
})
