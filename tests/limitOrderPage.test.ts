/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /wallet/limit end to end, with LI.FI mocked as a market: each quote's
 * expected output is the market's, and its enforced minimum follows from the
 * slippage asked for — as LI.FI's does. What is pinned: the order watches
 * below the limit, and only ever SIGNS a quote whose minimum covers it.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'
import { useAssetsStore } from '@/stores/assets'
import { useMainStore } from '@/stores/main'

const E18 = new BN('1000000000000000000')
const USDC = { address: '0x' + 'b9'.repeat(20), symbol: 'USDC', name: 'USD Coin', decimals: 6 }

/** The market: USDC (base units) per 10 AVAX. */
const market = { out: new BN(250_000_000) } // 25 USDC each
const quoteCalls: number[] = []
const executeSwap = jest.fn(async () => ({ txHash: '0xfill' }))

jest.mock('@/js/ArenaSwap', () => {
    const actual = jest.requireActual('@/js/ArenaSwap')
    return {
        ...actual,
        getQuote: jest.fn(async (p: any) => {
            quoteCalls.push(p.slippagePercent)
            const out = market.out
            // LI.FI's minimum: expected output less the slippage asked for.
            const min = out.muln(Math.round((100 - p.slippagePercent) * 100)).divn(10_000)
            return {
                fromAmount: p.amountInRaw.toString(),
                toAmount: out.toString(),
                toAmountMin: min.toString(),
                fromAmountUSD: 0,
                toAmountUSD: 0,
                priceImpact: null,
                approvalAddress: null,
                gasLimit: 500000,
                transactionRequest: { to: '0xrouter', data: '0x', value: '0x0' },
            }
        }),
        executeSwap: (...a: any[]) => executeSwap(...a),
    }
})

const signer = {
    address: '0x' + '11'.repeat(20),
    network: { evmChainId: 43114, name: 'Avalanche C-Chain', explorerUrl: 'https://snowtrace.io' },
    authSubject: { type: 'injected' },
    getGasPrice: async () => new BN('25000000000'),
    getNonce: async () => 7,
    waitForReceipt: async (txHash: string) => ({ txHash, status: true, contractAddress: null }),
}
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signer }))

// Premium gate: this address has burned enough.
jest.mock('@/js/MoatsStats', () => ({
    readBurnedOnMoats: async () => new BN(2_000_000).mul(new BN('1000000000000000000')),
}))

jest.mock('vue-router', () => ({
    ...jest.requireActual('vue-router'),
    onBeforeRouteLeave: () => undefined,
}))

import LimitOrder from '@/views/wallet/LimitOrder.vue'
import { forgetBurnReads } from '@/composables/useBaseAssetGate'

async function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    useMainStore().activeWallet = { ethAddress: '11'.repeat(20), ethBalance: new BN(100).mul(E18) } as any
    useAssetsStore().erc20Tokens.push({
        data: { ...USDC, chainId: 43114 },
        balanceBN: new BN(0),
        balanceBig: { toFixed: () => '0' },
    } as any)
    const w = mount(LimitOrder, { global: { plugins: [pinia], stubs: { fa: true } } })
    await flushPromises()
    return w
}

async function setUpOrder(w: any, amount: string, price: string) {
    await w.find('input[name="lo-amount"]').setValue(amount)
    await w.find('input[name="lo-target"]').setValue('USDC')
    jest.advanceTimersByTime(500) // target resolution debounce
    await flushPromises()
    await w.find('input[name="lo-price"]').setValue(price)
}

async function place(w: any) {
    await w.find('button.arm_btn').trigger('click')
    for (let i = 0; i < 10; i++) await flushPromises()
}

/** Moves time forward one check and lets it run. */
async function nextCheck() {
    jest.advanceTimersByTime(15_000)
    for (let i = 0; i < 10; i++) await flushPromises()
}

beforeEach(() => {
    jest.useFakeTimers()
    market.out = new BN(250_000_000)
    quoteCalls.length = 0
    executeSwap.mockClear()
    forgetBurnReads()
})
afterEach(() => jest.useRealTimers())

it('watches below the limit, then fills from a quote whose minimum covers it', async () => {
    const w = await mountPage()
    // Sell 10 AVAX at >= 25.5 USDC each: at least 255 USDC.
    await setUpOrder(w, '10', '25.5')
    expect(w.text()).toContain('You receive at least 255 USDC')

    await place(w)
    expect(w.find('.badge').text()).toBe('Watching')
    expect(executeSwap).not.toHaveBeenCalled()

    // The market rises to 26 USDC each: 260 expected, 2% over the limit.
    market.out = new BN(260_000_000)
    quoteCalls.length = 0
    await nextCheck()

    expect(executeSwap).toHaveBeenCalledTimes(1)
    const signed = executeSwap.mock.calls[0][1] as any
    // The quote that was signed guarantees at least the limit.
    expect(new BN(signed.toAmountMin).gte(new BN(255_000_000))).toBe(true)
    // The fill re-quoted at the slippage the limit leaves room for: the gap
    // is 1.92%, so the user's 1% maximum applies (260 × 0.99 = 257.4 ≥ 255).
    expect(quoteCalls[quoteCalls.length - 1]).toBe(1)
    expect(w.find('.badge').text()).toBe('Filled')
    expect(w.text()).toContain('Filled — about 260 USDC received')
    w.unmount()
})

it('does not sign when the fill-time quote no longer guarantees the limit', async () => {
    const w = await mountPage()
    await setUpOrder(w, '10', '25.5')
    await place(w)

    // Expected output just above the limit (255.1): too thin a margin for
    // even the smallest slippage to keep the minimum at 255.
    market.out = new BN(255_100_000)
    await nextCheck()

    expect(executeSwap).not.toHaveBeenCalled()
    expect(w.find('.badge').text()).toBe('Watching')
    w.unmount()
})

it('refuses to place an order for more than the wallet holds', async () => {
    const w = await mountPage()
    await setUpOrder(w, '500', '25.5')
    expect(w.find('button.arm_btn').attributes('disabled')).toBeDefined()
    w.unmount()
})

it('prices a buy limit as the most paid per token received', async () => {
    const w = await mountPage()
    await w.findAll('.side_toggle button').find((b: any) => b.text() === 'Buy at or below')!.trigger('click')
    // Spend 10 AVAX buying USDC at <= 0.04 AVAX each: at least 250 USDC.
    await setUpOrder(w, '10', '0.04')
    expect(w.text()).toContain('You receive at least 250 USDC')
    expect(w.text()).toContain('AVAX per USDC')
    w.unmount()
})

it('stops checking once cancelled', async () => {
    const w = await mountPage()
    await setUpOrder(w, '10', '25.5')
    await place(w)
    await w.findAll('button.small_btn').find((b: any) => b.text() === 'Cancel order')!.trigger('click')
    expect(w.find('.badge').text()).toBe('Cancelled')

    // The watcher's own check count, not every quote: once cancelled, the
    // form is editable again and may preview the market.
    const checks = () => w.findAll('.tile').find((t: any) => t.text().startsWith('Checks'))!.find('p').text()
    const before = checks()
    market.out = new BN(300_000_000) // well past the limit
    await nextCheck()
    await nextCheck()
    expect(checks()).toBe(before)
    expect(executeSwap).not.toHaveBeenCalled()
    expect(w.find('.badge').text()).toBe('Cancelled')
    w.unmount()
})
