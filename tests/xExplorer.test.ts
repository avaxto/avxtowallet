/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /wallet/xexplorer: X-Chain addresses and transactions from Glacier, with
 * every detail it returns.
 */
import { flushPromises, mount } from '@vue/test-utils'

const http = { get: jest.fn() }
jest.mock('axios', () => {
    const api = {
        get: (...a: any[]) => http.get(...a),
        create: () => api,
        interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
        defaults: { headers: { common: {} } },
    }
    return { __esModule: true, default: api, ...api }
})
const push = jest.fn()
const route = { query: {} as Record<string, string> }
jest.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => route }))
const wallet = { current: null as any }
jest.mock('@/stores', () => ({ useMainStore: () => ({ get activeWallet() { return wallet.current } }) }))
/** The Moats burn gate: `allowed` decides; `checks` counts how often a lookup asked. */
const gate = { allowed: true, checks: 0 }
jest.mock('@/composables/useBaseAssetGate', () => {
    const { ref, computed } = require('vue')
    return {
        useBaseAssetGate: () => ({
            isBlocked: ref(false),
            required: computed(() => ({ toString: () => '1000000' })),
            symbol: 'AVXTO',
            gatedAction: async (action: () => unknown) => {
                gate.checks++
                if (!gate.allowed) return false
                await action()
                return true
            },
        }),
    }
})

import {
    classifyQuery,
    decodeMemo,
    feesOf,
    findTransaction,
    formatAmount,
    netChangeFor,
    type XTransaction,
    type XUtxo,
} from '@/explorer/xchain'
import XExplorer from '@/views/wallet/XExplorer.vue'

const X = '2oYMBNV4eNHyqk2fjjV5nVQLDbtmNJzq5s3qs3Lo6ftnC6FByM'
const C = '2q9e4r6Mu3U68nU1fYjgbR6JvwrRx36CohpAX5UQxse55x1Q5'
const AVAX = { assetId: 'FvwEAhmxKfeiG8SnEvq42hc6whRyY3EFYAvebMqDNDGCgxN5Z', name: 'Avalanche', symbol: 'AVAX', denomination: 9, type: 'secp256k1' }
const ME = 'avax102hddvy5ml8efjhjrfkev08m94g0tyqnntcf83'
const OTHER = 'avax1yhsga9xmf7gju2jh34h4qmkullc2f70umdrxl6'
const TX = '2iuPX79DMihinfRMuwU2JMZBsFZa7TF4gEPn6JJDjab5VrEq7E'
const PREV = '23qgukvyoCAAPQtCjhvvW2eGHE4huiMeLxra8Mgy7SrjaXDvbR'
const BLOCK = 'tp9NEfY1tFNfaucwPngdEtj5pCuddmN2QhBQzsATX7zDuPQwB'

const utxo = (over: Partial<XUtxo> & { amount: string; owner: string }): XUtxo =>
    Object.assign(
        {
            addresses: [over.owner],
            utxoId: `utxo-${over.owner.slice(5, 9)}-${over.amount}`,
            asset: Object.assign({}, AVAX, { amount: over.amount }),
            utxoType: 'transfer',
            outputIndex: '0',
            timestamp: 1761108015,
            creationTxHash: PREV,
            locktime: 0,
            threshold: 1,
            createdOnChainId: X,
        },
        over
    ) as XUtxo

/** An export: ME spends 63.009578142 AVAX, 50 goes to C-Chain, the change comes back, 0.001 is fee. */
const exportTx = (): XTransaction => ({
    txHash: TX,
    chainFormat: 'linear',
    blockHash: BLOCK,
    blockHeight: 493933,
    txType: 'ExportTx',
    timestamp: 1761108015,
    sourceChain: X,
    destinationChain: C,
    memo: '0x68656c6c6f',
    consumedUtxos: [
        utxo({
            amount: '63009578142',
            owner: ME,
            consumingTxHash: TX,
            consumingTxTimestamp: 1761108015,
            consumedOnChainId: X,
            credentials: [{ publicKey: 'Aur7+dRGD0Uu7YUr5gbQlq+pG6FAynlv+xlvFO1oHD+4', signature: 'XM3uOFXhkDLW5dGMQ5O' }],
        }),
    ],
    emittedUtxos: [
        utxo({ amount: '50000000000', owner: ME, creationTxHash: TX, consumedOnChainId: C }),
        utxo({ amount: '13008578142', owner: ME, creationTxHash: TX, outputIndex: '1' }),
    ],
    amountUnlocked: [Object.assign({}, AVAX, { amount: '63009578142' })],
    amountCreated: [Object.assign({}, AVAX, { amount: '63008578142' })],
})

/** Routes mocked Glacier GETs by URL. */
function glacier(routes: Record<string, any>) {
    http.get.mockImplementation(async (url: string, opts: any) => {
        for (const [frag, body] of Object.entries(routes)) {
            if (url.includes(frag)) {
                const value = typeof body === 'function' ? body(url, opts?.params ?? {}) : body
                if (value instanceof Error) throw value
                return { data: value }
            }
        }
        throw Object.assign(new Error('nf'), { response: { status: 404, data: { message: 'Not Found' } } })
    })
}

beforeEach(() => {
    http.get.mockReset()
    push.mockReset()
    route.query = {}
    wallet.current = null
    gate.allowed = true
    gate.checks = 0
})

describe('the search box', () => {
    it('reads X-Chain addresses with or without "X-", and the network from the prefix', () => {
        expect(classifyQuery(`X-${ME}`)).toEqual({ kind: 'address', address: ME, network: 'mainnet' })
        expect(classifyQuery(`  ${ME.toUpperCase()} `)).toEqual({ kind: 'address', address: ME, network: 'mainnet' })
        expect(classifyQuery(`X-fuji1${'q'.repeat(38)}`)).toMatchObject({ kind: 'address', network: 'fuji' })
        expect(classifyQuery(TX)).toEqual({ kind: 'tx', txHash: TX })
    })

    it('turns away P-, C- and EVM addresses and junk with a reason', () => {
        expect(classifyQuery(`P-${ME}`)).toMatchObject({ kind: 'invalid', reason: expect.stringMatching(/P- or C-Chain/) })
        expect(classifyQuery('0x5e379D6A276262C293c9C632D0C72ca9C90A9635')).toMatchObject({ kind: 'invalid', reason: expect.stringMatching(/EVM/) })
        expect(classifyQuery('hello')).toMatchObject({ kind: 'invalid' })
        expect(classifyQuery('')).toMatchObject({ kind: 'invalid' })
    })
})

describe('presentation helpers', () => {
    it('formats base units exactly, with grouping and no float rounding', () => {
        expect(formatAmount('63009578142', 9)).toBe('63.009578142')
        expect(formatAmount('1000000000000000', 9)).toBe('1,000,000')
        expect(formatAmount('1', 9)).toBe('0.000000001')
        expect(formatAmount(BigInt(-1000000), 9)).toBe('-0.001')
        expect(formatAmount('7', 0)).toBe('7')
    })

    it('works out the fee, and does not count exported outputs as fee', () => {
        expect(feesOf(exportTx()).map((f) => [f.symbol, formatAmount(f.net, 9)])).toEqual([['AVAX', '0.001']])
    })

    it("computes the transaction's effect on one address", () => {
        expect(netChangeFor(exportTx(), ME).map((c) => formatAmount(c.net, 9))).toEqual(['-0.001'])
        expect(netChangeFor(exportTx(), OTHER)).toEqual([])
    })

    it('decodes a printable memo and keeps the hex', () => {
        expect(decodeMemo('0x68656c6c6f')).toEqual({ hex: '0x68656c6c6f', text: 'hello' })
        expect(decodeMemo('0x00ff')).toEqual({ hex: '0x00ff', text: null })
        expect(decodeMemo('0x')).toEqual({ hex: '', text: null })
    })
})

describe('finding a transaction', () => {
    it('falls back to the other network when the ID is not on the chosen one', async () => {
        glacier({ '/networks/fuji/blockchains/x-chain/transactions/': exportTx() })
        const found = await findTransaction(TX, 'mainnet')
        expect(found.network).toBe('fuji')
    })

    it('reports a missing ID on both networks, and rate limiting plainly', async () => {
        glacier({})
        await expect(findTransaction(TX, 'mainnet')).rejects.toThrow(/Mainnet or Fuji/)
        glacier({ '/transactions/': new (class extends Error {
            response = { status: 429, data: {} }
        })('x') })
        await expect(findTransaction(TX, 'mainnet')).rejects.toThrow(/rate limiting/)
    })
})

const stubs = { CopyText: true, 'router-link': { props: ['to'], template: '<a :data-to="to"><slot /></a>' } }

describe('the transaction page', () => {
    it('shows every detail: summary, block, assets, inputs with credentials, outputs, raw JSON', async () => {
        glacier({
            [`/transactions/${TX}`]: Object.assign(exportTx(), { someNewField: 'kept' }),
            [`/blocks/${BLOCK}`]: {
                blockNumber: '493933',
                blockHash: BLOCK,
                parentHash: 'parentHashXYZ',
                blockTimestamp: 1761108015,
                blockType: 'standard',
                txCount: 2,
                blockSizeBytes: 1234,
                transactions: [TX, PREV],
                proposerDetails: { proposerNodeId: 'NodeID-abc' },
            },
            '/assets/': Object.assign({}, AVAX, { cap: 'variable', createdAtTimestamp: 1600000000 }),
        })
        route.query = { q: TX, net: 'mainnet' }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        const text = w.text()
        for (const expected of [
            'ExportTx',
            '#493933',
            'C-Chain',
            '“hello”',
            '0.001 AVAX', // fee
            '63.009578142 AVAX', // input
            'Aur7+dRGD0Uu7YUr5gbQlq+pG6FAynlv+xlvFO1oHD+4', // credential public key
            'Exported to C-Chain', // the output waiting in atomic memory
            'parentHashXYZ',
            'NodeID-abc',
            'variable', // asset cap
            'someNewField', // fields Glacier adds later still show
            'Raw transaction JSON',
        ]) {
            expect(text).toContain(expected)
        }
        w.unmount()
    })

    it('follows a link inside the results by navigating', async () => {
        glacier({ [`/transactions/${TX}`]: exportTx(), '/blocks/': new Error('x'), '/assets/': AVAX })
        route.query = { q: TX }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        await w.findAll('button.link').find((b) => b.text() === `X-${ME}`)!.trigger('click')
        expect(push).toHaveBeenCalledWith({ query: { q: `X-${ME}`, net: 'mainnet' } })
        w.unmount()
    })

    it('shows the error for an unknown ID', async () => {
        glacier({})
        route.query = { q: TX }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        expect(w.find('.err').text()).toMatch(/Mainnet or Fuji/)
        w.unmount()
    })
})

describe('the Moats burn gate', () => {
    it('runs no lookup for a wallet that has not burned enough, and says why', async () => {
        gate.allowed = false
        glacier({ [`/transactions/${TX}`]: exportTx() })
        route.query = { q: TX }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        expect(gate.checks).toBe(1)
        expect(http.get).not.toHaveBeenCalled()
        expect(w.find('.gate_note').text()).toContain('1,000,000 AVXTO burned on Moats')
        expect(w.find('.gate_note a').attributes('data-to')).toBe('/wallet/moats/burn')
        expect(w.findComponent({ name: 'XTxView' }).exists()).toBe(false)
        w.unmount()
    })

    it('checks every lookup, addresses included, and runs it once the burn is enough', async () => {
        glacier({ 'addresses:listChainIds': { addresses: [] }, '/balances': { balances: {} }, '/transactions': { transactions: [] }, '/utxos': { utxos: [] } })
        route.query = { q: `X-${ME}` }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        expect(gate.checks).toBe(1)
        expect(w.findComponent({ name: 'XAddressView' }).exists()).toBe(true)
        expect(w.find('.gate_note').exists()).toBe(false)
        w.unmount()
    })

    it('explains invalid input without a burn check, since nothing is fetched', async () => {
        route.query = { q: 'hello' }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        expect(gate.checks).toBe(0)
        expect(w.find('.err').exists()).toBe(true)
        w.unmount()
    })
})

describe('the address page', () => {
    const routes = (utxoPages: Record<string, any>) => ({
        'addresses:listChainIds': { addresses: [{ address: ME, blockchainIds: [X, C] }] },
        '/balances': {
            balances: {
                unlocked: [Object.assign({}, AVAX, { amount: '13008578142', utxoCount: 1 })],
                locked: [Object.assign({}, AVAX, { amount: '0', utxoCount: 0 })],
                atomicMemoryUnlocked: [Object.assign({}, AVAX, { amount: '50000000000', utxoCount: 1 })],
                atomicMemoryLocked: [],
            },
        },
        '/assets/': Object.assign({}, AVAX, { cap: 'variable' }),
        '/transactions': (_: string, p: any) =>
            p.pageToken ? { transactions: [Object.assign(exportTx(), { txHash: PREV, txType: 'BaseTx' })] } : { transactions: [exportTx()], nextPageToken: 'page2' },
        '/utxos': (_: string, p: any) => utxoPages[p.includeSpent ? 'all' : 'unspent'],
    })

    it('shows chains, every balance kind, assets, history with effects, and UTXOs', async () => {
        glacier(
            routes({
                unspent: { utxos: [utxo({ amount: '13008578142', owner: ME, creationTxHash: TX })] },
                all: { utxos: [utxo({ amount: '13008578142', owner: ME }), utxo({ amount: '63009578142', owner: ME, consumingTxHash: TX })] },
            })
        )
        route.query = { q: `X-${ME}` }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        const text = w.text()
        expect(text).toContain('C-Chain')
        expect(text).toContain('Unlocked')
        expect(text).toContain('13.008578142')
        expect(text).toContain('Atomic memory')
        expect(text).not.toContain('time-locked outputs') // the zero "locked" row is hidden
        expect(text).toContain('variable')
        expect(text).toContain('-0.001 AVAX') // the export's effect on this address
        expect(w.findAll('.utxo')).toHaveLength(1)
        expect(text).toContain('unspent')

        // more history
        await w.findAll('button.more_btn').find((b) => b.text().includes('transactions'))!.trigger('click')
        await flushPromises()
        expect(w.text()).toContain(PREV)

        // include spent UTXOs
        await w.find('.toggle input').setValue(true)
        await flushPromises()
        expect(w.findAll('.utxo')).toHaveLength(2)
        expect(w.text()).toContain('spent')
        w.unmount()
    })

    it('offers "My X address" only while an Avalanche wallet is active', async () => {
        glacier({})
        let w = mount(XExplorer, { global: { stubs } })
        expect(w.text()).not.toContain('My X address')
        w.unmount()
        wallet.current = { getCurrentAddressAvm: () => `X-${ME}` }
        w = mount(XExplorer, { global: { stubs } })
        await w.findAll('button.link').find((b) => b.text() === 'My X address')!.trigger('click')
        expect(push).toHaveBeenCalledWith({ query: { q: `X-${ME}`, net: 'mainnet' } })
        w.unmount()
    })

    it('explains why a P-Chain address is refused', async () => {
        route.query = { q: `P-${ME}` }
        const w = mount(XExplorer, { global: { stubs } })
        await flushPromises()
        expect(w.find('.err').text()).toMatch(/P- or C-Chain/)
        expect(http.get).not.toHaveBeenCalled()
        w.unmount()
    })
})
