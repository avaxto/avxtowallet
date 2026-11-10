/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Swap "You pay" list: on the EVM tab it is the portfolio's scan narrowed to
 * the signer's network (native coin keyed by the zero address the swap code
 * expects); on the Avalanche tab it is the C-Chain held list.
 */
import { effectScope, nextTick, reactive, ref, type EffectScope } from 'vue'
import Big from 'big.js'

const platform = reactive({ id: 'evm' })
const signerRef = ref<any>(null)
const portfolio = reactive({ tokens: [] as any[], loading: false, ensureLoaded: jest.fn(async () => {}), fetch: jest.fn(async () => {}) })
const avalancheTokens = ref<any[]>([{ address: '0xavax', symbol: 'WAVAX' }])

jest.mock('@/platforms', () => ({
    useActivePlatformStore: () => ({ get activePlatform() { return { descriptor: { id: platform.id } } } }),
}))
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.value }))
jest.mock('@/stores/evmPortfolio', () => ({ useEvmPortfolioStore: () => portfolio }))
jest.mock('@/js/ArenaSwap', () => ({ NATIVE_TOKEN_ADDRESS: '0x0000000000000000000000000000000000000000' }))
jest.mock('@/composables/useHeldErc20Tokens', () => {
    const { computed } = require('vue')
    return {
        useHeldErc20Tokens: () => ({
            tokens: computed(() => avalancheTokens.value),
            loading: computed(() => false),
            refresh: jest.fn(async () => {}),
        }),
    }
})

import { useSwapSourceTokens } from '@/composables/useSwapSourceTokens'

const ME = '0x5e379D6A276262C293c9C632D0C72ca9C90A9635'
const net = (evmChainId: number) => ({ evmChainId, isTestnet: false })
const tok = (evmChainId: number, address: string, symbol: string, isNative = false, balance = '1') => ({
    address, symbol, name: symbol, decimals: 18, balance: Big(balance), isNative, network: net(evmChainId),
})

let scope: EffectScope
const mount = () => {
    scope = effectScope()
    return scope.run(() => useSwapSourceTokens())!
}
afterEach(() => scope?.stop())

beforeEach(() => {
    platform.id = 'evm'
    signerRef.value = { address: ME, network: net(1) }
    portfolio.tokens = [
        tok(1, 'native', 'ETH', true),
        tok(1, '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 'USDC'),
        tok(1, '0xdead', 'ZERO', false, '0'),
        tok(8453, 'native', 'ETH', true),
        tok(8453, '0xbase', 'BASED'),
    ]
    portfolio.ensureLoaded.mockClear()
})

describe('swap source tokens', () => {
    it("on the EVM tab, lists what the portfolio holds on the signer's network only", async () => {
        const { tokens } = mount()
        expect(tokens.value.map((t) => [t.symbol, t.address, t.isNative])).toEqual([
            ['ETH', '0x0000000000000000000000000000000000000000', true],
            ['USDC', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', false],
        ])
        expect(portfolio.ensureLoaded).toHaveBeenCalledWith(ME, false)

        signerRef.value = { address: ME, network: net(8453) }
        await nextTick()
        expect(tokens.value.map((t) => t.symbol)).toEqual(['ETH', 'BASED'])
    })

    it('on the Avalanche tab, is the C-Chain held list and scans nothing', () => {
        platform.id = 'avalanche'
        const { tokens } = mount()
        expect(tokens.value).toBe(avalancheTokens.value)
        expect(portfolio.ensureLoaded).not.toHaveBeenCalled()
    })
})
