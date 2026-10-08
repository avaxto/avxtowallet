/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Bitcoin Swaps page (/wallet/btcswap): every swap goes through the
 * premium gate, quick swaps ask for the right inputs, and a Quick BTC → AVAX
 * swap resumes from the history once its BTC.b has arrived.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'

import { BN } from '@/avalanche'

const flows = {
    btcSwaps: ref<any[]>([]),
    runQuickAvaxToBtc: jest.fn(async () => ({})),
    runQuickBtcToAvax: jest.fn(async () => ({})),
    runAvaxToBtcb: jest.fn(async () => ({})),
    runBtcbToAvax: jest.fn(async () => ({})),
    runBtcToBtcb: jest.fn(async () => ({})),
    runBtcbToBtc: jest.fn(async () => ({})),
    continueQuickBtcToAvax: jest.fn(async () => ({})),
    refreshSwap: jest.fn(async (r: any) => r),
    removeSwap: jest.fn(),
    quoteAvaxToBtcb: jest.fn(async () => ({ amountOut: new BN(610_136) })),
    quoteBtcbToAvax: jest.fn(async () => ({ amountOut: new BN('2000000000000000000') })),
}
jest.mock('@/bitcoinSwap/flows', () => ({ ...jest.requireActual('@/bitcoinSwap/flows'), ...flows }))
jest.mock('@/bitcoinSwap/lombard', () => ({
    ...jest.requireActual('@/bitcoinSwap/lombard'),
    btcbBalance: async () => BigInt(700_000),
    redeemConfig: async () => ({ router: '0xr', commissionSats: 10_000, minSats: 3_300, enabled: true }),
}))
const signer = { address: '0xB57904252BCE32F98CD7c9420496c76F5b2b485F', reader: () => ({ eth: { getBalance: async () => '100000000000000000000' } }) }
jest.mock('@/bridge/signers', () => ({ walletSigners: { evm: () => signer, solana: () => null, bitcoin: () => null } }))
jest.mock('@/platforms', () => {
    const { BitcoinWallet } = jest.requireActual('@/platforms/bitcoin/wallet')
    const w = Object.create(BitcoinWallet.prototype)
    Object.assign(w, { isReadonly: false, network: { id: 'mainnet', params: jest.requireActual('bitcoinjs-lib').networks.bitcoin }, getReceiveAddress: () => 'bc1q9pa6ahh7s5d5s2fmywt6pjpgkeksj4kvkwxh0t', refresh: async () => {} })
    Object.defineProperty(w, 'balanceSats', { get: () => 500_000 })
    return { getPlatform: (id: string) => (id === 'bitcoin' ? { getActiveWallet: () => w } : undefined) }
})
jest.mock('@/stores', () => ({ useOfflineSigningStore: () => ({ isActive: false }) }))
jest.mock('@/js/security/authorize', () => ({ SessionAuthCancelled: class extends Error {} }))
const gate = { open: true, blocked: false, checks: 0 }
jest.mock('@/composables/useBaseAssetGate', () => ({
    useBaseAssetGate: () => ({
        isBlocked: gate.blocked,
        gatedAction: async (fn: () => unknown) => {
            gate.checks++
            if (!gate.open) return false
            await fn()
            return true
        },
    }),
}))

import BitcoinSwaps from '@/views/wallet/BitcoinSwaps.vue'

const stubs = {
    'v-btn': {
        props: ['disabled', 'loading'],
        emits: ['click'],
        template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}
const goButton = (w: any) => w.find('button.v_btn.go, .card button.v_btn')
const settle = async () => {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 600))
    await flushPromises()
}

beforeEach(() => {
    gate.open = true
    gate.checks = 0
    Object.values(flows).forEach((f: any) => typeof f?.mockClear === 'function' && f.mockClear())
    flows.btcSwaps.value = []
})

it('quick AVAX → BTC: estimates, then runs through the gate with my Bitcoin address', async () => {
    const w = mount(BitcoinSwaps, { global: { stubs } })
    await flushPromises()
    expect((w.find('#btcswap-dest').element as HTMLInputElement).value).toBe('bc1q9pa6ahh7s5d5s2fmywt6pjpgkeksj4kvkwxh0t')
    await w.find('#btcswap-amount').setValue('50')
    await settle()
    expect(w.text()).toContain('You receive about 0.00600136 BTC')
    expect(w.text()).toContain("Lombard pays BTC minus its 0.0001 BTC fee")
    await goButton(w).trigger('click')
    await flushPromises()
    expect(gate.checks).toBe(1)
    expect(flows.runQuickAvaxToBtc.mock.calls[0].slice(2)).toEqual([BigInt('50000000000000000000'), 'bc1q9pa6ahh7s5d5s2fmywt6pjpgkeksj4kvkwxh0t'])
    w.unmount()
})

it('runs nothing when the premium requirement is not met', async () => {
    gate.open = false
    const w = mount(BitcoinSwaps, { global: { stubs } })
    await flushPromises()
    await w.findAll('.tabs button')[4].trigger('click') // BTC → BTC.b
    await w.find('#btcswap-amount').setValue('0.00021')
    await settle()
    await goButton(w).trigger('click')
    await flushPromises()
    expect(gate.checks).toBe(1)
    expect(flows.runBtcToBtcb).not.toHaveBeenCalled()
    w.unmount()
})

it('enforces the 0.0002 BTC deposit minimum on Bitcoin sends', async () => {
    const w = mount(BitcoinSwaps, { global: { stubs } })
    await flushPromises()
    await w.findAll('.tabs button')[1].trigger('click') // Quick BTC → AVAX
    await w.find('#btcswap-amount').setValue('0.0001')
    await flushPromises()
    expect(w.text()).toContain('The minimum is 0.0002 BTC.')
    expect(goButton(w).attributes('disabled')).toBeDefined()
    w.unmount()
})

it('offers step 2 of a Quick BTC → AVAX swap once the BTC.b has arrived, through the gate', async () => {
    flows.btcSwaps.value = [
        { id: 'q1', kind: 'quick-btc-avax', createdAt: 1, updatedAt: 1, status: 'ready', detail: 'BTC.b arrived.', amountIn: '0.0003', symbolIn: 'BTC', symbolOut: 'AVAX', evmAddress: signer.address, btcAddress: '', steps: [], data: {} },
    ]
    const w = mount(BitcoinSwaps, { global: { stubs } })
    await flushPromises()
    const step2 = w.findAll('button.v_btn').find((b) => b.text().includes('Swap BTC.b to AVAX (step 2)'))!
    await step2.trigger('click')
    await flushPromises()
    expect(gate.checks).toBe(1)
    expect(flows.continueQuickBtcToAvax).toHaveBeenCalledTimes(1)
    w.unmount()
})
