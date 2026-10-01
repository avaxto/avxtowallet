/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * PHAR Swap. WAVAX → AVAX must be the exact unwrap phar.gg sent (captured in
 * tmp/phar/swap/unwrap-wavax-avax-ext.har: withdraw(23.264… WAVAX) to the WAVAX
 * contract, no value); other pairs go through Kyber's router, limited to
 * Pharaoh's pools on request, with an exact-amount approval and nothing ever
 * sent to an unknown router.
 */
import { flushPromises, mount } from '@vue/test-utils'
import Web3 from 'web3'

import { BN } from '@/avalanche'

const ME = '0xb57904252bce32f98cd7c9420496c76f5b2b485f'
const USDC = { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 }
/** The captured unwrap: amount and the exact calldata the extension signed. */
const CAPTURED_AMOUNT = new BN('142da7e383a5935fb', 16) // 23.264045605097911803 WAVAX
const CAPTURED_DATA = '0x2e1a7d4d00000000000000000000000000000000000000000000000142da7e383a5935fb'

const http = { get: jest.fn(), post: jest.fn() }
jest.mock('axios', () => {
    // Other modules loaded along the way create instances with interceptors.
    const instance = () => ({
        get: jest.fn(async () => ({ data: {} })),
        post: jest.fn(async () => ({ data: {} })),
        interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
        defaults: { headers: { common: {} } },
    })
    const api = {
        get: (...a: any[]) => http.get(...a),
        post: (...a: any[]) => http.post(...a),
        create: instance,
        interceptors: { request: { use: () => 0 }, response: { use: () => 0 } },
        defaults: { headers: { common: {} } },
    }
    return { __esModule: true, default: api, ...api }
})

const realSwap = jest.requireActual('@/js/PharSwap')
const { AVAX_TOKEN, WAVAX_TOKEN, KYBER_ROUTER, PHARAOH_SOURCES, executeSwap, quoteSwap, swapKind } = realSwap

function fakeSigner(opts: { chainId?: number; allowance?: string; balances?: Record<string, string> } = {}) {
    const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0')
    const provider = {
        send(payload: any, cb: (e: any, r?: any) => void) {
            const reply = (result: any) => cb(null, { jsonrpc: '2.0', id: payload.id, result })
            if (payload.method === 'eth_getBalance') return reply('0x' + new BN(opts.balances?.native ?? '0').toString(16))
            if (payload.method !== 'eth_call') return reply('0x0')
            const data: string = payload.params[0].data
            if (data.startsWith('0xdd62ed3e')) return reply('0x' + word(new BN(opts.allowance ?? '0').toString(16)))
            if (data.startsWith('0x70a08231')) {
                const token = payload.params[0].to.toLowerCase()
                return reply('0x' + word(new BN(opts.balances?.[token] ?? '0').toString(16)))
            }
            return reply('0x')
        },
    }
    const sent: any[] = []
    const signer = {
        network: { evmChainId: opts.chainId ?? 43114, name: opts.chainId ? 'Ethereum' : 'Avalanche C-Chain' },
        address: ME,
        authSubject: {},
        reader: () => new Web3(provider as any),
        assertOnChain: jest.fn(async () => {}),
        estimateGas: jest.fn(async () => 43_532),
        getNonce: jest.fn(async () => 232),
        send: jest.fn(async (req: any) => {
            sent.push(req)
            return `0xhash${sent.length}`
        }),
        waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, contractAddress: null, status: true })),
    }
    return { signer: signer as any, sent }
}

beforeEach(() => {
    http.get.mockReset()
    http.post.mockReset()
})

describe('wrap / unwrap', () => {
    it('treats WAVAX ↔ AVAX as an unwrap/wrap, everything else as a trade', () => {
        expect(swapKind(WAVAX_TOKEN, AVAX_TOKEN)).toBe('unwrap')
        expect(swapKind(AVAX_TOKEN, WAVAX_TOKEN)).toBe('wrap')
        expect(swapKind(WAVAX_TOKEN, USDC)).toBe('kyber')
    })

    it("unwraps with exactly the transaction phar.gg sent", async () => {
        const q = await quoteSwap(WAVAX_TOKEN, AVAX_TOKEN, CAPTURED_AMOUNT, { pharaohOnly: true })
        expect(q.amountOut.toString()).toBe(CAPTURED_AMOUNT.toString()) // 1:1
        expect(http.get).not.toHaveBeenCalled() // no aggregator involved

        const { signer, sent } = fakeSigner()
        await executeSwap(signer, q, 50)
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(WAVAX_TOKEN.address)
        expect(sent[0].data).toBe(CAPTURED_DATA)
        expect(sent[0].value).toBeUndefined()
    })

    it('wraps with deposit() and the AVAX as value', async () => {
        const amount = new BN('1000000000000000000')
        const q = await quoteSwap(AVAX_TOKEN, WAVAX_TOKEN, amount, { pharaohOnly: true })
        const { signer, sent } = fakeSigner()
        await executeSwap(signer, q, 50)
        expect(sent[0].to).toBe(WAVAX_TOKEN.address)
        expect(sent[0].data).toBe('0xd0e30db0')
        expect(sent[0].value.toString()).toBe(amount.toString())
    })

    it('refuses on another chain', async () => {
        const q = await quoteSwap(WAVAX_TOKEN, AVAX_TOKEN, CAPTURED_AMOUNT, { pharaohOnly: true })
        const { signer, sent } = fakeSigner({ chainId: 1 })
        await expect(executeSwap(signer, q, 50)).rejects.toThrow(/Avalanche C-Chain/)
        expect(sent).toHaveLength(0)
    })
})

const routeSummary = {
    tokenIn: WAVAX_TOKEN.address.toLowerCase(),
    amountIn: '1000000000000000000',
    amountInUsd: '10.95',
    tokenOut: USDC.address.toLowerCase(),
    amountOut: '10916297',
    amountOutUsd: '10.94',
    route: [[{ exchange: 'pharaoh-lb', pool: '0x8ac5707f8d4bde1d771d34c7afd81c3922b73379' }]],
}

describe('trades through Kyber', () => {
    it('limits the route to Pharaoh pools when asked, and reads the route', async () => {
        http.get.mockResolvedValue({ data: { code: 0, data: { routeSummary } } })
        const q = await quoteSwap(WAVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: true })

        const [url, cfg] = http.get.mock.calls[0]
        expect(url).toMatch(/aggregator-api\.kyberswap\.com\/avalanche\/api\/v1\/routes$/)
        expect(cfg.params.includedSources).toBe(PHARAOH_SOURCES.join(','))
        expect(q.amountOut.toString()).toBe('10916297')
        expect(q.exchanges).toEqual(['pharaoh-lb'])

        await quoteSwap(WAVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: false })
        expect(http.get.mock.calls[1][1].params.includedSources).toBeUndefined()
    })

    it('approves the exact amount, then sends the built swap to Kyber\'s router', async () => {
        http.get.mockResolvedValue({ data: { code: 0, data: { routeSummary } } })
        http.post.mockResolvedValue({
            data: { code: 0, data: { amountIn: routeSummary.amountIn, data: '0xe21fd0e9abc', routerAddress: KYBER_ROUTER, transactionValue: '0' } },
        })
        const q = await quoteSwap(WAVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: true })
        const { signer, sent } = fakeSigner({ allowance: '0' })
        const res = await executeSwap(signer, q, 50)

        expect(http.post.mock.calls[0][1]).toMatchObject({ sender: ME, recipient: ME, slippageTolerance: 50 })
        expect(sent).toHaveLength(2)
        // approve(router, exact amount) — never unlimited.
        expect(sent[0].to).toBe(WAVAX_TOKEN.address)
        expect(sent[0].data.slice(0, 10)).toBe('0x095ea7b3')
        expect(sent[0].data).toContain(KYBER_ROUTER.slice(2).toLowerCase())
        expect(sent[0].data.endsWith(new BN(routeSummary.amountIn).toString(16).padStart(64, '0'))).toBe(true)
        expect(sent[1]).toMatchObject({ to: KYBER_ROUTER, data: '0xe21fd0e9abc' })
        expect(res.approveTxHash).toBe('0xhash1')
    })

    it('skips the approval when the allowance already covers it', async () => {
        http.get.mockResolvedValue({ data: { code: 0, data: { routeSummary } } })
        http.post.mockResolvedValue({
            data: { code: 0, data: { amountIn: routeSummary.amountIn, data: '0xe21f', routerAddress: KYBER_ROUTER } },
        })
        const q = await quoteSwap(WAVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: true })
        const { signer, sent } = fakeSigner({ allowance: '5000000000000000000' })
        await executeSwap(signer, q, 50)
        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(KYBER_ROUTER)
    })

    it('refuses calldata for an unknown router, or for a different amount', async () => {
        http.get.mockResolvedValue({ data: { code: 0, data: { routeSummary } } })
        const q = await quoteSwap(WAVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: true })

        http.post.mockResolvedValue({ data: { code: 0, data: { amountIn: routeSummary.amountIn, data: '0xbad', routerAddress: '0x000000000000000000000000000000000000beef' } } })
        let s = fakeSigner()
        await expect(executeSwap(s.signer, q, 50)).rejects.toThrow(/unknown router/)
        expect(s.sent).toHaveLength(0)

        http.post.mockResolvedValue({ data: { code: 0, data: { amountIn: '999', data: '0xbad', routerAddress: KYBER_ROUTER } } })
        s = fakeSigner()
        await expect(executeSwap(s.signer, q, 50)).rejects.toThrow(/does not match/)
        expect(s.sent).toHaveLength(0)
    })

    it('sends native AVAX as value when selling AVAX', async () => {
        const avaxRoute = { ...routeSummary, tokenIn: AVAX_TOKEN.address }
        http.get.mockResolvedValue({ data: { code: 0, data: { routeSummary: avaxRoute } } })
        http.post.mockResolvedValue({
            data: { code: 0, data: { amountIn: avaxRoute.amountIn, data: '0xe21f', routerAddress: KYBER_ROUTER, transactionValue: avaxRoute.amountIn } },
        })
        const q = await quoteSwap(AVAX_TOKEN, USDC, new BN('1000000000000000000'), { pharaohOnly: true })
        const { signer, sent } = fakeSigner()
        await executeSwap(signer, q, 50)
        expect(sent).toHaveLength(1) // nothing to approve for native AVAX
        expect(sent[0].value.toString()).toBe(avaxRoute.amountIn)
    })

    it('explains a pair with no Pharaoh route', async () => {
        http.get.mockResolvedValue({ data: { code: 4008, message: 'route not found' } })
        await expect(quoteSwap(WAVAX_TOKEN, USDC, new BN(1), { pharaohOnly: true })).rejects.toThrow(/No route through Pharaoh pools/)
    })
})

// ─── The page ──────────────────────────────────────────────────────────────

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))
jest.mock('@/stores', () => ({ useOfflineSigningStore: () => ({ hasRecords: false, records: [], clearRecords: jest.fn() }) }))
jest.mock('@/js/security/authorize', () => ({
    authorizeBatch: (_w: unknown, _r: string, fn: () => Promise<unknown>) => fn(),
    SessionAuthCancelled: class extends Error {},
}))
const executeMock = jest.fn()
jest.mock('@/js/PharSwap', () => ({
    ...jest.requireActual('@/js/PharSwap'),
    executeSwap: (...a: any[]) => executeMock(...a),
}))

import PharSwap from '@/views/wallet/PharSwap.vue'

describe('the PHAR Swap page', () => {
    const stubs = {
        fa: true,
        RegistryCheck: true,
        SignOnlyToggle: true,
        SignedTxExport: true,
        CopyText: { template: '<span><slot /></span>' },
        'v-btn': {
            props: ['disabled', 'loading'],
            emits: ['click'],
            template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
        },
    }

    beforeEach(() => {
        executeMock.mockReset().mockResolvedValue({ txHash: '0xdone', offline: false, approveTxHash: null })
        http.get.mockResolvedValue({ data: [] }) // token list
        signerRef.current = fakeSigner({
            balances: { [WAVAX_TOKEN.address.toLowerCase()]: CAPTURED_AMOUNT.toString(), native: '5000000000000000000' },
        }).signer
    })

    it('defaults to WAVAX → AVAX', async () => {
        const w = mount(PharSwap, { global: { stubs } })
        await flushPromises()
        const tokens = w.findAll('.token_btn').map((b) => b.text().replace(/\s+▾/, ''))
        expect(tokens).toEqual(['WAVAX', 'AVAX'])
        expect(w.text()).toContain('23.264046 WAVAX in this wallet')
        w.unmount()
    })

    it('"Swap all" unwraps the whole WAVAX balance in one go', async () => {
        const w = mount(PharSwap, { global: { stubs } })
        await flushPromises()
        const button = w.findAll('button.v_btn').find((b) => b.text() === 'Swap all')!
        await button.trigger('click')
        await flushPromises()

        expect(executeMock).toHaveBeenCalledTimes(1)
        const [, q] = executeMock.mock.calls[0]
        expect(q.kind).toBe('unwrap')
        expect(q.amountIn.toString()).toBe(CAPTURED_AMOUNT.toString())
        expect(w.text()).toContain('Swapped 23.264046 WAVAX → 23.264046 AVAX')
        expect(w.text()).toContain('0xdone')
        w.unmount()
    })
})
