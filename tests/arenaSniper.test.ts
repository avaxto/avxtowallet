/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The ArenaTrade sniper feed, against real TokenManager logs captured from
 * C-Chain (tests/fixtures/arena): three launches and every curve trade on
 * them. Replayed through a fake RPC, so what is pinned is the decoding, the
 * per-token grouping across 50,000-block chunks (a trade can be scanned
 * before its launch), the incremental refresh and the sorting.
 */
import Web3 from 'web3'

import { BN } from '@/avalanche'
import {
    ArenaSniperFeed,
    LOG_CHUNK_BLOCKS,
    decodeManagerLog,
    sortSniperTokens,
    type SniperToken,
} from '@/js/ArenaSniper'

import fixture from './fixtures/arena/manager-logs.json'

const abi = new Web3().eth.abi
const blockOf = (l: any) => parseInt(l.blockNumber, 16)
const maxBlock = Math.max(...fixture.logs.map(blockOf))

/** A web3 on a fake C-Chain holding `logs`, recording every getLogs range. */
function fakeChain(logs: any[], head: { n: number }) {
    const ranges: [number, number][] = []
    const provider = {
        send(payload: any, cb: (e: any, r?: any) => void) {
            const reply = (result: any) => cb(null, { jsonrpc: '2.0', id: payload.id, result })
            const [p0] = payload.params ?? []
            switch (payload.method) {
                case 'eth_blockNumber':
                    return reply('0x' + head.n.toString(16))
                case 'eth_getLogs': {
                    const from = parseInt(p0.fromBlock, 16)
                    const to = p0.toBlock === 'latest' ? head.n : parseInt(p0.toBlock, 16)
                    ranges.push([from, to])
                    // Copies: web3's log formatter rewrites the objects it is handed
                    // (hex blockNumber -> number), which would corrupt the fixture.
                    return reply(
                        logs
                            .filter((l) => blockOf(l) >= from && blockOf(l) <= to)
                            .map((l) => JSON.parse(JSON.stringify(l)))
                    )
                }
                case 'eth_getBlockByNumber':
                    // Timestamp = block number, so ages are checkable.
                    return reply({ number: p0, timestamp: p0, transactions: [] })
                case 'eth_call': {
                    const sel = String(p0.data).slice(0, 10)
                    const tag = String(p0.to).slice(2, 8).toUpperCase()
                    if (sel === '0x06fdde03') return reply(abi.encodeParameter('string', `Token ${tag}`))
                    if (sel === '0x95d89b41') return reply(abi.encodeParameter('string', tag))
                    return reply('0x')
                }
            }
            reply(null)
        },
    }
    return { web3: new Web3(provider as any), ranges }
}

const byId = (list: SniperToken[]) => Object.fromEntries(list.map((t) => [t.tokenId, t]))

describe('decodeManagerLog', () => {
    it('decodes the launches and trades in real TokenManager logs', () => {
        const decoded = fixture.logs.map((l) => decodeManagerLog(l as any)!)
        expect(decoded.every(Boolean)).toBe(true)

        const created = decoded.filter((d) => d.event === 'TokenCreated') as any[]
        expect(created.map((c) => c.tokenId)).toEqual(fixture.tokenIds)
        expect(created[0].token).toMatch(/^0x[0-9a-f]{40}$/)

        const buys = decoded.filter((d) => d.event === 'Buy' && d.tokenId === '113457')
        const sells = decoded.filter((d) => d.event === 'Sell' && d.tokenId === '113457')
        expect([buys.length, sells.length]).toEqual([10, 9])
        expect((buys[0] as any).avax.gtn(0)).toBe(true)
    })

    it('ignores logs that are not TokenManager events', () => {
        expect(decodeManagerLog({ topics: ['0x' + '00'.repeat(32)], data: '0x', blockNumber: 1 })).toBeNull()
    })
})

describe('ArenaSniperFeed', () => {
    it('finds the newest launches and counts every curve trade on each', async () => {
        const head = { n: maxBlock + 10 }
        const { web3, ranges } = fakeChain(fixture.logs, head)
        const list = await new ArenaSniperFeed(web3).loadNewest(3)

        expect(list.map((t) => t.tokenId)).toEqual(['113458', '113457', '113456']) // newest first
        const t = byId(list)
        expect([t['113456'].buys, t['113456'].sells]).toEqual([5, 2])
        expect([t['113457'].buys, t['113457'].sells]).toEqual([10, 9])
        expect([t['113458'].buys, t['113458'].sells]).toEqual([5, 2])

        // Named from the token contracts, dated from the launch block.
        expect(t['113457'].symbol).toBe(t['113457'].address.slice(2, 8).toUpperCase())
        expect(t['113457'].createdAt).toBe(t['113457'].createdBlock)

        // Every scanned range respects the RPC's 50,000-block cap.
        expect(ranges.every(([f, to]) => to - f + 1 <= LOG_CHUNK_BLOCKS)).toBe(true)
    })

    it('keeps the volume a sum of AVAX in and out on the curve', async () => {
        const { web3 } = fakeChain(fixture.logs, { n: maxBlock + 10 })
        const t = byId(await new ArenaSniperFeed(web3).loadNewest(3))

        let expected = new BN(0)
        for (const l of fixture.logs) {
            const d = decodeManagerLog(l as any) as any
            if (d.tokenId === '113457' && (d.event === 'Buy' || d.event === 'Sell')) expected = expected.add(d.avax)
        }
        expect(t['113457'].volumeWei.eq(expected)).toBe(true)
    })

    it('returns only as many launches as asked for', async () => {
        const { web3 } = fakeChain(fixture.logs, { n: maxBlock + 10 })
        const list = await new ArenaSniperFeed(web3).loadNewest(2)
        expect(list.map((t) => t.tokenId)).toEqual(['113458', '113457'])
    })

    it('refreshes by reading only the blocks it has not seen', async () => {
        const head = { n: maxBlock + 10 }
        const logs = [...fixture.logs]
        const { web3, ranges } = fakeChain(logs, head)
        const feed = new ArenaSniperFeed(web3)
        await feed.loadNewest(3)
        const before = byId(feed.list())['113458'].buys

        // One more buy of 113458 lands in a new block.
        const aBuy = fixture.logs.find((l) => {
            const d = decodeManagerLog(l as any) as any
            return d.event === 'Buy' && d.tokenId === '113458'
        })!
        head.n += 20
        logs.push({ ...aBuy, blockNumber: '0x' + (head.n - 5).toString(16), logIndex: '0x0' })
        ranges.length = 0

        const t = byId(await feed.refresh())['113458']
        expect(t.buys).toBe(before + 1)
        expect(ranges).toEqual([[maxBlock + 11, head.n]])
    })
})

describe('sortSniperTokens', () => {
    const tok = (id: string, block: number, buys: number, sells: number, vol: number): SniperToken => ({
        tokenId: id,
        address: '0x' + id.padStart(40, '0'),
        name: id,
        symbol: id,
        creator: '0x0',
        createdAt: block,
        createdBlock: block,
        buys,
        sells,
        volumeWei: new BN(vol),
        graduated: false,
    })
    const list = [tok('old-busy', 1, 40, 10, 5), tok('new-quiet', 3, 1, 0, 1), tok('mid-rich', 2, 3, 2, 900)]

    it('sorts by age, newest first', () => {
        expect(sortSniperTokens(list, 'age').map((t) => t.tokenId)).toEqual(['new-quiet', 'mid-rich', 'old-busy'])
    })

    it('sorts by transactions, most first, counting buys and sells', () => {
        expect(sortSniperTokens(list, 'transactions').map((t) => t.tokenId)).toEqual([
            'old-busy',
            'mid-rich',
            'new-quiet',
        ])
    })

    it('sorts by volume, largest first', () => {
        expect(sortSniperTokens(list, 'volume').map((t) => t.tokenId)).toEqual(['mid-rich', 'old-busy', 'new-quiet'])
    })

    it('does not reorder the list it was given', () => {
        sortSniperTokens(list, 'volume')
        expect(list[0].tokenId).toBe('old-busy')
    })
})
