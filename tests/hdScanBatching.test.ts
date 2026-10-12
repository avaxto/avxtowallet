/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * HD address scanning asks for as many addresses per API call as each API
 * accepts — 1024 per node call, 64 per Glacier call — and never bursts
 * Glacier with parallel calls, so opening a wallet with many used addresses
 * no longer gets the IP rate-limited. Runs the real HdHelper with only the
 * network calls replaced.
 */
import HDKey from 'hdkey'

const net = { explorerUrl: '' as string | undefined }
jest.mock('@/stores', () => ({ pinia: {}, useNetworkStore: () => ({ selectedNetwork: { explorerUrl: net.explorerUrl } }) }))

const used = new Set<string>()
const utxoCalls: number[] = []
jest.mock('@/helpers/utxo_helper', () => {
    const fakeSet = (addrs: string[]) => {
        const { bintools } = jest.requireActual('@/AVA')
        const hits = addrs.filter((a) => used.has(a))
        const hitHex = new Set(hits.map((a) => bintools.parseAddress(a, a[0]).toString('hex')))
        const set: any = {
            hits,
            getUTXOIDs: (bufs: any[]) => (bufs.some((b) => hitHex.has(Buffer.from(b).toString('hex'))) ? ['utxo'] : []),
            getAllUTXOs: () => hits,
            merge: (o: any) => fakeSet(addrs.concat(o.hits)),
        }
        return set
    }
    const get = async (addrs: string[]) => {
        utxoCalls.push(addrs.length)
        return fakeSet(addrs)
    }
    return { avmGetAllUTXOs: get, platformGetAllUTXOs: get, getStakeForAddresses: async () => 0 }
})
const glacierCalls: number[] = []
let glacierInFlight = 0
let glacierMaxInFlight = 0
jest.mock('@/js/Glacier/listChainsForAddresses', () => ({
    listChainsForAddresses: async (addrs: string[]) => {
        glacierCalls.push(addrs.length)
        return addrs.filter((a) => used.has(a)).map((a) => ({ address: a.split('-')[1] }))
    },
}))
const glacierSdk = { calls: [] as number[] }
jest.mock('@/js/Glacier/Glacier', () => ({
    __esModule: true,
    default: {
        primaryNetwork: {
            getChainAddresses: async ({ addresses }: { addresses: string }) => {
                glacierInFlight++
                glacierMaxInFlight = Math.max(glacierMaxInFlight, glacierInFlight)
                glacierSdk.calls.push(addresses.split(',').length)
                await new Promise((r) => setTimeout(r, 5))
                glacierInFlight--
                return { addresses: [] }
            },
        },
    },
}))

import { HdHelper } from '@/js/HdHelper'
import { mapGlacierBatches } from '@/js/Glacier/utils'
import { GLACIER_MAX_ADDRESSES, NODE_MAX_UTXO_ADDRESSES } from '@/helpers/apiLimits'

const master = HDKey.fromMasterSeed(Buffer.alloc(32, 7)).derive("m/44'/9000'/0'")

function helper(): any {
    return new HdHelper('m/0', master, 'X', true)
}
/** Marks `indexes` of the helper's address space as used on chain. */
function markUsed(h: any, indexes: number[]): void {
    for (const i of indexes) used.add(h.getAddressForIndex(i))
}

beforeEach(() => {
    used.clear()
    utxoCalls.length = 0
    glacierCalls.length = 0
    glacierSdk.calls.length = 0
    glacierInFlight = 0
    glacierMaxInFlight = 0
    net.explorerUrl = ''
})

describe('limits', () => {
    it('uses the measured per-call maximums', () => {
        expect(NODE_MAX_UTXO_ADDRESSES).toBe(1024)
        expect(GLACIER_MAX_ADDRESSES).toBe(64)
    })

    it('runs Glacier batches at the 64-address maximum, two at a time, results in order', async () => {
        const addrs = Array.from({ length: 300 }, (_, i) => `a${i}`)
        let inFlight = 0
        let maxInFlight = 0
        const res = await mapGlacierBatches(addrs, async (batch) => {
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            await new Promise((r) => setTimeout(r, 5))
            inFlight--
            return batch.length
        })
        expect(res).toEqual([64, 64, 64, 64, 44])
        expect(maxInFlight).toBe(2)
    })

    it('makes listChainsForAddresses send 64 per call without a burst', async () => {
        const { listChainsForAddresses } = jest.requireActual('@/js/Glacier/listChainsForAddresses')
        await listChainsForAddresses(Array.from({ length: 512 }, (_, i) => `X-avax1addr${i}`))
        expect(glacierSdk.calls).toEqual(Array(8).fill(64))
        expect(glacierMaxInFlight).toBeLessThanOrEqual(2)
    })
})

describe('finding the HD index', () => {
    it('resolves a typical wallet with ONE node call of 1024 addresses', async () => {
        const h = helper()
        markUsed(h, [0, 1, 2, 5, 15])
        await h.findHdIndex()
        expect(utxoCalls).toEqual([1024])
        expect(h.hdIndex).toBe(16) // the first 20-address gap starts right after 15
        expect(glacierCalls).toEqual([])
    })

    it('a heavily used wallet on the node path scans in 1024-address calls', async () => {
        const h = helper()
        // Over 60% of the first 1024 used: the fast check falls through to the full node scan.
        markUsed(h, Array.from({ length: 1500 }, (_, i) => i))
        await h.findHdIndex()
        expect(utxoCalls.every((n) => n === 1024)).toBe(true)
        expect(utxoCalls.length).toBe(3) // fast check + 2 scan windows (0..1023, 1004..2027)
        expect(h.hdIndex).toBe(1500)
    })

    it('on the explorer path, walks Glacier one full 64-address batch at a time and stops at the gap', async () => {
        net.explorerUrl = 'https://explorer.example'
        const h = helper()
        markUsed(h, Array.from({ length: 700 }, (_, i) => i))
        await h.findHdIndex()
        expect(glacierCalls.every((n) => n === 64)).toBe(true)
        // 700 used + a 20-address gap: addresses 0..719 → 12 sequential calls, not dozens in parallel.
        expect(glacierCalls.length).toBe(12)
        expect(h.hdIndex).toBe(700)
    })

    it('finds a gap that straddles two Glacier batches', async () => {
        net.explorerUrl = 'https://explorer.example'
        const h = helper()
        markUsed(h, Array.from({ length: 700 }, (_, i) => i).concat([710]))
        await h.findHdIndex()
        expect(h.hdIndex).toBe(711)
    })
})

describe('refreshing balances', () => {
    it('reads UTXOs in 1024-address lots and stops after one empty lot', async () => {
        const h = helper()
        h.isInit = true
        markUsed(h, [3, 1100])
        await h.updateUtxos()
        expect(utxoCalls).toEqual([1024, 1024, 1024]) // lot 0 (used), lot 1 (used), lot 2 (empty → stop)
        expect(h.hdIndex).toBe(1101)
    })

    it('an empty wallet costs one call', async () => {
        const h = helper()
        h.isInit = true
        await h.updateUtxos()
        expect(utxoCalls).toEqual([1024])
    })
})
