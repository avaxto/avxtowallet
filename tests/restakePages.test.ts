/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Restake end to end: the Restake page lists past delegations and hands the
 * chosen one to Quick Delegate, which opens on the validator with everything
 * filled in, so one press of Delegate submits the same delegation again.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { reactive } from 'vue'

import { BN } from '@/avalanche'
import type { PastDelegation } from '@/js/restake'

const DAY = 86_400_000
const AVAX = (n: number) => new BN(String(Math.round(n * 1e9)))
const NODE = 'NodeID-3DyUWkRptB3CRUVHk39Ni6Dpr6QvGWXwA'
const OWN = 'P-avax1tnuesf6cqwnjw7fxjyk7lhch0vhf0v95wj5jvy'

const delegate = jest.fn(async () => 'txid123')
const wallet = {
    getAllAddressesP: () => [OWN],
    getPlatformRewardAddress: () => OWN,
    delegate,
}

const platform = reactive({
    validatorListEarn: [] as any[],
    isFetchingValidators: false,
    minStakeDelegation: AVAX(25),
    currentSupply: new BN('720000000000000000'),
    fetchValidatorListEarn: jest.fn(),
    updateMinStakeAmount: jest.fn(),
    updateCurrentSupply: jest.fn(),
})

jest.mock('@/stores', () => ({
    useMainStore: () => ({ activeWallet: wallet }),
    useNotificationsStore: () => ({ add: jest.fn() }),
    useAssetsStore: () => ({ walletPlatformBalance: { available: AVAX(500) }, updateUTXOs: jest.fn() }),
    useHistoryStore: () => ({ updateTransactionHistory: jest.fn() }),
    usePlatformStore: () => platform,
    useOfflineSigningStore: () => ({ hasRecords: false, records: [], clearRecords: jest.fn() }),
    isOfflineTxId: () => false,
}))
jest.mock('@/AVA', () => ({
    ava: { getNetworkID: () => 1 },
    pChain: { getTxStatus: jest.fn(async () => 'Committed') },
}))
jest.mock('@/js/security/authorize', () => ({
    authorizeSingle: (_w: unknown, _label: string, fn: () => Promise<string>) => fn(),
    SessionAuthCancelled: class extends Error {},
}))
// The premium gate (Moats AVXTO burn). `open` = requirement met.
const gate = { open: true, checks: 0 }
jest.mock('@/composables/useBaseAssetGate', () => ({
    useBaseAssetGate: () => ({
        isBlocked: false,
        gatedAction: async (fn: () => unknown) => {
            gate.checks++
            if (!gate.open) return false // the burn modal would open instead
            await fn()
            return true
        },
    }),
}))

const listDelegations = jest.fn()
jest.mock('@/js/Glacier/listDelegationsForAddresses', () => ({
    DELEGATION_SCAN_LIMIT: 2000,
    listDelegationsForAddresses: (...a: any[]) => listDelegations(...a),
}))

const routerPush = jest.fn()
jest.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush }) }))

import Restake from '@/views/wallet/Restake.vue'
import QuickDelegate from '@/views/wallet/QuickDelegate.vue'

const stubs = {
    fa: true,
    Spinner: true,
    AvaxInput: true,
    DateForm: true,
    NodeCard: { props: ['node'], template: '<div class="node_card_stub">{{ node.nodeID }}</div>' },
    ConfirmPage: {
        props: ['nodeID', 'end', 'amount', 'rewardAddress', 'rewardDestination'],
        template: '<div class="confirm_stub">{{ rewardAddress }} {{ rewardDestination }}</div>',
    },
    SignOnlyToggle: true,
    SignedTxExport: true,
    'v-btn': {
        props: ['disabled'],
        emits: ['click'],
        template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}

const now = Date.now()
const past: PastDelegation = {
    txHash: 'tx1',
    nodeID: NODE,
    amount: AVAX(100),
    start: now - 30 * DAY,
    end: now - 2 * DAY,
    rewardAddress: OWN,
    rewardAddressIsOwn: true,
}

const activeValidator = {
    nodeID: NODE,
    validatorStake: AVAX(2000),
    delegatedStake: AVAX(1000),
    remainingStake: AVAX(5000),
    numDelegators: 20,
    startTime: new Date(now - 100 * DAY),
    endTime: new Date(now + 200 * DAY),
    uptime: 0.99,
    fee: 2,
}

beforeEach(() => {
    gate.open = true
    gate.checks = 0
    delegate.mockClear()
    routerPush.mockClear()
    platform.validatorListEarn = [activeValidator]
})

it('lists past delegations and hands the chosen one to Quick Delegate', async () => {
    listDelegations.mockResolvedValue([past])
    const wrapper = mount(Restake, { global: { stubs } })
    await flushPromises()

    expect(listDelegations).toHaveBeenCalledWith([OWN])
    const text = wrapper.text()
    expect(text).toContain(NODE)
    expect(text).toContain('100 AVAX')
    expect(text).toContain('28 days')
    expect(text).toContain('fee 2%')

    await wrapper.find('button').trigger('click')
    expect(routerPush).toHaveBeenCalledWith('/wallet/quickdelegate')
    wrapper.unmount()
})

it('opens Quick Delegate on the validator, prefilled, and delegates with one click', async () => {
    listDelegations.mockResolvedValue([past])
    const list = mount(Restake, { global: { stubs } })
    await flushPromises()
    await list.find('button').trigger('click')
    list.unmount()

    const wrapper = mount(QuickDelegate, { global: { stubs } })
    await flushPromises()

    // Straight to the confirmation: no search form.
    expect(wrapper.find('.node_card_stub').text()).toBe(NODE)
    expect(wrapper.text()).toContain('Restaking your')
    expect(wrapper.find('.confirm_stub').text()).toBe(`${OWN} local`)
    expect(wrapper.text()).toContain('2%')

    const button = wrapper.findAll('button').find((b) => b.text() === 'Delegate')!
    await button.trigger('click')
    await flushPromises()

    expect(delegate).toHaveBeenCalledTimes(1)
    const [nodeID, amount, , end, reward] = delegate.mock.calls[0] as any[]
    expect(nodeID).toBe(NODE)
    expect(amount.toString()).toBe(AVAX(100).toString())
    // Same 28-day length as before, measured from now.
    expect(Math.abs(end.getTime() - (Date.now() + 28 * DAY))).toBeLessThan(60_000)
    expect(reward).toBe(OWN)
    wrapper.unmount()
})

it('refuses to submit when the validator cannot take the amount', async () => {
    platform.validatorListEarn = [{ ...activeValidator, remainingStake: AVAX(50) }]
    listDelegations.mockResolvedValue([past])
    const list = mount(Restake, { global: { stubs } })
    await flushPromises()
    await list.find('button').trigger('click')
    list.unmount()

    const wrapper = mount(QuickDelegate, { global: { stubs } })
    await flushPromises()

    expect(wrapper.text()).toContain('only accept 50 AVAX')
    const button = wrapper.findAll('button').find((b) => b.text() === 'Delegate')!
    expect(button.attributes('disabled')).toBeDefined()
    wrapper.unmount()
})

it('opens as the ordinary search when nothing was chosen', async () => {
    const wrapper = mount(QuickDelegate, { global: { stubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('Find Validator')
    expect(wrapper.text()).not.toContain('Restaking your')
    wrapper.unmount()
})

describe('premium gate', () => {
    it('hands nothing to Quick Delegate when the burn requirement is not met', async () => {
        gate.open = false
        listDelegations.mockResolvedValue([past])
        const w = mount(Restake, { global: { stubs } })
        await flushPromises()
        await w.find('button').trigger('click')
        await flushPromises()

        expect(gate.checks).toBe(1)
        expect(routerPush).not.toHaveBeenCalled()
        w.unmount()

        // Nothing was handed over, so Quick Delegate opens as the ordinary search.
        const qd = mount(QuickDelegate, { global: { stubs } })
        await flushPromises()
        expect(qd.text()).toContain('Find Validator')
        expect(qd.text()).not.toContain('Restaking your')
        qd.unmount()
    })

    it("checks again at the restake's Delegate button, and does not delegate if it fails", async () => {
        listDelegations.mockResolvedValue([past])
        const list = mount(Restake, { global: { stubs } })
        await flushPromises()
        await list.find('button').trigger('click')
        await flushPromises()
        list.unmount()

        gate.open = false // e.g. the burn figure changed since the Restake page
        gate.checks = 0
        const w = mount(QuickDelegate, { global: { stubs } })
        await flushPromises()
        const btn = w.findAll('button').find((b) => b.text() === 'Delegate')!
        await btn.trigger('click')
        await flushPromises()

        expect(gate.checks).toBe(1)
        expect(delegate).not.toHaveBeenCalled()
        w.unmount()
    })
})
