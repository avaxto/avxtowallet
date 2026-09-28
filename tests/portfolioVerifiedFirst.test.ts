/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM portfolio lists native assets first, then registry-verified tokens,
 * then everything else — each group still largest balance first.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Big from 'big.js'

import { getEvmNetworkByChainId } from '@/evm/networkRegistry'

const tokensRef: { current: any[] } = { current: [] }
jest.mock('@/stores/evmPortfolio', () => ({
    useEvmPortfolioStore: () => ({
        get tokens() {
            return tokensRef.current
        },
        loading: false,
        results: [],
        failedNetworks: [],
        ensureLoaded: jest.fn(),
        fetch: jest.fn(),
    }),
}))

import EvmFungibles from '@/components/wallet/portfolio/EvmFungibles.vue'

const avalanche = getEvmNetworkByChainId(43114)!
const AVXTO = '0xf56cecc07d97ac50630022cf84c19e612ae8c93d'
const USDC = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'

const token = (symbol: string, address: string, balance: string, isNative = false) => ({
    key: `43114:${address}`,
    address,
    symbol,
    name: symbol,
    decimals: 18,
    balance: Big(balance),
    raw: '0',
    isNative,
    network: avalanche,
})

it('lists natives, then verified tokens, then the rest, by balance within each', async () => {
    // The store's own order: natives first, then by balance.
    tokensRef.current = [
        token('AVAX', 'native', '1', true),
        token('SPAM', '0x1111111111111111111111111111111111111111', '1000000'),
        token('USDC', USDC, '500'),
        token('JUNK', '0x2222222222222222222222222222222222222222', '100'),
        token('AVXTO', AVXTO, '50'),
    ]
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(EvmFungibles, {
        global: { plugins: [pinia], stubs: { fa: true, Spinner: true, EtherscanKeyForm: true } },
    })
    await flushPromises()

    const symbols = wrapper.findAll('.asset.row .sym').map((el) => el.text())
    expect(symbols).toEqual(['(AVAX)', '(USDC)', '(AVXTO)', '(SPAM)', '(JUNK)'])
})
