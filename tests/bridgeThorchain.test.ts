/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * THORChain as a bridge provider: quote parsing (the memo's minimum-output
 * limit, the minimum amount in), sending from Bitcoin (OP_RETURN memo to the
 * vault) and from an EVM chain (router depositWithExpiry), and status
 * tracking. Responses are shaped like the live THORNode API's.
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

import { fromThorUnits, memoLimit, thorchainProvider, toThorUnits } from '@/bridge/thorchain/provider'
import { getBridgeChain } from '@/bridge/chains'
import { nativeAsset } from '@/bridge/assets'

const chain = (id: string) => {
    const c = getBridgeChain(id)
    if (!c) throw new Error(`missing chain ${id}`)
    return c
}
const ME_EVM = '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537'
const ME_BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'
const ROUTER = '0x00dc6100103BC402d490aEE3F9a5560cBd91f1d4'
const BTC_VAULT = 'bc1qvault000000000000000000000000000000000'
const EVM_VAULT = '0x3dc79a0000000000000000000000000000000001'

const expiry = () => Math.floor(Date.now() / 1000) + 900

function btcToAvaxQuote() {
    return {
        inbound_address: BTC_VAULT,
        memo: `=:a:${ME_EVM}:7691594947/1/0`,
        expiry: expiry(),
        recommended_gas_rate: '4',
        recommended_min_amount_in: '20000',
        expected_amount_out: '7769287826',
        fees: { asset: 'AVAX.AVAX', outbound: '1000000', liquidity: '5000000', total: '6200000' },
        total_swap_seconds: 1260,
        warning: 'Do not cache this response. Do not send funds after the expiry.',
    }
}

beforeEach(() => http.get.mockReset())

describe('units and memo', () => {
    it('converts to and from THORChain’s 1e8 units', () => {
        expect(toThorUnits(BigInt('1500000000000000000'), 18)).toBe(BigInt(150000000))
        expect(fromThorUnits(BigInt(150000000), 18)).toBe(BigInt('1500000000000000000'))
        expect(toThorUnits(BigInt(12345), 8)).toBe(BigInt(12345))
    })

    it('reads the minimum-output limit from a swap memo', () => {
        expect(memoLimit(`=:a:${ME_EVM}:7691594947/1/0`)).toBe(BigInt(7691594947))
        expect(memoLimit(`=:b:${ME_BTC}:0/1/0`)).toBe(BigInt(0))
        expect(memoLimit(`=:b:${ME_BTC}`)).toBeNull()
    })

    it('serves native coins between Bitcoin and its EVM chains, mainnet only', () => {
        const btc = nativeAsset(chain('bitcoin:mainnet'))
        expect(thorchainProvider.supports(btc, chain('evm:43114'))).toBe(true)
        expect(thorchainProvider.supports(btc, chain('evm:8453'))).toBe(true)
        expect(thorchainProvider.supports(btc, chain('solana:mainnet-beta'))).toBe(false)
        expect(thorchainProvider.supports(btc, chain('bitcoin:mainnet'))).toBe(false)
        expect(thorchainProvider.supports(nativeAsset(chain('evm:43113')), chain('evm:11155111'))).toBe(false)
        const token = { chainId: 'evm:43114', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 }
        expect(thorchainProvider.supports(token, chain('bitcoin:mainnet'))).toBe(false)
    })
})

describe('quote', () => {
    const req = () => ({
        from: nativeAsset(chain('bitcoin:mainnet')),
        toChain: chain('evm:43114'),
        amount: BigInt(1000000),
        sender: ME_BTC,
        recipient: ME_EVM,
    })

    it('asks with a 1% liquidity tolerance and turns the answer into a quote', async () => {
        http.get.mockResolvedValue({ data: btcToAvaxQuote() })
        const q = await thorchainProvider.quote(req())
        const [url, opts] = http.get.mock.calls[0]
        expect(url).toMatch(/\/thorchain\/quote\/swap$/)
        expect(opts.params).toMatchObject({
            from_asset: 'BTC.BTC',
            to_asset: 'AVAX.AVAX',
            amount: '1000000',
            destination: ME_EVM,
            liquidity_tolerance_bps: 100,
        })
        // AVAX has 18 decimals; THORChain answers in 1e8.
        expect(q.receive.amount).toBe(BigInt('77692878260000000000'))
        expect(q.minReceive).toBe(BigInt('76915949470000000000'))
        expect(q.receive.kind).toBe('native')
        expect(q.needsClaim).toBe(false)
        expect(q.etaSeconds).toBe(1260)
        expect(q.fees[0]).toMatchObject({ amount: BigInt('62000000000000000'), symbol: 'AVAX', paidAs: 'deducted' })
        // The boilerplate "do not cache" warning is not shown to users.
        expect(q.warnings.join(' ')).not.toMatch(/cache/)
    })

    it('refuses amounts under THORChain’s recommended minimum', async () => {
        http.get.mockResolvedValue({ data: { ...btcToAvaxQuote(), recommended_min_amount_in: '2000000' } })
        await expect(thorchainProvider.quote(req())).rejects.toThrow(/minimum for this swap is 0.02 BTC/)
    })

    it('passes THORChain’s own error through, without trying another node', async () => {
        http.get.mockRejectedValue({ response: { status: 400, data: { message: 'trading is halted' } } })
        await expect(thorchainProvider.quote(req())).rejects.toThrow('trading is halted')
        expect(http.get).toHaveBeenCalledTimes(1)
    })

    it('falls back to the next node when one is unreachable', async () => {
        http.get.mockRejectedValueOnce(new Error('ENOTFOUND')).mockResolvedValueOnce({ data: btcToAvaxQuote() })
        await thorchainProvider.quote(req())
        expect(http.get).toHaveBeenCalledTimes(2)
        expect(http.get.mock.calls[1][0]).not.toBe(http.get.mock.calls[0][0])
    })
})

describe('execute', () => {
    it('sends BTC to the vault with the memo, after refreshing spendable outputs', async () => {
        http.get.mockResolvedValue({ data: btcToAvaxQuote() })
        const q = await thorchainProvider.quote({
            from: nativeAsset(chain('bitcoin:mainnet')),
            toChain: chain('evm:43114'),
            amount: BigInt(1000000),
            sender: ME_BTC,
            recipient: ME_EVM,
        })
        const order: string[] = []
        const wallet = {
            isReadonly: false,
            refresh: jest.fn(async () => void order.push('refresh')),
            send: jest.fn(async () => {
                order.push('send')
                return 'b'.repeat(64)
            }),
        }
        const signers = { evm: () => null, solana: () => null, bitcoin: () => wallet as any }
        const t = await thorchainProvider.execute(q, signers)
        expect(order).toEqual(['refresh', 'send'])
        expect(wallet.send).toHaveBeenCalledWith({
            to: BTC_VAULT,
            amountSats: 1000000,
            feeRate: 4,
            memo: `=:a:${ME_EVM}:7691594947/1/0`,
        })
        expect(t).toMatchObject({ id: `thorchain:${'b'.repeat(64)}`, status: 'in_transit', toChainId: 'evm:43114' })
    })

    it('deposits AVAX through the router with the amount as value', async () => {
        http.get.mockResolvedValue({
            data: {
                ...btcToAvaxQuote(),
                inbound_address: EVM_VAULT,
                router: ROUTER,
                memo: `=:b:${ME_BTC}:99000/1/0`,
                expected_amount_out: '100000',
                fees: { total: '1000' },
            },
        })
        const amount = BigInt('2000000000000000000')
        const q = await thorchainProvider.quote({
            from: nativeAsset(chain('evm:43114')),
            toChain: chain('bitcoin:mainnet'),
            amount,
            sender: ME_EVM,
            recipient: ME_BTC,
        })
        expect(http.get.mock.calls[0][1].params.amount).toBe('200000000')
        const sent: any[] = []
        const signer = {
            reader: () => new Web3(),
            assertOnChain: jest.fn(async () => {}),
            estimateGas: jest.fn(async () => 90_000),
            send: jest.fn(async (r: any) => {
                sent.push(r)
                return '0xdeposit'
            }),
            waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, status: true, contractAddress: null })),
        }
        const t = await thorchainProvider.execute(q, { evm: () => signer as any, solana: () => null, bitcoin: () => null })
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(ROUTER)
        expect(sent[0].value.toString()).toBe(amount.toString())
        expect(sent[0].gasLimit).toBe(90_000)
        const decoded = new Web3().eth.abi.decodeParameters(
            ['address', 'address', 'uint256', 'string', 'uint256'],
            '0x' + sent[0].data.slice(10)
        )
        expect(sent[0].data.slice(0, 10)).toBe(new Web3().eth.abi.encodeFunctionSignature('depositWithExpiry(address,address,uint256,string,uint256)'))
        expect(decoded[0].toLowerCase()).toBe(EVM_VAULT)
        expect(decoded[1]).toBe('0x0000000000000000000000000000000000000000')
        expect(decoded[2]).toBe(amount.toString())
        expect(decoded[3]).toBe(`=:b:${ME_BTC}:99000/1/0`)
        expect(t.sourceTxHash).toBe('0xdeposit')
    })

    it('refuses an expired quote', async () => {
        http.get.mockResolvedValue({ data: { ...btcToAvaxQuote(), expiry: Math.floor(Date.now() / 1000) + 30 } })
        const q = await thorchainProvider.quote({
            from: nativeAsset(chain('bitcoin:mainnet')),
            toChain: chain('evm:43114'),
            amount: BigInt(1000000),
            sender: ME_BTC,
            recipient: ME_EVM,
        })
        await expect(thorchainProvider.execute(q, { evm: () => null, solana: () => null, bitcoin: () => null })).rejects.toThrow(/expired/)
    })
})

describe('refresh', () => {
    const transfer = (from: string, to: string, fromAsset: string) => ({
        id: 'thorchain:0xabc',
        providerId: 'thorchain',
        routeId: 'thorchain:swap',
        routeName: 'THORChain swap',
        fromChainId: from,
        toChainId: to,
        fromSymbol: 'AVAX',
        toSymbol: 'BTC',
        fromDecimals: 18,
        toDecimals: 8,
        amountIn: '1',
        expectedOut: '1',
        sender: ME_EVM,
        recipient: ME_BTC,
        sourceTxHash: '0xabc',
        status: 'in_transit' as const,
        createdAt: 1,
        updatedAt: 1,
        data: { fromAsset },
    })
    const done = { inbound_observed: { completed: true }, inbound_finalised: { completed: true }, swap_status: { pending: false }, outbound_signed: { completed: true } }

    it('looks the hash up without 0x, upper-cased, and finds the coin payout past the RUNE fee output', async () => {
        http.get.mockResolvedValue({
            data: {
                stages: done,
                out_txs: [
                    { id: '0'.repeat(64), chain: 'THOR', memo: 'OUT:ABC' },
                    { id: 'DEF', chain: 'BTC', memo: 'OUT:ABC' },
                ],
            },
        })
        const t = await thorchainProvider.refresh(transfer('evm:43114', 'bitcoin:mainnet', 'AVAX.AVAX'))
        expect(http.get.mock.calls[0][0]).toMatch(/\/thorchain\/tx\/status\/ABC$/)
        expect(t).toMatchObject({ status: 'completed', destTxHash: 'def' })
    })

    it('reports a refund paid back on the source chain', async () => {
        http.get.mockResolvedValue({ data: { stages: done, out_txs: [{ id: 'FED', chain: 'AVAX', memo: 'REFUND:ABC' }] } })
        const t = await thorchainProvider.refresh(transfer('evm:43114', 'bitcoin:mainnet', 'AVAX.AVAX'))
        expect(t).toMatchObject({ status: 'refunded', destTxHash: '0xfed' })
    })

    it('stays in transit while THORChain has not seen it or is still working', async () => {
        http.get.mockRejectedValueOnce({ response: { status: 404, data: {} } })
        expect((await thorchainProvider.refresh(transfer('evm:43114', 'bitcoin:mainnet', 'AVAX.AVAX'))).status).toBe('in_transit')
        http.get.mockResolvedValueOnce({ data: { stages: { inbound_observed: { completed: true }, inbound_finalised: { completed: true }, swap_status: { pending: true } } } })
        const t = await thorchainProvider.refresh(transfer('evm:43114', 'bitcoin:mainnet', 'AVAX.AVAX'))
        expect(t).toMatchObject({ status: 'in_transit', statusDetail: 'Swapping.' })
    })
})
