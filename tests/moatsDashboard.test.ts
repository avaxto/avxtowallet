/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /wallet/moats/dashboard: renders the moat's totals with no wallet at all,
 * adds the viewer's position when there is an EVM address, and keeps going
 * when moats.app's API or the price feed is down.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'

const E18 = (n: number) => new BN(String(n)).mul(new BN('1000000000000000000'))

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

const readMoatsApi = jest.fn()
const readAvxtoMarket = jest.fn()
const readMoatsOnChain = jest.fn()
jest.mock('@/js/MoatsStats', () => ({
    ...jest.requireActual('@/js/MoatsStats'),
    readMoatsOnChain: (...a: any[]) => readMoatsOnChain(...a),
    readMoatsApi: (...a: any[]) => readMoatsApi(...a),
    readAvxtoMarket: (...a: any[]) => readAvxtoMarket(...a),
}))

import MoatsDashboard from '@/views/wallet/MoatsDashboard.vue'

const ME = '0x5da60a5391bf349e64d4d2ae41c5e28896396fd9'

const moat = {
    token: { address: '0xf56c', name: 'AVAX Toolbox Token', symbol: 'AVXTO', decimals: 18 },
    totalStaked: E18(500),
    totalLocked: E18(300),
    totalBurned: E18(200),
    totalInContract: E18(800),
    totalPoints: new BN('4000').mul(new BN('1000000')),
    pointsScalingFactor: new BN('1000000000000'),
    activeUsers: 5,
    stakingEnabled: true,
    lockingEnabled: true,
    burningEnabled: true,
    earlyExitEnabled: true,
    emergencyUnlockEnabled: false,
    paused: false,
    unstakeFeeBps: 50,
    minAmount: new BN('1000000000000'),
    owner: '0xec9221beda2979d3fb54e7ed2d59650656b7032c',
    feeCollector: '0x7fa527a8561cdb3cb16de66369cb99bb6f023588',
    rewardTokens: [],
}

const user = {
    address: ME,
    state: {
        balance: E18(1000),
        userStaked: E18(100),
        userLocked: E18(50),
        userBurned: E18(20),
        userLocks: [{ index: 0, amount: E18(50), end: 4102444800, originalDuration: 730 * 86400 }],
    },
    currentPoints: new BN('550').mul(new BN('1000000')),
    pendingRewards: [],
    earlyExit: { 0: { fee: E18(47), afterFee: E18(3) } },
}

function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(MoatsDashboard, {
        global: { plugins: [pinia], stubs: { fa: true, 'router-link': { template: '<a><slot /></a>' } } },
    })
}

beforeEach(() => {
    readMoatsApi.mockResolvedValue({
        userPoints: null,
        leaderboard: {
            epoch: { epochNumber: 26, startTime: '', endTime: null, isComplete: false },
            entries: [
                { rank: 1, address: '0xaaa', username: 'gator.degen', points: 7096, weight: 83.2, boosted: false },
                { rank: 2, address: ME, username: ME, points: 1649, weight: 4.49, boosted: false },
            ],
        },
        averageLock: { seconds: 39287775, count: 2 },
        votingEpoch: { epochNumber: 1, startDate: '2026-09-23T00:00:00Z', endDate: '2099-09-30T00:00:00Z', emission: 82194 },
        config: null,
        mapScore: null,
    })
    readAvxtoMarket.mockResolvedValue({
        priceUsd: 0.000001867,
        priceChange24h: 14.45,
        liquidityUsd: 9760,
        volume24hUsd: 823,
        marketCapUsd: 18674,
        fdvUsd: 18676,
        dex: 'arenatrade',
        pairUrl: 'https://dexscreener.com/avalanche/0x2bde',
    })
})

it('shows the moat totals with no wallet connected, and asks for one for the personal panels', async () => {
    signerRef.current = null
    readMoatsOnChain.mockResolvedValue({ moat, user: null })
    const wrapper = mountPage()
    await flushPromises()

    expect(readMoatsOnChain).toHaveBeenCalledWith(null)
    const text = wrapper.text()
    expect(text).toContain('800 AVXTO') // in contract
    expect(text).toContain('Active users')
    expect(text).toContain('62.50% of staked + locked') // 500 of 800
    expect(text).toContain('4,000') // total points, AVXTO-weighted
    expect(text).toContain('455 days') // average lock
    expect(text).toContain('Connect an Avalanche wallet')
})

it("adds the viewer's position, locks and leaderboard rank", async () => {
    signerRef.current = { address: ME, network: { evmChainId: 1, name: 'Ethereum' } }
    readMoatsOnChain.mockResolvedValue({ moat, user })
    const wrapper = mountPage()
    await flushPromises()

    // Read by address even though the wallet is on another chain.
    expect(readMoatsOnChain).toHaveBeenCalledWith(ME)
    const text = wrapper.text()
    expect(text).toContain('Your position')
    expect(text).toContain('1,000 AVXTO') // balance
    expect(text).toContain('13.75% of the moat') // 550 of 4000 points
    expect(text).toContain('5x') // the 730-day lock
    expect(text).toContain('47 (94.00%)') // leaving now
    expect(wrapper.find('tr.me').text()).toContain('you')
})

it('keeps the on-chain figures when moats.app and the price feed are down', async () => {
    signerRef.current = null
    readMoatsOnChain.mockResolvedValue({ moat, user: null })
    readMoatsApi.mockResolvedValue({
        userPoints: null,
        leaderboard: null,
        averageLock: null,
        votingEpoch: null,
        config: null,
        mapScore: null,
    })
    readAvxtoMarket.mockResolvedValue(null)
    const wrapper = mountPage()
    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('Moat totals')
    expect(text).toContain('800 AVXTO')
    expect(text).not.toContain('Market')
    expect(text).not.toContain('moats.app points')
})

it('says so when the contract cannot be read', async () => {
    signerRef.current = null
    readMoatsOnChain.mockRejectedValue(new Error('rpc down'))
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const wrapper = mountPage()
    await flushPromises()
    warn.mockRestore()

    expect(wrapper.text()).toContain('Could not read the Moats contract')
})
