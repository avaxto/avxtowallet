/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Settings → Price Source: pick a service from the dropdown, test it without
 * committing, apply it, and the AVAX price is refetched from it.
 */
import { flushPromises, mount } from '@vue/test-utils'

const updateAvaxPrice = jest.fn(async () => {})
const success = jest.fn()
jest.mock('@/stores', () => ({
    useStatusBarStore: () => ({ success, error: jest.fn() }),
    useOfflineSigningStore: () => ({ isEnabled: false, setEnabled: jest.fn() }),
    useMainStore: () => ({ updateAvaxPrice }),
}))
jest.mock('@/stores/network', () => ({ useNetworkStore: () => ({ selectedNetwork: null, networks: [] }) }))
jest.mock('@/platforms', () => ({ useActivePlatformStore: () => ({ hasChainKind: () => false }) }))

const priceByHost: Record<string, any> = {
    'api.coinbase.com': { data: { amount: '11.455', base: 'AVAX', currency: 'USD' } },
    'api.kraken.com': { error: [], result: { AVAXUSD: { c: ['11.45', '1'] } } },
}
jest.mock('axios', () => {
    const get = jest.fn(async (url: string) => {
        const host = new URL(url).host
        if (host in priceByHost) return { data: priceByHost[host] }
        if (url.includes('coingecko')) return { data: { prices: [] } }
        throw new Error('network down')
    })
    return { __esModule: true, default: { create: () => ({ get }), get }, create: () => ({ get }), get }
})

import Config from '@/views/wallet/Config.vue'
import { priceServiceId } from '@/prices'

const stubs = {
    'router-link': { template: '<a><slot /></a>' },
    'v-btn': {
        props: ['disabled', 'loading'],
        emits: ['click'],
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}

/** A button inside the Price Source card — Config has several "Apply"s. */
const button = (w: any, label: string) => {
    const card = w.findAll('.grid_box').find((c: any) => c.find('h3').text() === 'Price Source')!
    return card.findAll('button').find((b: any) => b.text() === label)!
}

beforeEach(() => {
    localStorage.clear()
    priceServiceId.value = 'coingecko'
    updateAvaxPrice.mockClear()
})

it('lists every service, labelled with its quote currency', () => {
    const w = mount(Config, { global: { stubs } })
    const options = w.findAll('#config-price-service option').map((o) => o.text())
    expect(options).toEqual([
        'CoinGecko (USD)',
        'Coinbase (USD)',
        'Kraken (USD)',
        'CoinPaprika (USD)',
        'Binance (USDT)',
        'OKX (USDT)',
        'Bybit (USDT)',
        'Gate.io (USDT)',
    ])
    expect(w.text()).toContain('Currently using CoinGecko')
    w.unmount()
})

it('tests the highlighted service without switching to it', async () => {
    const w = mount(Config, { global: { stubs } })
    await w.find('#config-price-service').setValue('coinbase')
    await button(w, 'Test').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Coinbase: 1 AVAX = 11.455 USD')
    expect(priceServiceId.value).toBe('coingecko')
    expect(updateAvaxPrice).not.toHaveBeenCalled()
    w.unmount()
})

it('reports a service that does not answer', async () => {
    const w = mount(Config, { global: { stubs } })
    await w.find('#config-price-service').setValue('bybit')
    expect(w.text()).toContain('Quoted in USDT')
    await button(w, 'Test').trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Bybit did not answer: network down')
    w.unmount()
})

it('applies the choice, remembers it, and refetches the AVAX price', async () => {
    const w = mount(Config, { global: { stubs } })
    expect(button(w, 'Apply').attributes('disabled')).toBeDefined() // nothing to apply yet

    await w.find('#config-price-service').setValue('kraken')
    await button(w, 'Apply').trigger('click')
    await flushPromises()

    expect(priceServiceId.value).toBe('kraken')
    expect(localStorage.getItem('price_service')).toBe('kraken')
    expect(updateAvaxPrice).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalledWith('Prices now come from Kraken.')
    expect(w.text()).toContain('Currently using Kraken')
    w.unmount()
})
