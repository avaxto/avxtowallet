/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The /wallet/moats/burn page: shows the balance, refuses the wrong chain,
 * and never burns on the first click — it arms a confirmation naming the
 * exact amount.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

const burnAvxto = jest.fn()
jest.mock('@/js/MoatsBurn', () => {
    const actual = jest.requireActual('@/js/MoatsBurn')
    return {
        ...actual,
        readBurnState: async () => ({
            decimals: 18,
            balance: new BN('3635c9adc5dea00000', 16), // 1000
            allowance: new BN(0),
            userBurned: new BN('1bc16d674ec80000', 16), // 2
            totalBurned: new BN('1bc16d674ec80000', 16),
            minAmount: new BN('1000000000000'),
            burningEnabled: true,
            paused: false,
        }),
        burnAvxto: (...args: any[]) => burnAvxto(...args),
    }
})

// Imported after the mocks so the page picks them up.
import MoatsBurn from '@/views/wallet/MoatsBurn.vue'

function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(MoatsBurn, { global: { plugins: [pinia], stubs: { fa: true } } })
}

beforeEach(() => burnAvxto.mockReset())

it('shows the AVXTO balance', async () => {
    signerRef.current = { address: '0xabc', network: { evmChainId: 43114, name: 'C-Chain' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('1,000 AVXTO')
    expect(wrapper.text()).toContain('You have burned')
})

it('refuses a wallet on another chain', async () => {
    signerRef.current = { address: '0xabc', network: { evmChainId: 1, name: 'Ethereum' } }
    const wrapper = mountPage()
    await flushPromises()
    expect(wrapper.text()).toContain('switch it to Avalanche C-Chain')
    expect(wrapper.find('input').exists()).toBe(false)
})

it('arms a confirmation instead of burning on the first click', async () => {
    signerRef.current = { address: '0xabc', network: { evmChainId: 43114, name: 'C-Chain' } }
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input').setValue('250')
    await wrapper.find('button.burn_btn').trigger('click')

    expect(burnAvxto).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('permanently destroy 250 AVXTO')
})

it('refuses more than the balance', async () => {
    signerRef.current = { address: '0xabc', network: { evmChainId: 43114, name: 'C-Chain' } }
    const wrapper = mountPage()
    await flushPromises()

    await wrapper.find('input').setValue('1001')
    expect(wrapper.text()).toContain('more AVXTO than this wallet holds')
    expect(wrapper.find('button.burn_btn').attributes('disabled')).toBeDefined()
})
