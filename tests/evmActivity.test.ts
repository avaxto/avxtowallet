/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `listTransactions` for the Blockscout and Etherscan explorer adapters.
 *
 * Fixtures are trimmed real responses (Blockscout: a live call against
 * eth.blockscout.com made while building this; Etherscan: the well-documented,
 * stable classic `txlist` shape) rather than hand-invented ones — the risk in
 * this code is field-name/shape mistakes against a real API, which fabricated
 * fixtures cannot catch.
 */
// The whole of `@/evm/explorers/http` is replaced, so this file exercises what
// is genuinely adapter-specific — URL construction and response parsing —
// without reaching through the shared request layer's own internals.
//
// This used to be done by pointing the module at a hand-written stub from a
// per-file Jest config that no longer exists, which is why the mock was not a
// mock at all and every test here failed the moment `yarn test` could run
// again. `jest.mock` was originally avoided because ts-jest 26 could not
// compile its hoisting transform against TypeScript 5 (`ts.getMutableClone is
// not a function`); the toolchain is on ts-jest 29 now and handles it.
jest.mock('@/evm/explorers/http')

import { fetchExplorerJson } from '@/evm/explorers/http'
const fetchExplorerJsonMock = fetchExplorerJson as jest.Mock

import { blockscoutAdapter } from '@/evm/explorers/blockscout'
import { etherscanAdapter } from '@/evm/explorers/etherscan'
import { setEtherscanApiKey } from '@/evm/explorers/apiKey'
import { loadCustomEvmNetworks, getEvmNetworkByChainId } from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'

loadCustomEvmNetworks()

const ETHEREUM = getEvmNetworkByChainId(1) as EvmNetwork
const BNB = getEvmNetworkByChainId(56) as EvmNetwork

function mockFetchOnce(body: unknown): jest.MockedFunction<typeof fetchExplorerJson> {
    fetchExplorerJsonMock.mockReset()
    fetchExplorerJsonMock.mockResolvedValue(body as any)
    return fetchExplorerJsonMock
}

describe('blockscoutAdapter.listTransactions', () => {
    // Trimmed from a live GET against
    // https://eth.blockscout.com/api/v2/addresses/{addr}/transactions
    const FIXTURE = {
        items: [
            {
                hash: '0x3086954fbc1f263ab16fd3a08745a300bed6f456346b97015a735c9416af698f',
                block_number: 25798602,
                timestamp: '2026-08-20T20:03:59.000000Z',
                from: { hash: '0xf1E863dB11AC066395aE1248257c2D2B9644Bf3F' },
                to: { hash: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
                value: '1000000000000000',
                status: 'ok',
                method: '0x4d415552',
                created_contract: null,
            },
            {
                hash: '0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddead',
                block_number: 25798500,
                timestamp: '2026-08-20T19:00:00.000000Z',
                from: { hash: '0xAbC0000000000000000000000000000000000abc' },
                to: null,
                value: '0',
                status: 'error',
                method: 'transfer',
                created_contract: { hash: '0xNewContract00000000000000000000000000' },
            },
        ],
        next_page_params: {
            index: 34,
            value: '10000000000000',
            filter: 'to',
            hash: '0x99048857948a26726f7ad870a6d75bdb562e4dd7994b91118e572f87cac4847f',
            inserted_at: '2026-07-05T13:23:16.038242Z',
            block_number: 25466595,
            fee: '12161384756398',
            items_count: 50,
        },
    }

    it('parses a raw (un-decoded) selector as no label, and a decoded name as one', async () => {
        mockFetchOnce(FIXTURE)
        const page = await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM
        )
        expect(page.transactions[0].methodLabel).toBeNull()
        expect(page.transactions[1].methodLabel).toBe('transfer')
    })

    it('maps status, contract creation, and addresses correctly', async () => {
        mockFetchOnce(FIXTURE)
        const page = await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM
        )
        const [ok, failed] = page.transactions

        expect(ok.status).toBe('ok')
        expect(ok.to).toBe('0xd8da6bf26964af9d7eed9e03e53415d37aa96045')
        expect(ok.isContractCreation).toBe(false)

        expect(failed.status).toBe('failed')
        expect(failed.to).toBeNull()
        expect(failed.isContractCreation).toBe(true)
    })

    it('parses the ISO timestamp into epoch milliseconds', async () => {
        mockFetchOnce(FIXTURE)
        const page = await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM
        )
        expect(page.transactions[0].timestampMs).toBe(Date.parse('2026-08-20T20:03:59.000000Z'))
    })

    it('carries next_page_params through verbatim as the cursor', async () => {
        mockFetchOnce(FIXTURE)
        const page = await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM
        )
        expect(page.nextCursor).toEqual(FIXTURE.next_page_params)
    })

    it('returns a null cursor (not the page params object) when there is no next page', async () => {
        mockFetchOnce({ items: [], next_page_params: null })
        const page = await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM
        )
        expect(page.transactions).toEqual([])
        expect(page.nextCursor).toBeNull()
    })

    it('echoes a cursor object back as query params on the next request', async () => {
        mockFetchOnce({ items: [], next_page_params: null })
        await blockscoutAdapter.listTransactions!(
            '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
            ETHEREUM,
            { index: 34, block_number: 25466595 }
        )
        const requestedUrl = fetchExplorerJsonMock.mock.calls[0][0] as string
        expect(requestedUrl).toContain('index=34')
        expect(requestedUrl).toContain('block_number=25466595')
    })
})

describe('etherscanAdapter.listTransactions', () => {
    beforeEach(() => setEtherscanApiKey('test-key'))

    // Classic txlist shape.
    const FIXTURE = {
        status: '1',
        message: 'OK',
        result: [
            {
                hash: '0xaaaa',
                blockNumber: '18000000',
                timeStamp: '1700000000',
                from: '0xFrom00000000000000000000000000000000001',
                to: '0xTo000000000000000000000000000000000002',
                value: '2000000000000000000',
                txreceipt_status: '1',
                isError: '0',
                contractAddress: '',
                functionName: 'transfer(address,uint256)',
            },
            {
                hash: '0xbbbb',
                blockNumber: '18000001',
                timeStamp: '1700000060',
                from: '0xFrom00000000000000000000000000000000001',
                to: '',
                value: '0',
                txreceipt_status: '0',
                isError: '1',
                contractAddress: '0xNewContract0000000000000000000000000003',
                functionName: '',
            },
        ],
    }

    it('parses the function signature down to just the method name', async () => {
        mockFetchOnce(FIXTURE)
        const page = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        expect(page.transactions[0].methodLabel).toBe('transfer')
        expect(page.transactions[1].methodLabel).toBeNull()
    })

    it('converts the seconds-based timestamp to milliseconds', async () => {
        mockFetchOnce(FIXTURE)
        const page = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        expect(page.transactions[0].timestampMs).toBe(1700000000 * 1000)
    })

    it('reads status from txreceipt_status/isError and flags contract creation', async () => {
        mockFetchOnce(FIXTURE)
        const page = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        const [ok, failed] = page.transactions
        expect(ok.status).toBe('ok')
        expect(failed.status).toBe('failed')
        expect(failed.to).toBeNull()
        expect(failed.isContractCreation).toBe(true)
    })

    it('treats "no transactions found" as an empty page, not an error', async () => {
        mockFetchOnce({ status: '0', message: 'No transactions found', result: [] })
        const page = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        expect(page.transactions).toEqual([])
        expect(page.nextCursor).toBeNull()
    })

    it('throws on a real API error rather than reading it as empty', async () => {
        mockFetchOnce({ status: '0', message: 'Invalid API Key', result: 'Invalid API Key' })
        await expect(
            etherscanAdapter.listTransactions!('0xFrom00000000000000000000000000000000001', BNB)
        ).rejects.toThrow(/Invalid API Key/)
    })

    it('advances the page cursor only when the page came back full', async () => {
        const full = { status: '1', message: 'OK', result: Array(25).fill(FIXTURE.result[0]) }
        mockFetchOnce(full)
        const fullPage = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        expect(fullPage.nextCursor).toBe(2)

        mockFetchOnce(FIXTURE) // only 2 rows — under the 25-row page size
        const shortPage = await etherscanAdapter.listTransactions!(
            '0xFrom00000000000000000000000000000000001',
            BNB
        )
        expect(shortPage.nextCursor).toBeNull()
    })
})
