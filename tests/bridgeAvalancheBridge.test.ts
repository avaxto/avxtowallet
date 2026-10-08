/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The official Avalanche Bridge between Ethereum and Avalanche, both ways, in
 * place of Wormhole and THORChain wherever it carries the token: its own
 * settings (token list, fees, pause, blocklist, wallet), the calls real
 * transfers make (`unwrap(amount, 0)` out, a plain `transfer` to the bridge
 * wallet in), tracking on the other chain, and the optional WETH → ETH unwrap.
 */
import Web3 from 'web3'

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
const avalancheLogs = { head: 1000, logs: [] as any[], calls: [] as any[] }
jest.mock('@/evm/providers', () => ({
    web3For: () => ({
        eth: {
            getBlockNumber: async () => avalancheLogs.head,
            getPastLogs: async (q: any) => {
                avalancheLogs.calls.push(q)
                return avalancheLogs.logs.filter((l) => l.blockNumber >= q.fromBlock && l.blockNumber <= q.toBlock)
            },
        },
    }),
}))

import {
    avalancheBridgeProvider,
    bridgeRoute,
    BRIDGE_TOKENS,
    parseSettings,
    WETH_E,
    WETH_ETHEREUM,
    __resetAvalancheBridgeSettings,
} from '@/bridge/avalancheBridge/provider'
import { providersFor, setProviderEnabled } from '@/bridge/registry'
import { getBridgeChain } from '@/bridge/chains'
import { nativeAsset } from '@/bridge/assets'
import { newTransfer } from '@/bridge/types'

const ME = '0x5e379D6A276262C293c9C632D0C72ca9C90A9635'
const BRIDGE_ETH_WALLET = '0x8eb8a3b98659cce290402893d0123abb75e3ab28'
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_E = '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664'
const chain = (id: string) => {
    const c = getBridgeChain(id)
    if (!c) throw new Error(id)
    return c
}
const WETH_E_ASSET = { chainId: 'evm:43114', address: WETH_E, symbol: 'WETH.e', decimals: 18 }
const USDC_ETH_ASSET = { chainId: 'evm:1', address: USDC_ETH, symbol: 'USDC', decimals: 6 }

/** Shaped like the live bridge_settings.json, every listed token included. */
function settings(over: any = {}) {
    const assets: Record<string, any> = {}
    const wrap: Record<string, any> = {}
    const unwrap: Record<string, any> = {}
    for (const t of BRIDGE_TOKENS) {
        assets[t.symbol] = { nativeContractAddress: t.ethereum, wrappedContractAddress: t.avalanche, denomination: t.decimals, nativeNetwork: 'ethereum', wrappedNetwork: 'avalanche' }
        wrap[t.symbol] = { minimumFeeAmount: '1', maximumFeeAmount: '1', feePercentage: 25, feePercentageDecimals: 3 }
        unwrap[t.symbol] = { minimumFeeAmount: '1', maximumFeeAmount: '1', feePercentage: 1, feePercentageDecimals: 1 }
    }
    wrap.WETH = { minimumFeeAmount: '1166612529808712', maximumFeeAmount: '1166612529808712', feePercentage: 25, feePercentageDecimals: 3 }
    unwrap.WETH = { minimumFeeAmount: '8152363720167413', maximumFeeAmount: '8152363720167413', feePercentage: 1, feePercentageDecimals: 1 }
    wrap.USDC = { minimumFeeAmount: '3001938', maximumFeeAmount: '250161478', feePercentage: 25, feePercentageDecimals: 3 }
    return {
        critical: Object.assign(
            {
                addressBlocklist: [],
                disableFrontend: false,
                operationMode: 'normal',
                walletAddresses: { avalanche: '0xeb1bb70123b2f43419d070d7fde5618971cc2f8f', ethereum: BRIDGE_ETH_WALLET },
                assets,
            },
            over
        ),
        nonCritical: { wrapFeeApproximation: wrap, unwrapFeeApproximation: unwrap },
    }
}

const req = (from: any, to: string, amount: string, recipient = ME) => ({ from, toChain: chain(to), amount: BigInt(amount), sender: ME, recipient })

function fakeSigner(chainId: number) {
    const sent: any[] = []
    return {
        sent,
        signer: {
            network: { evmChainId: chainId },
            assertOnChain: jest.fn(async () => {}),
            estimateGas: jest.fn(async () => 70_000),
            send: jest.fn(async (r: any) => {
                sent.push(r)
                return `0xsent${sent.length}`
            }),
            waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, status: true, contractAddress: null })),
        } as any,
    }
}
const decodeArgs = (types: string[], data: string) => Object.values(new Web3().eth.abi.decodeParameters(types, '0x' + data.slice(10))).slice(0, types.length) as string[]

beforeEach(() => {
    http.get.mockReset()
    __resetAvalancheBridgeSettings()
    avalancheLogs.head = 1000
    avalancheLogs.logs = []
    avalancheLogs.calls = []
})

describe('routing', () => {
    afterEach(() => ['avalanche-bridge', 'wormhole', 'thorchain'].forEach((id) => setProviderEnabled(id, true)))

    it('uses the Avalanche Bridge, both ways, for every token it carries — instead of Wormhole and THORChain', () => {
        expect(providersFor(WETH_E_ASSET, chain('evm:1')).map((p) => p.id)).toEqual(['avalanche-bridge'])
        expect(providersFor(USDC_ETH_ASSET, chain('evm:43114')).map((p) => p.id)).toEqual(['avalanche-bridge'])
        expect(providersFor(nativeAsset(chain('evm:1')), chain('evm:43114')).map((p) => p.id)).toEqual(['avalanche-bridge'])
        expect(BRIDGE_TOKENS).toHaveLength(25)
    })

    it('leaves pairs it cannot carry to the other bridges', () => {
        // Native AVAX and Circle's native USDC on Avalanche are not bridge tokens.
        expect(providersFor(nativeAsset(chain('evm:43114')), chain('evm:1')).map((p) => p.id)).toEqual(['wormhole', 'thorchain'])
        const nativeUsdc = { chainId: 'evm:43114', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 }
        expect(providersFor(nativeUsdc, chain('evm:1')).map((p) => p.id)).toEqual(['wormhole'])
        // Other destinations, and Bitcoin, are untouched.
        expect(providersFor(WETH_E_ASSET, chain('evm:8453')).map((p) => p.id)).toEqual(['wormhole'])
        expect(providersFor(nativeAsset(chain('bitcoin:mainnet')), chain('evm:43114')).map((p) => p.id)).toEqual(['thorchain'])
    })

    it('falls back to the other bridges if it is switched off in Settings', () => {
        setProviderEnabled('avalanche-bridge', false)
        expect(providersFor(WETH_E_ASSET, chain('evm:1')).map((p) => p.id)).toEqual(['wormhole'])
        expect(providersFor(nativeAsset(chain('evm:1')), chain('evm:43114')).map((p) => p.id)).toEqual(['wormhole', 'thorchain'])
    })

    it('maps tokens to their direction', () => {
        expect(bridgeRoute(WETH_E_ASSET, 'evm:1')).toMatchObject({ direction: 'offboard', token: { symbol: 'WETH' } })
        expect(bridgeRoute(USDC_ETH_ASSET, 'evm:43114')).toMatchObject({ direction: 'onboard', token: { symbol: 'USDC' }, wrapFirst: false })
        expect(bridgeRoute(nativeAsset(chain('evm:1')), 'evm:43114')).toMatchObject({ direction: 'onboard', token: { symbol: 'WETH' }, wrapFirst: true })
        expect(bridgeRoute(USDC_ETH_ASSET, 'evm:8453')).toBeNull()
    })
})

describe('settings and quotes', () => {
    it('computes fees from the bridge settings per token and direction', () => {
        const s = parseSettings(settings())
        const weth = BRIDGE_TOKENS.find((t) => t.symbol === 'WETH')!
        const usdc = BRIDGE_TOKENS.find((t) => t.symbol === 'USDC')!
        expect(s.fee(weth, 'offboard', BigInt('131700000000000000')).toString()).toBe('8152363720167413')
        expect(s.fee(usdc, 'onboard', BigInt(10_000_000_000)).toString()).toBe('3001938') // 0.025% of 10,000 is under the $3 minimum
        expect(s.fee(usdc, 'onboard', BigInt(100_000_000_000)).toString()).toBe('25000000') // 0.025% of 100,000
        expect(s.listed(usdc)).toBe(true)
        expect(s.ethereumWallet).toBe(BRIDGE_ETH_WALLET)
    })

    it('quotes WETH.e → Ethereum as WETH, the amount minus the fee', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))
        expect(q.routeName).toBe('Avalanche Bridge')
        expect(q.receive).toMatchObject({ asset: { address: WETH_ETHEREUM, symbol: 'WETH' }, amount: BigInt('123547636279832587'), kind: 'canonical' })
        expect(q.warnings[0]).toMatch(/Arrives as WETH \(0xC02a.*\) at your own address on Ethereum\. Unwrapping it to ETH/)
    })

    it('quotes USDC → Avalanche as USDC.e, and says it is not native USDC', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(USDC_ETH_ASSET, 'evm:43114', '10000000000'))
        expect(q.receive).toMatchObject({ asset: { address: USDC_E, symbol: 'USDC.e', decimals: 6 }, amount: BigInt(9_996_998_062), kind: 'wrapped' })
        expect(q.warnings[0]).toMatch(/Arrives as USDC\.e \(0xA7D7.*\).*not the native USDC on Avalanche/)
    })

    it('refuses another recipient, amounts under the fee, a paused bridge, blocked senders and changed listings', async () => {
        http.get.mockResolvedValue({ data: settings() })
        await expect(avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000', '0x0000000000000000000000000000000000000001'))).rejects.toThrow(/always delivers to the address that sends/)
        await expect(avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '8000000000000000'))).rejects.toThrow(/send more than that/)
        for (const over of [{ operationMode: 'maintenance' }, { addressBlocklist: [ME.toLowerCase()] }]) {
            __resetAvalancheBridgeSettings()
            http.get.mockResolvedValue({ data: settings(over) })
            await expect(avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))).rejects.toThrow(/paused|does not accept/)
        }
        __resetAvalancheBridgeSettings()
        const moved = settings()
        moved.critical.assets.WETH.wrappedContractAddress = '0x0000000000000000000000000000000000000bad'
        http.get.mockResolvedValue({ data: moved })
        await expect(avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))).rejects.toThrow(/no longer lists WETH/)
    })

    it('tries the next settings mirror when one fails', async () => {
        http.get.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data: settings() })
        await avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))
        expect(http.get.mock.calls[0][0]).not.toBe(http.get.mock.calls[1][0])
    })
})

describe('Avalanche → Ethereum', () => {
    it('sends unwrap(amount, 0) on the .e token — the call real transfers make', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))
        const { signer, sent } = fakeSigner(43114)
        const t = await avalancheBridgeProvider.execute(q, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent).toHaveLength(1)
        expect(sent[0].to.toLowerCase()).toBe(WETH_E.toLowerCase())
        expect(sent[0].data.slice(0, 10)).toBe('0x6e286671')
        expect(decodeArgs(['uint256', 'uint256'], sent[0].data)).toEqual(['131700000000000000', '0'])
        expect(t).toMatchObject({ status: 'in_transit', toSymbol: 'WETH' })
        expect(t.data).toMatchObject({ direction: 'offboard', symbol: 'WETH', ethereumWallet: BRIDGE_ETH_WALLET })
    })

    it('finds the payout from the bridge wallet on Ethereum, then offers the WETH → ETH unwrap', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(WETH_E_ASSET, 'evm:1', '131700000000000000'))
        const t = newTransfer(q, '0xsent', { direction: 'offboard', symbol: 'WETH', ethereumWallet: BRIDGE_ETH_WALLET, sentAt: Date.now() })
        http.get.mockResolvedValue({
            data: {
                items: [
                    { from: { hash: '0x1111111111111111111111111111111111111111' }, total: { value: '123547636279832587' }, timestamp: new Date().toISOString(), transaction_hash: '0xother' },
                    { from: { hash: '0x8EB8a3b98659Cce290402893d0123abb75E3ab28' }, total: { value: '123540000000000000' }, timestamp: new Date().toISOString(), transaction_hash: '0xpayout' },
                ],
            },
        })
        const done = await avalancheBridgeProvider.refresh(t)
        const [url, opts] = http.get.mock.calls[http.get.mock.calls.length - 1]
        expect(url).toBe(`https://eth.blockscout.com/api/v2/addresses/${ME}/token-transfers`)
        expect(opts.params).toMatchObject({ filter: 'to', token: WETH_ETHEREUM })
        expect(done).toMatchObject({ status: 'completed', destTxHash: '0xpayout' })

        const f = avalancheBridgeProvider.followUp!
        expect(f.available(done)).toBe(true)
        const { signer, sent } = fakeSigner(1)
        const after = await f.run(done, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent[0].to).toBe(WETH_ETHEREUM)
        expect(decodeArgs(['uint256'], sent[0].data)).toEqual(['123540000000000000'])
        expect(f.available(after)).toBe(false)
    })
})

describe('Ethereum → Avalanche', () => {
    it('sends the token to the bridge wallet from the live settings, with a plain transfer', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(USDC_ETH_ASSET, 'evm:43114', '10000000000'))
        const { signer, sent } = fakeSigner(1)
        const t = await avalancheBridgeProvider.execute(q, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(USDC_ETH)
        expect(sent[0].data.slice(0, 10)).toBe('0xa9059cbb')
        const [to, amount] = decodeArgs(['address', 'uint256'], sent[0].data)
        expect([to.toLowerCase(), amount]).toEqual([BRIDGE_ETH_WALLET, '10000000000'])
        expect(t.data).toMatchObject({ direction: 'onboard', symbol: 'USDC', avalancheFromBlock: 1000 })
    })

    it('wraps native ETH to WETH first, then sends the WETH', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(nativeAsset(chain('evm:1')), 'evm:43114', '500000000000000000'))
        expect(q.warnings.join(' ')).toMatch(/wrapped to WETH first.*two transactions/)
        const { signer, sent } = fakeSigner(1)
        await avalancheBridgeProvider.execute(q, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent.map((s) => [s.to, s.data.slice(0, 10)])).toEqual([
            [WETH_ETHEREUM, '0xd0e30db0'],
            [WETH_ETHEREUM, '0xa9059cbb'],
        ])
        expect(sent[0].value.toString()).toBe('500000000000000000')
    })

    it('refuses to deposit if the bridge wallet changed since the quote', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(USDC_ETH_ASSET, 'evm:43114', '10000000000'))
        __resetAvalancheBridgeSettings()
        http.get.mockResolvedValue({ data: settings({ walletAddresses: { ethereum: '0x0000000000000000000000000000000000000bad' } }) })
        const { signer, sent } = fakeSigner(1)
        await expect(avalancheBridgeProvider.execute(q, { evm: () => signer, solana: () => null, bitcoin: () => null })).rejects.toThrow(/wallet changed/)
        expect(sent).toEqual([])
    })

    it('finds the .e mint to the recipient on Avalanche, scanning from where it left off', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req(USDC_ETH_ASSET, 'evm:43114', '10000000000'))
        const t = newTransfer(q, '0xsent', { direction: 'onboard', symbol: 'USDC', avalancheFromBlock: 900, sentAt: Date.now() })
        const pending = await avalancheBridgeProvider.refresh(t)
        expect(pending.status).toBe('in_transit')
        expect(pending.data.scannedTo).toBe(1001)
        const q0 = avalancheLogs.calls[0]
        expect(q0.address).toBe(USDC_E)
        expect(q0.topics[1]).toBe('0x' + '0'.repeat(64))
        expect(q0.topics[2]).toBe('0x000000000000000000000000' + ME.slice(2).toLowerCase())

        avalancheLogs.head = 1500
        avalancheLogs.logs = [{ blockNumber: 1200, data: '0x' + (9_996_998_062).toString(16).padStart(64, '0'), transactionHash: '0xmint' }]
        const done = await avalancheBridgeProvider.refresh(pending)
        expect(done).toMatchObject({ status: 'completed', destTxHash: '0xmint', statusDetail: 'Arrived as USDC.e on Avalanche.' })
        expect(avalancheLogs.calls[avalancheLogs.calls.length - 1].fromBlock).toBe(1001)
        expect(avalancheBridgeProvider.followUp!.available(done)).toBe(false) // nothing to unwrap on Avalanche
    })
})
