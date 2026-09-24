/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /wallet/arenatrade/sniper: lists the newest launches and re-sorts them by
 * age, transactions or volume; stops polling when left.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'

const E18 = new BN('1000000000000000000')
const token = (id: string, block: number, buys: number, sells: number, avax: number, graduated = false) => ({
    tokenId: id,
    address: '0x' + id.padStart(40, '0'),
    name: `Token ${id}`,
    symbol: `T${id}`,
    creator: '0x' + 'c'.repeat(40),
    createdAt: Math.floor(Date.now() / 1000) - (1000 - block) * 60,
    createdBlock: block,
    buys,
    sells,
    volumeWei: new BN(avax).mul(E18),
    graduated,
})

const TOKENS = [
    token('1', 100, 40, 10, 2), // oldest, busiest
    token('2', 300, 1, 0, 1), // newest
    token('3', 200, 3, 2, 90, true), // richest, graduated
]

const refresh = jest.fn(async () => TOKENS)
jest.mock('@/js/ArenaSniper', () => {
    const actual = jest.requireActual('@/js/ArenaSniper')
    return {
        ...actual,
        ArenaSniperFeed: jest.fn().mockImplementation(() => ({
            loadNewest: async () => TOKENS,
            refresh,
        })),
    }
})

import ArenaSniper from '@/views/wallet/ArenaSniper.vue'

function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(ArenaSniper, { global: { plugins: [pinia], stubs: { fa: true } } })
}

const symbols = (w: any) => w.findAll('tbody tr .symbol').map((s: any) => s.text())
const sortBy = async (w: any, label: string) =>
    w.findAll('button.sort_btn').find((b: any) => b.text() === label)!.trigger('click')

it('lists the newest launches first by default', async () => {
    const w = mountPage()
    await flushPromises()
    expect(symbols(w)).toEqual(['T2', 'T3', 'T1'])
    w.unmount()
})

it('re-sorts by transactions, volume and back to age', async () => {
    const w = mountPage()
    await flushPromises()

    await sortBy(w, 'Transactions')
    expect(symbols(w)).toEqual(['T1', 'T3', 'T2'])

    await sortBy(w, 'Volume')
    expect(symbols(w)).toEqual(['T3', 'T1', 'T2'])

    await sortBy(w, 'Age')
    expect(symbols(w)).toEqual(['T2', 'T3', 'T1'])
    w.unmount()
})

it('shows transactions split into buys and sells, volume in AVAX, and graduation', async () => {
    const w = mountPage()
    await flushPromises()
    const busiest = w.findAll('tbody tr').find((r: any) => r.text().includes('T1'))!
    expect(busiest.find('.txs').text()).toBe('50')
    expect(busiest.text()).toContain('40B')
    expect(busiest.text()).toContain('10S')
    expect(busiest.text()).toContain('2 AVAX')

    const rich = w.findAll('tbody tr').find((r: any) => r.text().includes('T3'))!
    expect(rich.text()).toContain('graduated')
    expect(rich.find('a[href="https://arenatrade.ai/token/' + TOKENS[2].address + '"]').exists()).toBe(true)
    w.unmount()
})

it('polls while live, and stops when the page is left', async () => {
    jest.useFakeTimers()
    const w = mountPage()
    await flushPromises()
    refresh.mockClear()

    jest.advanceTimersByTime(20_000)
    await flushPromises()
    expect(refresh).toHaveBeenCalledTimes(1)

    w.unmount()
    jest.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
})
