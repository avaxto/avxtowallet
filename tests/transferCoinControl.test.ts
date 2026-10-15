/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The coin-control picker, and the P-Chain send form that uses it.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { BN } from '@/avalanche'
import type { CoinRow } from '@/js/coinControl'

// ── the P-Chain form's collaborators ─────────────────────────────────────────
const wallet = {
    type: 'mnemonic',
    pSendSource: jest.fn(async () => ({ fromAddresses: ['P-avax1me', 'P-avax1me2'], changeAddress: 'P-avax1me' })),
    issuePSend: jest.fn(async () => 'txid123'),
}
const offline = { hasRecords: false, records: [], clearRecords: jest.fn(), isActive: false }
const assets = { AssetAVA: { id: 'AVAXID' }, updateUTXOs: jest.fn() }
const notes = { add: jest.fn() }
jest.mock('@/stores', () => ({
    useMainStore: () => ({ activeWallet: wallet }),
    useAssetsStore: () => assets,
    useNotificationsStore: () => notes,
    useOfflineSigningStore: () => offline,
    isOfflineTxId: (id: string) => id.startsWith('offline:'),
}))
const auth = { calls: [] as string[] }
jest.mock('@/js/security/authorize', () => ({
    SessionAuthCancelled: class extends Error {},
    authorizeSingle: async (_w: unknown, label: string, fn: () => unknown) => {
        auth.calls.push(label)
        return fn()
    },
}))
jest.mock('@/AVA', () => ({ ava: { getNetworkID: () => 1 }, isValidAddress: (a: string) => /^P-avax1[a-z0-9]{3,}$/.test(a) }))
jest.mock('@/vue_components', () => ({
    QrInput: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<input class="qr" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
}))
const sendLayer = {
    utxos: [{ ID: () => 'u1' }, { ID: () => 'u2' }],
    preparePSend: jest.fn(),
}
const rowsP: CoinRow[] = [
    { utxoId: 'u1', txId: 'tx1', outputIdx: 0, assetId: 'AVAXID', amount: new BN(5_000_000_000), owners: ['P-avax1me'], ownAddress: 'P-avax1me', threshold: 1, locktime: 0, spendable: true },
    { utxoId: 'u2', txId: 'tx2', outputIdx: 0, assetId: 'AVAXID', amount: new BN(2_000_000_000), owners: ['P-avax1me2'], ownAddress: 'P-avax1me2', threshold: 1, locktime: 0, spendable: true },
    { utxoId: 'u3', txId: 'tx3', outputIdx: 0, assetId: 'AVAXID', amount: new BN(9_000_000_000), owners: ['P-avax1me'], threshold: 1, locktime: 99, spendable: false, reason: 'stake-locked until …' },
]
jest.mock('@/js/pChainSend', () => ({
    fetchPUtxos: async () => sendLayer.utxos,
    pCoinRows: () => rowsP,
    preparePSend: (p: any) => sendLayer.preparePSend(p),
}))

import CoinControl from '@/components/wallet/transfer/CoinControl.vue'
import FormP from '@/components/wallet/transfer/FormP.vue'

const stubs = {
    fa: true,
    SignOnlyToggle: true,
    SignedTxExport: true,
    'v-switch': { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<input type="checkbox" class="switch" :checked="modelValue" :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.checked)" />' },
    'v-btn': { props: ['disabled', 'loading'], emits: ['click'], template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
}

const preview = (inputs: { utxoId: string; amount: number }[], fee: number, change: number) => ({
    tx: { id: 'unsigned' },
    inputs: inputs.map((i) => ({ utxoId: i.utxoId, amount: new BN(i.amount) })),
    fee: new BN(fee),
    change: new BN(change),
    sending: new BN(0),
})

beforeEach(() => {
    jest.useRealTimers()
    wallet.issuePSend.mockClear()
    sendLayer.preparePSend.mockReset()
    auth.calls = []
    offline.hasRecords = false
})

describe('the coin-control picker', () => {
    const mountPicker = (props: Record<string, unknown> = {}) =>
        mount(CoinControl, { props: { rows: rowsP, modelValue: [], enabled: true, assets: { AVAXID: { symbol: 'AVAX', denomination: 9 } }, ...props }, global: { stubs } })

    it('lists UTXOs with amounts, and shows why the locked one cannot be picked', () => {
        const w = mountPicker()
        expect(w.text()).toContain('5 AVAX')
        expect(w.text()).toContain('stake-locked')
        const boxes = w.findAll('.rows input[type=checkbox]')
        expect(boxes.map((b) => (b.element as HTMLInputElement).disabled)).toEqual([false, false, true])
    })

    it('ticks, selects all spendable ones, clears, and totals the selection', async () => {
        const w = mountPicker()
        await w.findAll('.rows input[type=checkbox]')[1].setValue(true)
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([['u2']])
        await w.findAll('.actions button')[0].trigger('click')
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([['u1', 'u2']])
        await w.setProps({ modelValue: ['u1', 'u2'] })
        expect(w.find('.totals').text()).toContain('7 AVAX')
        await w.findAll('.actions button')[1].trigger('click')
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([[]])
    })

    it('asks for a pick when on with nothing ticked, and clears the pick when turned off', async () => {
        const w = mountPicker()
        expect(w.text()).toContain('Select at least one UTXO')
        await w.find('.switch').setValue(false)
        expect(w.emitted('update:enabled')!.at(-1)).toEqual([false])
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([[]])
    })
})

describe('change back to the same address', () => {
    const mountPicker = (props: Record<string, unknown> = {}) =>
        mount(CoinControl, { props: { rows: rowsP, modelValue: [], enabled: true, assets: { AVAXID: { symbol: 'AVAX', denomination: 9 } }, ...props }, global: { stubs } })

    it('is offered only when exactly one UTXO is picked, naming its address', async () => {
        const w = mountPicker({ modelValue: ['u2'] })
        expect(w.find('.same_change').text()).toContain('P-avax1me2')
        await w.setProps({ modelValue: ['u1', 'u2'] })
        expect(w.find('.same_change').exists()).toBe(false)
        await w.setProps({ modelValue: [] })
        expect(w.find('.same_change').exists()).toBe(false)
    })

    it('switches itself off when the selection changes', async () => {
        const w = mountPicker({ modelValue: ['u2'] })
        await w.find('.same_change input').setValue(true)
        expect(w.emitted('update:sameChange')!.at(-1)).toEqual([true])
        await w.setProps({ sameChange: true }) // the parent applies it
        await w.setProps({ modelValue: ['u1'] })
        expect(w.emitted('update:sameChange')!.at(-1)).toEqual([false])
    })
})

describe('the P-Chain send form', () => {
    const fill = async (w: any, to = 'P-avax1dest', amount = '1') => {
        await w.find('.qr').setValue(to)
        await w.find('.amount_in').setValue(amount)
    }
    const settle = async () => {
        await new Promise((r) => setTimeout(r, 450))
        await flushPromises()
    }

    it('shows the spendable balance and the staked remainder', async () => {
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        expect(w.find('.balance').text()).toContain('7 AVAX')
        expect(w.text()).toContain('Plus 9 AVAX staked or locked')
        w.unmount()
    })

    it('previews the real transaction, then signs exactly that one behind the session gate', async () => {
        sendLayer.preparePSend.mockResolvedValue(preview([{ utxoId: 'u1', amount: 5_000_000_000 }], 1_000_000, 3_999_000_000))
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await fill(w)
        await settle()
        expect(w.find('.preview').text()).toContain('spends 1 UTXO')
        expect(w.find('.preview').text()).toContain('0.001 AVAX')
        expect(w.find('.preview').text()).toContain('3.999 AVAX')
        await w.find('button.v_btn').trigger('click') // Confirm
        await flushPromises()
        const confirmParams = sendLayer.preparePSend.mock.calls.at(-1)![0]
        expect(confirmParams).toMatchObject({ to: 'P-avax1dest', amount: 1_000_000_000n, fromAddresses: ['P-avax1me', 'P-avax1me2'], changeAddress: 'P-avax1me' })
        expect(confirmParams.utxos).toBeUndefined()
        await w.findAll('button.v_btn').find((b) => b.text() === 'Send')!.trigger('click')
        await flushPromises()
        expect(auth.calls).toEqual(['Send a P-chain transaction'])
        expect((wallet.issuePSend.mock.calls[0] as any)[0].tx).toEqual({ id: 'unsigned' })
        expect(w.text()).toContain('txid123')
        w.unmount()
    })

    it('with coin control on, builds from the picked UTXOs only', async () => {
        sendLayer.preparePSend.mockResolvedValue(preview([{ utxoId: 'u2', amount: 2_000_000_000 }], 1_000_000, 999_000_000))
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await w.find('.switch').setValue(true)
        await w.findAll('.rows input[type=checkbox]')[1].setValue(true) // u2
        await fill(w)
        await settle()
        const params = sendLayer.preparePSend.mock.calls.at(-1)![0]
        expect(params.utxos.map((u: any) => u.ID())).toEqual(['u2'])
        w.unmount()
    })

    it('sends the change to the picked UTXO’s own address when asked', async () => {
        sendLayer.preparePSend.mockResolvedValue(preview([{ utxoId: 'u2', amount: 2_000_000_000 }], 1_000_000, 999_000_000))
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await w.find('.switch').setValue(true)
        await w.findAll('.rows input[type=checkbox]')[1].setValue(true) // u2, owned by P-avax1me2
        await fill(w)
        await settle()
        expect(sendLayer.preparePSend.mock.calls.at(-1)![0].changeAddress).toBe('P-avax1me')
        await w.find('.same_change input').setValue(true)
        await settle()
        expect(sendLayer.preparePSend.mock.calls.at(-1)![0].changeAddress).toBe('P-avax1me2')
        expect(w.find('.preview').text()).toContain('P-avax1me2')
        w.unmount()
    })

    it('blocks Confirm while coin control is on with nothing picked', async () => {
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await w.find('.switch').setValue(true)
        await fill(w)
        expect((w.find('button.v_btn').element as HTMLButtonElement).disabled).toBe(true)
        w.unmount()
    })

    it('explains a shortfall in terms of the picked UTXOs', async () => {
        sendLayer.preparePSend.mockRejectedValue(new Error('insufficient funds'))
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await w.find('.switch').setValue(true)
        await w.findAll('.rows input[type=checkbox]')[1].setValue(true)
        await fill(w, 'P-avax1dest', '50')
        await settle()
        expect(w.text()).toContain('The selected UTXOs don’t cover the amount plus the fee.')
        w.unmount()
    })

    it('refuses a non-P destination', async () => {
        const w = mount(FormP, { global: { stubs } })
        await flushPromises()
        await fill(w, 'X-avax1dest')
        expect((w.find('button.v_btn').element as HTMLButtonElement).disabled).toBe(true)
        w.unmount()
    })
})
