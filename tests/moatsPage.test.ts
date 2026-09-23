/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The /wallet/moats/burn and /wallet/moats/stake pages: show the balance,
 * refuse the wrong chain, and never act on the first click — they arm a
 * confirmation naming the exact amount (and, for a stake, the unstake fee).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

const runMoatsAction = jest.fn()
jest.mock('@/js/Moats', () => {
    const actual = jest.requireActual('@/js/Moats')
    return {
        ...actual,
        readMoatsState: async () => ({
            decimals: 18,
            balance: new BN('3635c9adc5dea00000', 16), // 1000
            allowance: new BN(0),
            userBurned: new BN('1bc16d674ec80000', 16), // 2
            userStaked: new BN('4563918244f40000', 16), // 5
            totalBurned: new BN('1bc16d674ec80000', 16),
            totalStaked: new BN('8ac7230489e80000', 16), // 10
            userLocks: [
                {
                    index: 0,
                    amount: new BN('3635c9adc5dea00000', 16), // 1000
                    end: 4102444800, // 2100-01-01
                    originalDuration: 730 * 86_400,
                },
            ],
            userLocked: new BN('3635c9adc5dea00000', 16),
            totalLocked: new BN('3635c9adc5dea00000', 16),
            minAmount: new BN('1000000000000'),
            unstakeFeeBps: 50,
            burningEnabled: true,
            stakingEnabled: true,
            lockingEnabled: true,
            paused: false,
        }),
        runMoatsAction: (...args: any[]) => runMoatsAction(...args),
    }
})

// Imported after the mocks so the page picks them up.
import MoatsAction from '@/components/wallet/moats/MoatsAction.vue'

const ON_C_CHAIN = {
    address: '0xabc',
    network: { evmChainId: 43114, name: 'C-Chain' },
    // An extension wallet: the authorization gate lets it sign without a vault.
    authSubject: { type: 'injected' },
}

const MoatsBurn = 'burn'
const MoatsStake = 'stake'
const MoatsLock = 'lock'

/** Mounted the way the router does it: one component, `mode` as a prop. */
function mountPage(mode: string) {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(MoatsAction as any, {
        props: { mode },
        global: { plugins: [pinia], stubs: { fa: true } },
    })
}

beforeEach(() => runMoatsAction.mockReset())

describe('burn page', () => {
    it('shows the AVXTO balance and burn stats', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsBurn)
        await flushPromises()
        expect(wrapper.text()).toContain('1,000 AVXTO')
        expect(wrapper.text()).toContain('You have burned')
        expect(wrapper.text()).not.toContain('You have staked')
    })

    it('refuses a wallet on another chain', async () => {
        signerRef.current = { address: '0xabc', network: { evmChainId: 1, name: 'Ethereum' } }
        const wrapper = mountPage(MoatsBurn)
        await flushPromises()
        expect(wrapper.text()).toContain('switch it to Avalanche C-Chain')
        expect(wrapper.find('input').exists()).toBe(false)
    })

    it('arms a confirmation instead of burning on the first click', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsBurn)
        await flushPromises()

        await wrapper.find('input').setValue('250')
        await wrapper.find('button.action_btn').trigger('click')

        expect(runMoatsAction).not.toHaveBeenCalled()
        expect(wrapper.text()).toContain('permanently destroy 250 AVXTO')
    })

    it('refuses more than the balance', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsBurn)
        await flushPromises()

        await wrapper.find('input').setValue('1001')
        expect(wrapper.text()).toContain('more AVXTO than this wallet holds')
        expect(wrapper.find('button.action_btn').attributes('disabled')).toBeDefined()
    })
})

describe('stake page', () => {
    it('shows the AVXTO balance, staking stats and the unstake fee', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsStake)
        await flushPromises()
        const text = wrapper.text()
        expect(text).toContain('1,000 AVXTO')
        expect(text).toContain('You have staked')
        expect(text).toContain('5 AVXTO')
        expect(text).toContain('Unstaking later costs a 0.5% fee')
        expect(text).not.toContain('You have burned')
    })

    it('confirms the stake, naming the fee, then stakes exactly that amount', async () => {
        signerRef.current = ON_C_CHAIN
        runMoatsAction.mockResolvedValue({
            approveTxHash: '0xa',
            actionTxHash: '0xb',
            offline: false,
        })
        const wrapper = mountPage(MoatsStake)
        await flushPromises()

        await wrapper.find('input').setValue('250')
        await wrapper.find('button.action_btn').trigger('click')
        expect(runMoatsAction).not.toHaveBeenCalled()
        expect(wrapper.text()).toContain('You are about to stake 250 AVXTO')
        expect(wrapper.text()).toContain('0.5% unstake fee')
        expect(wrapper.text()).not.toContain('permanently destroy')

        await wrapper.find('.confirm_box button.action_btn').trigger('click')
        await flushPromises()

        expect(runMoatsAction).toHaveBeenCalledTimes(1)
        const [, mode, amount] = runMoatsAction.mock.calls[0]
        expect(mode).toBe('stake')
        expect((amount as BN).toString()).toBe('250000000000000000000')
        expect(wrapper.text()).toContain('Staked 250 AVXTO')
    })
})

describe('lock page', () => {
    it('shows the balance, lock stats and the active locks', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsLock)
        await flushPromises()
        const text = wrapper.text()
        expect(text).toContain('You have locked')
        expect(text).toContain('Your active locks')
        expect(text).toContain('5x')
        expect(text).not.toContain('You have staked')
    })

    it('defaults to 730 days and refuses a duration out of range', async () => {
        signerRef.current = ON_C_CHAIN
        const wrapper = mountPage(MoatsLock)
        await flushPromises()

        const days = wrapper.find('input[name="moats-lock-days"]')
        expect((days.element as HTMLInputElement).value).toBe('730')

        await wrapper.find('input[name="moats-lock-amount"]').setValue('10')
        await days.setValue('731')
        expect(wrapper.text()).toContain('The longest lock is 730 days')
        expect(wrapper.find('button.action_btn').attributes('disabled')).toBeDefined()
    })

    it('confirms with the duration and the early-exit cost, then locks that amount for that long', async () => {
        signerRef.current = ON_C_CHAIN
        runMoatsAction.mockResolvedValue({ approveTxHash: null, actionTxHash: '0xb', offline: false })
        const wrapper = mountPage(MoatsLock)
        await flushPromises()

        await wrapper.find('input[name="moats-lock-amount"]').setValue('250')
        await wrapper.findAll('button.preset_btn').find((b) => b.text() === '90 days')!.trigger('click')
        await wrapper.find('button.action_btn').trigger('click')

        expect(runMoatsAction).not.toHaveBeenCalled()
        const text = wrapper.text()
        expect(text).toContain('You are about to lock 250 AVXTO for 90 days')
        expect(text).toContain('95%')

        await wrapper.find('.confirm_box button.action_btn').trigger('click')
        await flushPromises()

        const [, mode, amount, opts] = runMoatsAction.mock.calls[0]
        expect(mode).toBe('lock')
        expect((amount as BN).toString()).toBe('250000000000000000000')
        expect(opts).toEqual({ lockDays: 90 })
        expect(wrapper.text()).toContain('Locked 250 AVXTO')
    })
})
