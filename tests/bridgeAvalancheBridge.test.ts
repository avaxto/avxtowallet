/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The official Avalanche Bridge for WETH.e → Ethereum, in place of Wormhole:
 * the bridge's own settings (fee, pause, blocklist), the `unwrap(amount, 0)`
 * call real transfers make, the payout found on Ethereum, and the optional
 * WETH → ETH unwrap afterwards.
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

import {
    avalancheBridgeProvider,
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
const chain = (id: string) => {
    const c = getBridgeChain(id)
    if (!c) throw new Error(id)
    return c
}
const WETH_E_ASSET = { chainId: 'evm:43114', address: WETH_E, symbol: 'WETH.e', decimals: 18 }

/** Shaped like the live bridge_settings.json (trimmed to what matters). */
const settings = (over: any = {}) => ({
    critical: Object.assign(
        {
            addressBlocklist: [],
            disableFrontend: false,
            operationMode: 'normal',
            walletAddresses: { avalanche: '0xeb1bb70123b2f43419d070d7fde5618971cc2f8f', ethereum: BRIDGE_ETH_WALLET },
            assets: { WETH: { wrappedContractAddress: '0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab', nativeContractAddress: WETH_ETHEREUM.toLowerCase(), denomination: 18 } },
        },
        over
    ),
    nonCritical: {
        unwrapFeeApproximation: { WETH: { minimumFeeAmount: '8152363720167413', maximumFeeAmount: '8152363720167413', feePercentage: 1, feePercentageDecimals: 1 } },
    },
})

const req = (amount: string, recipient = ME) => ({
    from: WETH_E_ASSET,
    toChain: chain('evm:1'),
    amount: BigInt(amount),
    sender: ME,
    recipient,
})

beforeEach(() => {
    http.get.mockReset()
    __resetAvalancheBridgeSettings()
})

describe('routing', () => {
    afterEach(() => ['avalanche-bridge', 'wormhole'].forEach((id) => setProviderEnabled(id, true)))

    it('takes WETH.e to Ethereum through the Avalanche Bridge instead of Wormhole', () => {
        expect(providersFor(WETH_E_ASSET, chain('evm:1')).map((p) => p.id)).toEqual(['avalanche-bridge'])
        // Other pairs are untouched.
        expect(providersFor(WETH_E_ASSET, chain('evm:8453')).map((p) => p.id)).toEqual(['wormhole'])
        expect(providersFor(nativeAsset(chain('evm:43114')), chain('evm:1')).map((p) => p.id)).toEqual(['wormhole', 'thorchain'])
    })

    it('falls back to Wormhole if the Avalanche Bridge is switched off in Settings', () => {
        setProviderEnabled('avalanche-bridge', false)
        expect(providersFor(WETH_E_ASSET, chain('evm:1')).map((p) => p.id)).toEqual(['wormhole'])
    })
})

describe('settings and quotes', () => {
    it('reads the fee from the bridge settings: 0.1% clamped to the min/max', () => {
        const s = parseSettings(settings())
        expect(s.feeFor(BigInt('131700000000000000')).toString()).toBe('8152363720167413')
        const ranged = settings()
        ranged.nonCritical.unwrapFeeApproximation.WETH = { minimumFeeAmount: '1000', maximumFeeAmount: '1000000000000000000', feePercentage: 1, feePercentageDecimals: 1 }
        expect(parseSettings(ranged).feeFor(BigInt('100000000000000000000')).toString()).toBe('100000000000000000') // 0.1% of 100
        expect(s.ethereumWallet).toBe(BRIDGE_ETH_WALLET)
    })

    it('quotes WETH on Ethereum: the amount minus the fee, at my own address', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req('131700000000000000'))
        expect(String(http.get.mock.calls[0][0])).toMatch(/bridge_settings\.json$/)
        expect(q.routeName).toBe('Avalanche Bridge')
        expect(q.receive).toMatchObject({ asset: { address: WETH_ETHEREUM, symbol: 'WETH' }, amount: BigInt('123547636279832587') })
        expect(q.fees[0]).toMatchObject({ amount: BigInt('8152363720167413'), paidAs: 'deducted' })
        expect(q.warnings[0]).toMatch(/Arrives as WETH/)
    })

    it('refuses another recipient, amounts under the fee, a paused bridge and blocked senders', async () => {
        http.get.mockResolvedValue({ data: settings() })
        await expect(avalancheBridgeProvider.quote(req('131700000000000000', '0x0000000000000000000000000000000000000001'))).rejects.toThrow(/pays out to the address that sends/)
        await expect(avalancheBridgeProvider.quote(req('8000000000000000'))).rejects.toThrow(/send more than that/)
        __resetAvalancheBridgeSettings()
        http.get.mockResolvedValue({ data: settings({ operationMode: 'maintenance' }) })
        await expect(avalancheBridgeProvider.quote(req('131700000000000000'))).rejects.toThrow(/paused/)
        __resetAvalancheBridgeSettings()
        http.get.mockResolvedValue({ data: settings({ addressBlocklist: [ME.toLowerCase()] }) })
        await expect(avalancheBridgeProvider.quote(req('131700000000000000'))).rejects.toThrow(/does not accept/)
    })

    it('tries the next settings mirror when one fails', async () => {
        http.get.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data: settings() })
        await avalancheBridgeProvider.quote(req('131700000000000000'))
        expect(http.get).toHaveBeenCalledTimes(2)
        expect(http.get.mock.calls[0][0]).not.toBe(http.get.mock.calls[1][0])
    })
})

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
                return '0xsent'
            }),
            waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, status: true, contractAddress: null })),
        } as any,
    }
}

describe('sending and tracking', () => {
    it('sends unwrap(amount, 0) on the WETH.e contract — the call real bridge transfers make', async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req('131700000000000000'))
        const { signer, sent } = fakeSigner(43114)
        const t = await avalancheBridgeProvider.execute(q, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(WETH_E)
        expect(sent[0].data.slice(0, 10)).toBe('0x6e286671')
        const [amount, bridgeChain] = Object.values(new Web3().eth.abi.decodeParameters(['uint256', 'uint256'], '0x' + sent[0].data.slice(10))) as string[]
        expect([amount, bridgeChain]).toEqual(['131700000000000000', '0'])
        expect(t).toMatchObject({ sourceTxHash: '0xsent', status: 'in_transit', toSymbol: 'WETH' })
        expect(t.data.ethereumWallet).toBe(BRIDGE_ETH_WALLET)
    })

    const sentTransfer = async () => {
        http.get.mockResolvedValue({ data: settings() })
        const q = await avalancheBridgeProvider.quote(req('131700000000000000'))
        return newTransfer(q, '0xsent', { ethereumWallet: BRIDGE_ETH_WALLET, sentAt: Date.now() })
    }

    it('finds the WETH payout from the bridge wallet on Ethereum', async () => {
        const t = await sentTransfer()
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
        expect(done.data.receivedWeth).toBe('123540000000000000')
    })

    it('stays in transit until the payout appears, ignoring old payouts', async () => {
        const t = await sentTransfer()
        http.get.mockResolvedValue({
            data: { items: [{ from: { hash: BRIDGE_ETH_WALLET }, total: { value: '123540000000000000' }, timestamp: '2020-01-01T00:00:00Z', transaction_hash: '0xold' }] },
        })
        expect((await avalancheBridgeProvider.refresh(t)).status).toBe('in_transit')
    })

    it('offers an optional WETH → ETH unwrap on Ethereum once it has arrived', async () => {
        const t = Object.assign(await sentTransfer(), { status: 'completed' as const })
        const f = avalancheBridgeProvider.followUp!
        expect(f.available(t)).toBe(false) // nothing received yet
        const arrived = Object.assign({}, t, { data: Object.assign({}, t.data, { receivedWeth: '123540000000000000' }) })
        expect(f.available(arrived)).toBe(true)
        const { signer, sent } = fakeSigner(1)
        const after = await f.run(arrived, { evm: () => signer, solana: () => null, bitcoin: () => null })
        expect(sent[0].to).toBe(WETH_ETHEREUM)
        expect(sent[0].data).toBe(new Web3().eth.abi.encodeFunctionCall({ name: 'withdraw', type: 'function', inputs: [{ name: 'wad', type: 'uint256' }] } as any, ['123540000000000000']))
        expect(after.data.unwrapTxHash).toBe('0xsent')
        expect(f.available(after)).toBe(false)
    })
})
