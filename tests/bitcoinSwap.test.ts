/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin swaps:
 *  - the Lombard destination signature (the captured one recovers to the
 *    captured C-Chain address) and deposit-address requests;
 *  - BTC.b → BTC: the approve + redeemForBtc calldata, byte for byte equal
 *    to what Core signed;
 *  - the quick swaps chaining the steps, and status tracking.
 */
import { webcrypto } from 'crypto'
import { utils } from 'ethers'
import Web3 from 'web3'

const http = { get: jest.fn(), post: jest.fn() }
jest.mock('axios', () => {
    const api: any = {
        get: (...a: any[]) => http.get(...a),
        post: (...a: any[]) => http.post(...a),
        interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
        defaults: { headers: { common: {} } },
    }
    api.create = () => api
    // The phrase wallet's background address scan: no network in tests.
    api.request = () => new Promise(() => {})
    return { __esModule: true, default: api, ...api }
})
const swap = { quote: jest.fn(), execute: jest.fn() }
jest.mock('@/js/PharSwap', () => ({
    ...jest.requireActual('@/js/PharSwap'),
    quoteSwap: (...a: any[]) => swap.quote(...a),
    executeSwap: (...a: any[]) => swap.execute(...a),
}))
jest.mock('@/router', () => ({ __esModule: true, default: { push: jest.fn() } }))
jest.mock('@/js/security/authorize', () => ({ authorizeBatch: (_w: unknown, _r: string, fn: () => unknown) => fn() }))

import { BN } from '@/avalanche'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import {
    BTCB,
    BTCB_ADAPTER,
    destinationMessage,
    depositAddressFor,
    depositStatus,
    existingDepositAddress,
    outputScriptFor,
    redeemStatus,
    redeemToBitcoin,
} from '@/bitcoinSwap/lombard'
import { btcSwaps, continueQuickBtcToAvax, refreshSwap, runBtcToBtcb, runQuickAvaxToBtc, runQuickBtcToAvax, saveSwap } from '@/bitcoinSwap/flows'

const ME = '0xB57904252BCE32F98CD7c9420496c76F5b2b485F'
const MY_BTC = 'bc1q9pa6ahh7s5d5s2fmywt6pjpgkeksj4kvkwxh0t'
const ROUTER = '0x9eCe5fB1aB62d9075c4ec814b321e24D8EA021ac'
const DEPOSIT_ADDR = 'bc1qzxjfwk2x7v03jf2zkf6m6xyqj6rv58d8mds78n'
const mainnet = getBitcoinNetworkById('mainnet')!

const CAPTURED_APPROVE =
    '0x095ea7b300000000000000000000000085d1d52e11290f174444d21c2a167bedbe36e4d20000000000000000000000000000000000000000000000000000000000094f58'
const CAPTURED_REDEEM =
    '0x37a9bdc9000000000000000000000000b57904252bce32f98cd7c9420496c76f5b2b485f00000000000000000000000085d1d52e11290f174444d21c2a167bedbe36e4d200000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000094f5800000000000000000000000000000000000000000000000000000000000000160014287baedefe851b48293b2397a0c828b66d0956cc00000000000000000000'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})
beforeEach(() => {
    http.get.mockReset()
    http.post.mockReset()
    swap.quote.mockReset()
    swap.execute.mockReset()
    btcSwaps.value = []
    localStorage.clear()
})

/** A C-Chain signer over a fake chain: balances, allowance and the router are served from `state`. */
function fakeSigner(state: { btcb: bigint; allowance: bigint; commission?: number; min?: number; enabled?: boolean }) {
    const word = (v: bigint | number | string) => BigInt(v).toString(16).padStart(64, '0')
    const sent: any[] = []
    const provider = {
        send(payload: any, cb: (e: any, r?: any) => void) {
            const reply = (result: any) => cb(null, { jsonrpc: '2.0', id: payload.id, result })
            if (payload.method === 'eth_getBalance') return reply('0x0')
            if (payload.method !== 'eth_call') return reply('0x0')
            const { to, data } = payload.params[0]
            const sel = data.slice(0, 10)
            if (to.toLowerCase() === BTCB_ADAPTER.toLowerCase() && sel === utils.id('getAssetRouter()').slice(0, 10)) return reply('0x' + ROUTER.slice(2).toLowerCase().padStart(64, '0'))
            if (sel === utils.id('toNativeCommission(address)').slice(0, 10)) return reply('0x' + word(state.commission ?? 10_000))
            if (sel === utils.id('tokenConfig(address)').slice(0, 10)) return reply('0x' + word(0) + word(state.min ?? 3_300) + word(state.enabled === false ? 0 : 1))
            if (sel === '0x70a08231') return reply('0x' + word(state.btcb))
            if (sel === '0xdd62ed3e') return reply('0x' + word(state.allowance))
            return reply('0x')
        },
    }
    const signer = {
        address: ME,
        authSubject: { me: true },
        network: { evmChainId: 43114, name: 'Avalanche C-Chain' },
        reader: () => new Web3(provider as any),
        assertOnChain: jest.fn(async () => {}),
        estimateGas: jest.fn(async () => 120_000),
        send: jest.fn(async (r: any) => {
            sent.push(r)
            return `0xtx${sent.length}`
        }),
        waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, status: true, contractAddress: null })),
        signPersonalMessage: jest.fn(async () => '0xsig'),
    }
    return { signer: signer as any, sent }
}

describe('Lombard deposit address', () => {
    it('is unlocked by signing "destination chain id is 43114" — the captured signature recovers to the captured address', () => {
        const captured =
            '0x61f16e83f12c2df414443b12202d40fa2ea83f7eb15142a9d46c363745d945b84b06f2f1bb59de496906403e87e0c1e6ddd12777fc5934c8bb97c59c363e5bad1b'
        expect(destinationMessage()).toBe('destination chain id is 43114')
        expect(utils.verifyMessage(destinationMessage(), captured)).toBe(ME)
    })

    it('reuses an existing deposit address for the BTC.b adapter', async () => {
        http.get.mockResolvedValue({
            data: {
                addresses: [
                    { btc_address: 'bc1qother', type: 'ADDRESS_TYPE_DEPOSIT', deposit_metadata: { to_address: ME.toLowerCase(), to_blockchain: 'DESTINATION_BLOCKCHAIN_ETHEREUM', token_address: BTCB_ADAPTER.toLowerCase() } },
                    { btc_address: DEPOSIT_ADDR, type: 'ADDRESS_TYPE_DEPOSIT', deposit_metadata: { to_address: ME.toLowerCase(), to_blockchain: 'DESTINATION_BLOCKCHAIN_AVALANCHE', token_address: BTCB_ADAPTER.toLowerCase() } },
                ],
            },
        })
        expect(await existingDepositAddress(ME)).toBe(DEPOSIT_ADDR)
        expect(http.get.mock.calls[0][0]).toBe(`/api/v1/address/destination/DESTINATION_BLOCKCHAIN_AVALANCHE/${ME}`)
        const { signer } = fakeSigner({ btcb: BigInt(0), allowance: BigInt(0) })
        expect(await depositAddressFor(signer)).toEqual({ address: DEPOSIT_ADDR, created: false })
        expect(signer.signPersonalMessage).not.toHaveBeenCalled()
    })

    it('creates one with the signed message when none exists', async () => {
        http.get.mockResolvedValue({ data: { addresses: [] } })
        http.post.mockResolvedValue({ data: { address: DEPOSIT_ADDR } })
        const { signer } = fakeSigner({ btcb: BigInt(0), allowance: BigInt(0) })
        expect(await depositAddressFor(signer)).toEqual({ address: DEPOSIT_ADDR, created: true })
        expect(signer.signPersonalMessage).toHaveBeenCalledWith('destination chain id is 43114')
        expect(http.post).toHaveBeenCalledWith('/api/v1/address/generate', {
            to_address: ME,
            to_address_signature: '0xsig',
            to_chain: 'DESTINATION_BLOCKCHAIN_AVALANCHE',
            nonce: 0,
            token_address: BTCB_ADAPTER,
        })
    })
})

describe('BTC.b → BTC', () => {
    it('pays to the Bitcoin address’s own output script', () => {
        expect(outputScriptFor(MY_BTC, mainnet)).toBe('0x0014287baedefe851b48293b2397a0c828b66d0956cc')
        expect(() => outputScriptFor('0x1234', mainnet)).toThrow(/not a valid Bitcoin address/)
    })

    it('builds exactly the approve and redeemForBtc Core signed', async () => {
        const { signer, sent } = fakeSigner({ btcb: BigInt(700_000), allowance: BigInt(0) })
        const res = await redeemToBitcoin(signer, BigInt(610_136), MY_BTC, mainnet)
        expect(sent.map((s) => [s.to, s.data])).toEqual([
            [BTCB, CAPTURED_APPROVE],
            [ROUTER, CAPTURED_REDEEM],
        ])
        expect(res).toEqual({ approveTxHash: '0xtx1', txHash: '0xtx2' })
    })

    it('skips the approval when it is already enough, and refuses too-small, too-large or paused redeems', async () => {
        const ok = fakeSigner({ btcb: BigInt(700_000), allowance: BigInt(610_136) })
        await redeemToBitcoin(ok.signer, BigInt(610_136), MY_BTC, mainnet)
        expect(ok.sent).toHaveLength(1)
        await expect(redeemToBitcoin(fakeSigner({ btcb: BigInt(700_000), allowance: BigInt(0) }).signer, BigInt(13_000), MY_BTC, mainnet)).rejects.toThrow(/smallest redeem is 0.000133 BTC/)
        await expect(redeemToBitcoin(fakeSigner({ btcb: BigInt(100_000), allowance: BigInt(0) }).signer, BigInt(610_136), MY_BTC, mainnet)).rejects.toThrow(/You hold 0.001 BTC.b/)
        await expect(redeemToBitcoin(fakeSigner({ btcb: BigInt(700_000), allowance: BigInt(0), enabled: false }).signer, BigInt(610_136), MY_BTC, mainnet)).rejects.toThrow(/paused/)
    })
})

describe('status from Lombard', () => {
    it('reads deposit and redeem status in the shapes Lombard returns', async () => {
        http.get.mockResolvedValueOnce({
            data: { outputs: [{ txid: 'abc', notarization_status: 'NOTARIZATION_STATUS_PENDING', notarization_wait_dur: '1305' }] },
        })
        expect(await depositStatus(ME, 'abc')).toEqual({ found: true, notarization: 'NOTARIZATION_STATUS_PENDING', claimTx: undefined, waitSeconds: 1305 })
        http.get.mockResolvedValueOnce({
            data: {
                unstakes: [
                    {
                        tx_hash: '0xb60a8f972fb081df7535d17655527bb24120c4cbd13a8788846d983fe02d719f',
                        amount: '600136',
                        to_address: MY_BTC,
                        notarization_status: 'NOTARIZATION_STATUS_GMP_HANDLED',
                        session_state: 'SESSION_STATE_COMPLETED',
                    },
                ],
            },
        })
        expect(await redeemStatus(ME, '0xB60A8F972FB081DF7535D17655527BB24120C4CBD13A8788846D983FE02D719F')).toEqual({
            found: true,
            completed: true,
            amountSats: 600_136,
            toAddress: MY_BTC,
        })
    })
})

describe('quick swaps', () => {
    it('AVAX → BTC swaps, then redeems exactly the BTC.b that arrived', async () => {
        const state = { btcb: BigInt(5_000), allowance: BigInt(0) }
        const { signer, sent } = fakeSigner(state)
        swap.quote.mockResolvedValue({ kind: 'kyber', amountOut: new BN(610_136), amountIn: new BN(0) })
        swap.execute.mockImplementation(async () => {
            state.btcb += BigInt(610_000) // what really arrived
            return { txHash: '0xswap', offline: false, approveTxHash: null }
        })
        const rec = await runQuickAvaxToBtc(signer, { network: mainnet } as any, BigInt('50000000000000000000'), MY_BTC)
        expect(swap.quote.mock.calls[0][1]).toMatchObject({ symbol: 'BTC.b', address: BTCB })
        expect(swap.execute.mock.calls[0][2]).toBe(50)
        const redeem = sent.find((s) => s.data.startsWith('0x37a9bdc9'))
        const decoded: any = new Web3().eth.abi.decodeParameters(['address', 'address', 'bytes', 'uint256'], '0x' + redeem.data.slice(10))
        expect(decoded[3]).toBe('610000')
        expect(rec).toMatchObject({ status: 'waiting', kind: 'quick-avax-btc' })
        expect(rec.steps.map((s) => s.txHash)).toEqual(['0xswap', '0xtx1', '0xtx2'])
    })

    it('AVAX → BTC refuses amounts that would be under Lombard’s minimum, before swapping', async () => {
        const { signer } = fakeSigner({ btcb: BigInt(0), allowance: BigInt(0) })
        swap.quote.mockResolvedValue({ kind: 'kyber', amountOut: new BN(10_000), amountIn: new BN(0) })
        await expect(runQuickAvaxToBtc(signer, { network: mainnet } as any, BigInt('1000000000000000000'), MY_BTC)).rejects.toThrow(/minimum redeem/)
        expect(swap.execute).not.toHaveBeenCalled()
        expect(btcSwaps.value[0]).toMatchObject({ status: 'failed' })
    })

    it('BTC → AVAX deposits, waits for the mint, then swaps the minted BTC.b', async () => {
        http.get.mockImplementation(async (url: string) => {
            if (url.includes('/address/destination/')) return { data: { addresses: [] } }
            if (url.endsWith('/fee-estimates')) return { data: { '3': 4 } }
            return { data: {} }
        })
        http.post.mockResolvedValue({ data: { address: DEPOSIT_ADDR } })
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ '3': 4 }), text: async () => JSON.stringify({ '3': 4 }) })) as any
        const { signer } = fakeSigner({ btcb: BigInt(30_000), allowance: BigInt(0) })
        const wallet = {
            network: mainnet,
            isReadonly: false,
            getReceiveAddress: () => MY_BTC,
            refresh: jest.fn(async () => {}),
            send: jest.fn(async () => 'btctxid'),
        }
        const rec = await runQuickBtcToAvax(signer, wallet as any, BigInt(30_000))
        expect(wallet.send).toHaveBeenCalledWith({ to: DEPOSIT_ADDR, amountSats: 30_000, feeRate: 4 })
        expect(rec).toMatchObject({ status: 'waiting' })

        http.get.mockResolvedValueOnce({ data: { outputs: [{ txid: 'btctxid', notarization_status: 'NOTARIZATION_STATUS_SESSION_APPROVED', claim_tx: '0xmint' }] } })
        const ready = await refreshSwap(rec)
        expect(ready).toMatchObject({ status: 'ready' })
        expect(ready.steps[ready.steps.length - 1]).toMatchObject({ txHash: '0xmint' })

        swap.quote.mockResolvedValue({ kind: 'kyber', amountOut: new BN('2000000000000000000'), amountIn: new BN(30_000) })
        swap.execute.mockResolvedValue({ txHash: '0xtoavax', offline: false, approveTxHash: null })
        const done = await continueQuickBtcToAvax(signer, ready)
        expect(swap.quote.mock.calls[0][2].toString()).toBe('30000')
        expect(done).toMatchObject({ status: 'done' })
        expect(btcSwaps.value[0].id).toBe(rec.id)
    })

    it('refuses deposits under Lombard’s 0.0002 BTC minimum', async () => {
        const { signer } = fakeSigner({ btcb: BigInt(0), allowance: BigInt(0) })
        await expect(runBtcToBtcb(signer, { network: mainnet, isReadonly: false, getReceiveAddress: () => MY_BTC } as any, BigInt(10_000))).rejects.toThrow(/minimum is 0.0002 BTC/)
    })

    it('marks a plain redeem done once Lombard reports it completed', async () => {
        const rec: any = {
            id: 'r1', kind: 'btcb-btc', createdAt: 1, updatedAt: 1, status: 'waiting', detail: '', amountIn: '0.0061', symbolIn: 'BTC.b', symbolOut: 'BTC',
            evmAddress: ME, btcAddress: MY_BTC, steps: [], data: { redeemTx: '0xb60a' },
        }
        saveSwap(rec)
        http.get.mockResolvedValue({ data: { unstakes: [{ tx_hash: '0xB60A', amount: '600136', to_address: MY_BTC, session_state: 'SESSION_STATE_COMPLETED' }] } })
        expect(await refreshSwap(rec)).toMatchObject({ status: 'done', detail: `Paid out 0.00600136 BTC to ${MY_BTC}.` })
    })
})

describe('C-Chain message signing', () => {
    it('signs Lombard’s message from a phrase wallet so it recovers to the wallet’s C-Chain address', async () => {
        const { AuthScope, withAuthorization, __setPromptForTests, __resetSessionForTests } = jest.requireActual('@/js/security/session')
        const { default: MnemonicWallet } = jest.requireActual('@/js/wallets/MnemonicWallet')
        __resetSessionForTests()
        const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
        const wallet = await MnemonicWallet.create(phrase, 'pw')
        __setPromptForTests(async () => wallet.vault.deriveKey('pw'))
        const sig = await withAuthorization({ scope: AuthScope.SINGLE, reason: 't', vault: wallet.vault }, () => wallet.signEvmMessage(destinationMessage()))
        expect(utils.verifyMessage(destinationMessage(), sig).toLowerCase()).toBe(('0x' + wallet.getEvmAddress().replace(/^0x/, '')).toLowerCase())
    }, 30_000)
})
