/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Wallet Scripts page (/wallet/scripts): planning is open to everyone,
 * approving a plan and running live go through the premium gate, the review
 * shows full addresses and totals, live needs a budget, and an imported
 * script cannot run until the user says they read it.
 */
import { flushPromises, mount } from '@vue/test-utils'

import type { Intent } from '@/scripting/types'

const intent = (index: number, to: string, amount: string): Intent => ({
    index,
    kind: 'send',
    platform: 'avalanche',
    chain: 'C',
    chainLabel: 'Avalanche C-Chain',
    isTestnet: false,
    evmChainId: 43114,
    to,
    asset: { id: 'native', symbol: 'AVAX', decimals: 18 },
    amount,
    amountBase: BigInt(Math.round(Number(amount) * 1e6)).toString() + '000000000000',
    summary: `Send ${amount} AVAX to ${to} on Avalanche C-Chain`,
})
const A = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
const B = '0x0000000000000000000000000000000000000002'

const runScript = jest.fn()
const executePlan = jest.fn()
jest.mock('@/scripting/runner', () => ({
    DEFAULT_MAX_SENDS: 5,
    runScript: (...a: any[]) => runScript(...a),
    executePlan: (...a: any[]) => executePlan(...a),
    reviewPlan: (intents: Intent[]) => ({
        totals: intents.length
            ? [{ key: 'k', symbol: 'AVAX', decimals: 18, chainLabel: 'Avalanche C-Chain', total: intents.reduce((s, i) => s + BigInt(i.amountBase), BigInt(0)), count: intents.length }]
            : [],
        blockers: intents.map(() => ''),
        prompts: 1,
    }),
}))
jest.mock('@/scripting/budget', () => ({
    budgetCandidates: async () => [{ key: 'avalanche|c|native', label: 'Avalanche · C-Chain', symbol: 'AVAX', decimals: 18, max: '', balance: '12.5' }],
    tokenBudgetLine: async () => {
        throw new Error('nope')
    },
}))
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

import Scripting from '@/views/wallet/Scripting.vue'
import { savedScripts, saveScript, deleteScript } from '@/scripting/library'

const stubs = {
    fa: true,
    'v-btn': {
        props: ['disabled', 'loading'],
        emits: ['click'],
        template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}
const button = (w: any, text: RegExp) => w.findAll('button.v_btn').find((b: any) => text.test(b.text()))

beforeEach(() => {
    gate.open = true
    gate.blocked = false
    gate.checks = 0
    runScript.mockReset()
    executePlan.mockReset()
    savedScripts.value.slice().forEach((s) => deleteScript(s.id))
})

function planned(intents: Intent[]) {
    runScript.mockImplementation(async (_src: string, o: any) => {
        o.onLog('hello from the script')
        intents.forEach((i) => o.onIntent(i))
        return { ok: true, value: null, hostCalls: intents.length, elapsedMs: 12, intents, results: [] }
    })
}

describe('the Wallet Scripts page', () => {
    it('plans without the gate, then shows every step with its full address and the totals', async () => {
        planned([intent(1, A, '1.5'), intent(2, B, '0.25')])
        const w = mount(Scripting, { global: { stubs } })
        await button(w, /Run and plan/).trigger('click')
        await flushPromises()

        expect(gate.checks).toBe(0)
        expect(runScript.mock.calls[0][1].mode).toBe('plan')
        expect(w.text()).toContain('hello from the script')
        expect(w.text()).toContain('This script will:')
        expect(w.findAll('.plan_list li')).toHaveLength(2)
        expect(w.findAll('code.addr').map((c) => c.text())).toEqual([A, B])
        expect(w.text()).toContain('Send 1.5 AVAX')
        expect(w.text()).toContain('MAINNET')
        expect(w.text()).toContain('Total out:')
        expect(w.text()).toContain('1.75 AVAX')
        expect(w.text()).toContain('1 password prompt')
        w.unmount()
    })

    it('executes exactly the reviewed plan through the gate', async () => {
        const plan = [intent(1, A, '1.5')]
        planned(plan)
        executePlan.mockImplementation(async (intents: Intent[], o: any) => {
            o.onResult({ index: 1, status: 'done', txId: '0xsent', explorerUrl: 'https://snowtrace.io/tx/0xsent' })
            return []
        })
        const w = mount(Scripting, { global: { stubs } })
        await button(w, /Run and plan/).trigger('click')
        await flushPromises()
        await button(w, /Approve and execute/).trigger('click')
        await flushPromises()

        expect(gate.checks).toBe(1)
        expect(executePlan.mock.calls[0][0]).toEqual(plan)
        expect(w.text()).toContain('Sent')
        expect(w.find('a[href="https://snowtrace.io/tx/0xsent"]').exists()).toBe(true)
        // Finished: no second approval.
        expect(button(w, /Approve and execute/)).toBeUndefined()
        w.unmount()
    })

    it('executes nothing when the premium requirement is not met', async () => {
        planned([intent(1, A, '1')])
        gate.open = false
        const w = mount(Scripting, { global: { stubs } })
        await button(w, /Run and plan/).trigger('click')
        await flushPromises()
        await button(w, /Approve and execute/).trigger('click')
        await flushPromises()
        expect(gate.checks).toBe(1)
        expect(executePlan).not.toHaveBeenCalled()
        w.unmount()
    })

    it('discards the plan of a script that failed part-way', async () => {
        runScript.mockImplementation(async (_s: string, o: any) => {
            o.onIntent(intent(1, A, '1'))
            return { ok: false, error: 'boom', hostCalls: 1, elapsedMs: 3, intents: [], results: [] }
        })
        const w = mount(Scripting, { global: { stubs } })
        await button(w, /Run and plan/).trigger('click')
        await flushPromises()
        expect(w.text()).toContain('boom')
        expect(w.text()).toContain('its plan was discarded')
        expect(w.text()).not.toContain('This script will:')
        w.unmount()
    })

    it('needs a budget, and the gate, to run live', async () => {
        runScript.mockResolvedValue({ ok: true, value: null, hostCalls: 0, elapsedMs: 1, intents: [], results: [] })
        const w = mount(Scripting, { global: { stubs } })
        await w.findAll('.mode input')[1].setValue(true)
        await flushPromises()
        expect(w.text()).toContain('Live mode signs real transactions')
        expect(button(w, /Run live/).attributes('disabled')).toBeDefined()

        await w.findAll('.budget_head button')[0].trigger('click')
        await flushPromises()
        await w.find('.budget input').setValue('2')
        expect(button(w, /Run live/).attributes('disabled')).toBeUndefined()
        await button(w, /Run live/).trigger('click')
        await flushPromises()
        expect(gate.checks).toBe(1)
        const o = runScript.mock.calls[0][1]
        expect(o.mode).toBe('live')
        expect(o.budget.map((b: any) => [b.key, b.max])).toEqual([['avalanche|c|native', '2']])
        expect(o.maxSends).toBe(5)
        w.unmount()
    })

    it('will not run an imported script until the user has read it', async () => {
        saveScript({ id: 'imp1', name: 'From Discord', source: 'log(1)', imported: true, reviewed: false, updatedAt: 1 })
        runScript.mockResolvedValue({ ok: true, value: null, hostCalls: 0, elapsedMs: 1, intents: [], results: [] })
        const w = mount(Scripting, { global: { stubs } })
        await w.find('.lib_select').setValue('imp1')
        await flushPromises()
        expect(w.text()).toContain('You did not write this script.')
        expect(button(w, /Run and plan/).attributes('disabled')).toBeDefined()

        await w.find('.review_banner input').setValue(true)
        await flushPromises()
        expect(w.text()).not.toContain('You did not write this script.')
        expect(savedScripts.value.find((s) => s.id === 'imp1')?.reviewed).toBe(true)
        expect(button(w, /Run and plan/).attributes('disabled')).toBeUndefined()
        w.unmount()
    })

    it('loads examples and saves scripts locally', async () => {
        const w = mount(Scripting, { global: { stubs } })
        await w.find('.lib_select').setValue('example:0')
        await flushPromises()
        expect((w.find('textarea.editor').element as HTMLTextAreaElement).value).toContain('wallet.platforms()')
        await w.find('.name_input').setValue('My report')
        await w.findAll('.bar_buttons button')[0].trigger('click')
        expect(savedScripts.value.map((s) => [s.name, s.imported])).toEqual([['My report', false]])
        expect(JSON.parse(localStorage.getItem('wallet_scripts_v1') ?? '[]')).toHaveLength(1)
        w.unmount()
    })
})
