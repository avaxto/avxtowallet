/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /wallet/avxto: market figures (DexScreener), supply (the token contract) and
 * transfer activity (the transfer log), each on its own so one source failing
 * never hides the others.
 */
import { flushPromises, mount } from '@vue/test-utils'

import liveToken from './fixtures/avxto/dexscreener-token.json'

const E18 = (n: number) => `${n}000000000000000000`
const MOATS = '0xebe5fbacb882fd313d05684bef591c31f83b0524'
const DEAD = '0x000000000000000000000000000000000000dEaD'

jest.mock('@/AVA', () => ({ ava: { getNetworkID: () => 1 } }))

const balances: Record<string, string> = {
    '0x000000000000000000000000000000000000dead': E18(2_000_000_000),
    '0x0000000000000000000000000000000000000000': '0',
    [MOATS]: E18(500_000_000),
}
jest.mock('@/evm', () => ({
    web3: {
        eth: {
            getBlockNumber: async () => 1_000_000,
            Contract: function () {
                return {
                    methods: {
                        totalSupply: () => ({ call: async () => E18(10_000_000_000) }),
                        balanceOf: (a: string) => ({ call: async () => balances[a.toLowerCase()] ?? '0' }),
                    },
                }
            },
        },
    },
}))

const nowSec = Math.floor(Date.now() / 1000)
const transfer = (i: number, from: string, to: string, amount: number, ago: number) => ({
    erc20Token: {},
    txHash: `0x${i}`,
    logIndex: i,
    blockTimestamp: nowSec - ago,
    from: { address: from },
    to: { address: to },
    value: E18(amount),
})
jest.mock('@avalanche-sdk/chainkit', () => ({
    Avalanche: function () {
        return {
            data: {
                evm: {
                    contracts: {
                        listTransfers: async () => ({
                            async *[Symbol.asyncIterator]() {
                                yield {
                                    result: {
                                        transfers: [
                                            transfer(1, '0xaaaa000000000000000000000000000000000001', MOATS, 1000, 600),
                                            transfer(2, MOATS, DEAD, 1000, 600),
                                            transfer(3, '0xaaaa000000000000000000000000000000000001', '0xbbbb000000000000000000000000000000000002', 25, 3 * 86_400),
                                        ],
                                    },
                                }
                            },
                        }),
                    },
                },
            },
        }
    },
}))

const readMarket = jest.fn()
const readProfile = jest.fn()
jest.mock('@/js/MoatsStats', () => ({
    ...jest.requireActual('@/js/MoatsStats'),
    readAvxtoMarket: () => readMarket(),
    readDexProfileStatus: () => readProfile(),
}))

const avaxPrice = jest.fn()
jest.mock('@/prices', () => ({
    ...jest.requireActual('@/prices'),
    getPriceUSD: (asset: string) => avaxPrice(asset),
    getPriceService: () => ({ name: 'Coinbase' }),
}))

import { pickMarket } from '@/js/MoatsStats'
import Avxto from '@/views/wallet/Avxto.vue'

function mountPage() {
    return mount(Avxto, {
        global: {
            stubs: {
                CopyText: { template: '<span><slot /></span>' },
                RegistryCheck: true,
                'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
            },
        },
    })
}

beforeEach(() => avaxPrice.mockResolvedValue(11.45))

it('shows market, supply and activity for AVXTO', async () => {
    readMarket.mockResolvedValue(pickMarket(liveToken))
    readProfile.mockResolvedValue({ status: 'approved', since: 1750913420995 })
    const wrapper = mountPage()
    await flushPromises()

    const text = wrapper.text()
    // Market — from the live DexScreener payload.
    expect(text).toContain('$0.000003163')
    expect(text).toContain('WAVAX')
    expect(text).toContain('6 buys · 1 sells')
    expect(text).toContain('2,101,233,182 AVXTO') // pooled
    expect(text).toContain('DexScreener profile approved')
    expect(wrapper.findAll('.links_row a').map((a) => a.text())).toEqual(['Website ↗', 'Docs ↗', 'X ↗', 'Telegram ↗'])
    // A window DexScreener omits reads as unknown, not 0%.
    expect(wrapper.find('.table_wrap tbody tr td:nth-child(2)').text()).toBe('--')

    // Supply — from the token contract.
    expect(text).toContain('10,000,000,000')
    expect(text).toContain('20.00% of supply') // 2B of 10B burned
    expect(text).toContain('8,000,000,000') // circulating
    expect(text).toContain('6.25% of circulating') // 500M of 8B in Moats

    // Activity — from the transfer log.
    expect(text).toContain('3 transfers since')
    expect(text).toContain('Last 24h')
    expect(text).toContain('1 burns, stakes and locks')
    expect(wrapper.findAll('.tx_row')).toHaveLength(3)
    wrapper.unmount()
})

it('keeps supply and activity when DexScreener is down', async () => {
    readMarket.mockResolvedValue(null)
    readProfile.mockResolvedValue(null)
    const wrapper = mountPage()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Market data unavailable right now.')
    expect(text).toContain('Total supply')
    expect(text).toContain('Transfer activity')
    wrapper.unmount()
})

it('estimates the dollar price from the AVXTO/AVAX ratio and the chosen AVAX price', async () => {
    readMarket.mockResolvedValue(pickMarket(liveToken))
    readProfile.mockResolvedValue(null)
    const wrapper = mountPage()
    await flushPromises()

    expect(avaxPrice).toHaveBeenCalledWith('AVAX')
    const tile = wrapper.findAll('.tile').find((t) => t.find('label').text() === 'Estimated price')!
    // 0.0000002795 AVAX × $11.45 = $0.0000032003, 1.18% above DexScreener's $0.000003163.
    expect(tile.find('p').text()).toBe('$0.0000032')
    expect(tile.text()).toContain('0.0000002795 AVAX × $11.45 (Coinbase)')
    expect(tile.text()).toContain('+1.18% vs DexScreener')
    wrapper.unmount()
})

it('leaves the estimate out when the AVAX price is unavailable', async () => {
    avaxPrice.mockRejectedValue(new Error('rate limited'))
    readMarket.mockResolvedValue(pickMarket(liveToken))
    readProfile.mockResolvedValue(null)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountPage()
    await flushPromises()
    warn.mockRestore()

    expect(wrapper.text()).not.toContain('Estimated price')
    expect(wrapper.text()).toContain('$0.000003163') // DexScreener's price still shows
    wrapper.unmount()
})
