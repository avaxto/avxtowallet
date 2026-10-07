/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bridge tokens: what can be sent (the portfolio, held tokens only) and how a
 * receive token is found — the local registry first, the web (Uniswap token
 * list, then CoinGecko) only when the registry has no match — plus THORChain
 * swapping into a chosen token when it has a pool for it.
 */
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
const scan = jest.fn()
jest.mock('@/stores/evmPortfolio', () => ({ scanNetwork: (...a: any[]) => scan(...a) }))
jest.mock('@/bridge/assets', () => ({
    ...jest.requireActual('@/bridge/assets'),
    readTokenAsset: async (chain: any, address: string) => ({ chainId: chain.id, address, symbol: 'USDC', name: '', decimals: 6 }),
    readBalance: async () => BigInt(5),
    solanaHeldTokens: async () => [],
}))

import Big from 'big.js'
import { getBridgeChain } from '@/bridge/chains'
import { deliversToken, portfolioTokens, resolveToken, suggestReceiveTokens, registryTokens } from '@/bridge/tokens'
import { thorchainProvider, __resetThorPools } from '@/bridge/thorchain/provider'
import { nativeAsset } from '@/bridge/assets'

const chain = (id: string) => {
    const c = getBridgeChain(id)
    if (!c) throw new Error(id)
    return c
}
const ME = '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

beforeEach(() => {
    http.get.mockReset()
    scan.mockReset()
    __resetThorPools()
})

describe('what can be sent', () => {
    it('is what the portfolio holds on that chain: native first, verified tokens next, nothing at zero', async () => {
        scan.mockResolvedValue({
            status: 'ok',
            tokens: [
                { isNative: false, address: '0x00000000000000000000000000000000000000aa', symbol: 'ZZZ', name: 'Zed', decimals: 18, raw: '7', balance: Big(0) },
                { isNative: false, address: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', symbol: 'USDC', name: 'USD Coin', decimals: 6, raw: '2500000', balance: Big(2.5) },
                { isNative: false, address: '0x00000000000000000000000000000000000000bb', symbol: 'DUST', name: 'Dust', decimals: 18, raw: '0', balance: Big(0) },
                { isNative: true, address: 'native', symbol: 'AVAX', name: 'Avalanche', decimals: 18, raw: '3', balance: Big(0) },
            ],
        })
        const list = await portfolioTokens(chain('evm:43114'), ME)
        expect(scan.mock.calls[0][0]).toBe(ME)
        expect(list.map((t) => [t.symbol, t.balance.toString(), t.verified])).toEqual([
            ['AVAX', '3', true],
            ['USDC', '2500000', true],
            ['ZZZ', '7', false],
        ])
    })

    it('still offers the native coin when the portfolio cannot be read, or nothing is connected', async () => {
        scan.mockRejectedValue(new Error('explorer down'))
        expect((await portfolioTokens(chain('evm:1'), ME)).map((t) => t.address)).toEqual(['native'])
        expect((await portfolioTokens(chain('bitcoin:mainnet'), '')).map((t) => t.symbol)).toEqual(['BTC'])
    })
})

describe('finding a receive token', () => {
    it('answers from the local registry first, without touching the web', async () => {
        const res = await suggestReceiveTokens(chain('evm:43114'), 'usdc')
        expect(res.searchedWeb).toBe(false)
        expect(res.suggestions[0]).toMatchObject({ symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', source: 'registry', verified: true })
        expect(http.get).not.toHaveBeenCalled()
        // The chain's own coin is a registry answer too.
        expect((await suggestReceiveTokens(chain('evm:1'), 'eth')).suggestions[0]).toMatchObject({ address: 'native', source: 'native' })
        expect(registryTokens(chain('solana:mainnet-beta')).some((t) => t.symbol === 'USDC')).toBe(true)
    })

    it('searches the Uniswap token list when the registry has nothing', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url === 'https://tokens.uniswap.org')
                return {
                    data: {
                        tokens: [
                            { chainId: 1, address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
                            { chainId: 137, address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', name: 'Dai', decimals: 18 },
                        ],
                    },
                }
            throw new Error(`unexpected ${url}`)
        })
        const res = await suggestReceiveTokens(chain('evm:1'), 'dai')
        expect(res.searchedWeb).toBe(true)
        expect(res.suggestions).toHaveLength(1)
        expect(res.suggestions[0]).toMatchObject({ symbol: 'DAI', decimals: 18, source: 'tokenlist', verified: false })
    })

    it('falls back to CoinGecko, which also covers Solana', async () => {
        http.get.mockImplementation(async (url: string, opts: any) => {
            if (url.endsWith('/search')) {
                expect(opts.params.query).toBe('popcat')
                return { data: { coins: [{ id: 'popcat', symbol: 'popcat', name: 'Popcat' }] } }
            }
            if (url.endsWith('/coins/popcat'))
                return { data: { detail_platforms: { solana: { contract_address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', decimal_place: 9 } } } }
            throw new Error(`unexpected ${url}`)
        })
        const res = await suggestReceiveTokens(chain('solana:mainnet-beta'), 'popcat')
        expect(res.suggestions[0]).toMatchObject({ symbol: 'POPCAT', address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', decimals: 9, source: 'coingecko' })
    })

    it('reports a web failure instead of throwing, and never searches the web for testnets', async () => {
        http.get.mockRejectedValue(new Error('429'))
        const res = await suggestReceiveTokens(chain('evm:1'), 'qqqq')
        expect(res.suggestions).toEqual([])
        expect(res.webError).toMatch(/CoinGecko/)
        http.get.mockClear()
        expect((await suggestReceiveTokens(chain('evm:11155111'), 'qqqq')).suggestions).toEqual([])
        expect(http.get).not.toHaveBeenCalled()
    })

    it('re-reads a picked EVM token on chain, and matches routes by address', async () => {
        const t = await resolveToken(chain('evm:1'), { chainId: 'evm:1', address: USDC_ETH, symbol: 'FAKE', name: 'x', decimals: 18, source: 'coingecko', verified: false })
        expect(t).toMatchObject({ symbol: 'USDC', decimals: 6 })
        expect(deliversToken({ chainId: 'evm:1', address: USDC_ETH.toLowerCase(), symbol: 'USDC', decimals: 6 }, t)).toBe(true)
        expect(deliversToken(nativeAsset(chain('evm:1')), t)).toBe(false)
    })
})

describe('THORChain into a chosen token', () => {
    const pools = [
        { asset: 'ETH.ETH', status: 'Available' },
        { asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', status: 'Available' },
        { asset: 'ETH.OLD-0X1111111111111111111111111111111111111111', status: 'Staged' },
    ]
    const quoteData = {
        inbound_address: 'bc1qvault',
        memo: '=:ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48:0x4887:9900000000/1/0',
        expiry: Math.floor(Date.now() / 1000) + 900,
        recommended_gas_rate: '3',
        recommended_min_amount_in: '1000',
        expected_amount_out: '10000000000',
        fees: { asset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', total: '50000000' },
        total_swap_seconds: 900,
    }
    const usdc = { chainId: 'evm:1', address: USDC_ETH, symbol: 'USDC', decimals: 6, name: 'USD Coin' }

    it('swaps native BTC into USDC on Ethereum when there is a pool for it', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/thorchain/pools')) return { data: pools }
            if (url.endsWith('/thorchain/quote/swap')) return { data: quoteData }
            throw new Error(url)
        })
        const q = await thorchainProvider.quote({
            from: nativeAsset(chain('bitcoin:mainnet')),
            toChain: chain('evm:1'),
            amount: BigInt(1_000_000),
            sender: 'bc1qme',
            recipient: ME,
            receiveToken: usdc,
        })
        const swapCall = http.get.mock.calls.find((c) => String(c[0]).endsWith('/quote/swap'))!
        expect(swapCall[1].params.to_asset).toBe('ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48')
        expect(q.routeName).toBe('THORChain swap to USDC')
        // 1e8 THORChain units → USDC's 6 decimals.
        expect(q.receive).toMatchObject({ asset: { address: USDC_ETH, symbol: 'USDC', decimals: 6 }, amount: BigInt(100_000_000), kind: 'canonical' })
        expect(q.minReceive).toBe(BigInt(99_000_000))
        expect(q.fees[0]).toMatchObject({ symbol: 'USDC', decimals: 6, amount: BigInt(500_000) })
    })

    it('says so when THORChain has no pool for the token', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url.endsWith('/thorchain/pools')) return { data: pools }
            throw new Error(url)
        })
        await expect(
            thorchainProvider.quote({
                from: nativeAsset(chain('bitcoin:mainnet')),
                toChain: chain('evm:1'),
                amount: BigInt(1_000_000),
                sender: 'bc1qme',
                recipient: ME,
                receiveToken: { chainId: 'evm:1', address: '0x1111111111111111111111111111111111111111', symbol: 'OLD', decimals: 18 },
            })
        ).rejects.toThrow(/no OLD pool on Ethereum/)
    })
})
