/**
 * @jest-environment node
 */
/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Plan mode, live mode and plan execution, with the real sandbox and the
 * wallet underneath replaced: what gets recorded, what gets signed, budgets,
 * caps, abort, and one authorization per run of same-wallet steps.
 */
import type { Intent } from '@/scripting/types'

// ── the wallet underneath ──
const executed: Intent[] = []
const blockers = new Map<number, string>()
const subjects: Record<string, object> = { avalanche: { w: 'avalanche' }, evm: { w: 'evm' }, solana: { w: 'solana' } }
const execMock = jest.fn(async (i: Intent) => {
    executed.push(i)
    return { txId: `0xtx${i.index}`, explorerUrl: `https://explorer/tx/${i.index}` }
})
jest.mock('@/scripting/execute', () => ({
    readiness: (i: Intent) => blockers.get(i.index) ?? '',
    authSubjectFor: (i: Intent) => subjects[i.platform],
    executeIntent: (i: Intent) => execMock(i),
}))

// Intents: resolved from the script's arguments the simple way.
jest.mock('@/scripting/intents', () => {
    const make = (o: any, index: number, kind: 'send' | 'crossChain') => {
        if (typeof o?.amount !== 'string') throw new Error('Amount must be a decimal string like "1.5".')
        const platform = kind === 'crossChain' ? 'avalanche' : o.platform
        const decimals = platform === 'avalanche' ? 18 : 9
        const [w, f = ''] = o.amount.split('.')
        return {
            index,
            kind,
            platform,
            chain: kind === 'crossChain' ? o.from : platform === 'avalanche' ? 'C' : 'mainnet-beta',
            chainLabel: platform,
            isTestnet: false,
            to: o.to,
            asset: { id: 'native', symbol: platform === 'avalanche' ? 'AVAX' : 'SOL', decimals },
            amount: o.amount,
            amountBase: BigInt(w + f.padEnd(decimals, '0')).toString(),
            summary: `Send ${o.amount} to ${o.to}`,
        }
    }
    return {
        normalizeSend: async (o: any, i: number) => make(o, i, 'send'),
        normalizeCrossChain: async (o: any, i: number) => make(o, i, 'crossChain'),
    }
})
jest.mock('@/scripting/reads', () => ({
    readPlatforms: () => [{ id: 'avalanche', connected: true }],
    readAddresses: () => [],
    readAddress: () => '0xme',
    readBalances: async () => [{ chain: 'C', asset: 'native', symbol: 'AVAX', decimals: 18, amount: '12.5' }],
    readBalance: async () => '12.5',
    readNetwork: () => ({ id: 'mainnet' }),
    readToken: async () => ({}),
}))

// Authorization: one prompt per scope, nested calls reuse it, a different wallet is refused while one is open.
const prompts: unknown[] = []
let ambient: unknown = null
jest.mock('@/js/security/authorize', () => ({
    authorizeBatch: async (w: unknown, _reason: string, fn: () => Promise<unknown>) => {
        if (ambient) {
            if (ambient !== w) throw new Error('SessionBusy')
            return fn()
        }
        prompts.push(w)
        ambient = w
        try {
            return await fn()
        } finally {
            ambient = null
        }
    },
}))

import { runScript, executePlan, reviewPlan, budgetLimits } from '@/scripting/runner'
import type { BudgetLine } from '@/scripting/types'

jest.setTimeout(30_000)

const AVAX = (max: string): BudgetLine => ({ key: 'avalanche|C|native', label: 'Avalanche C', symbol: 'AVAX', decimals: 18, max })
const run = (src: string, extra: any = {}) => {
    const logs: string[] = []
    return runScript(src, Object.assign({ mode: 'plan', onLog: (l: string) => logs.push(l) }, extra)).then((r) => Object.assign(r, { logs }))
}

beforeEach(() => {
    executed.length = 0
    prompts.length = 0
    blockers.clear()
    execMock.mockClear()
})

describe('plan mode', () => {
    it('records tx calls without signing anything', async () => {
        const res = await run(`
            const a = await tx.send({ platform: 'avalanche', to: '0xA', amount: '1.5' })
            await tx.send({ platform: 'solana', to: 'SoLRecipient', amount: '2' })
            log(JSON.stringify(a))
        `)
        expect(res.ok).toBe(true)
        expect(res.intents.map((i) => [i.index, i.platform, i.to, i.amount])).toEqual([
            [1, 'avalanche', '0xA', '1.5'],
            [2, 'solana', 'SoLRecipient', '2'],
        ])
        expect(res.logs[0]).toBe('{"planned":true,"step":1,"summary":"Send 1.5 to 0xA"}')
        expect(execMock).not.toHaveBeenCalled()
        expect(prompts).toEqual([])
    })

    it('reads balances through the read API', async () => {
        const res = await run(`return await wallet.balance('avalanche')`)
        expect(res).toMatchObject({ ok: true, value: '12.5' })
    })

    it('strips TypeScript types and refuses module syntax', async () => {
        const ts = await run(`const n: number = 2; interface P { a: string }; const p: P = { a: 'x' }; return n + p.a`)
        expect(ts).toMatchObject({ ok: true, value: '2x' })
        const mod = await run(`import x from 'https://evil.example/x.js'\nreturn 1`)
        expect(mod.ok).toBe(false)
        expect(mod.error).toMatch(/cannot use "import"/)
    })

    it('surfaces bad arguments as script errors', async () => {
        const res = await run(`await tx.send({ platform: 'avalanche', to: '0xA', amount: 1.5 })`)
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/decimal string/)
    })

    it('bounds sleep', async () => {
        const res = await run(`await sleep(120000)`)
        expect(res.error).toMatch(/sleep\(ms\) takes 0 to 60000/)
    })
})

describe('live mode', () => {
    it('refuses assets with no budget', async () => {
        const res = await run(`await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' })`, { mode: 'live', budget: [] })
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/No budget allows spending AVAX/)
        expect(execMock).not.toHaveBeenCalled()
    })

    it('sends within the budget under one authorization, and stops at the limit', async () => {
        const res = await run(
            `
            const a = await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' })
            const b = await tx.send({ platform: 'avalanche', to: '0xB', amount: '0.5' })
            log(a.txId, b.txId)
            try { await tx.send({ platform: 'avalanche', to: '0xC', amount: '0.6' }) } catch (e) { log(e.message) }
            `,
            { mode: 'live', budget: [AVAX('2')], maxSends: 5 }
        )
        expect(res.ok).toBe(true)
        expect(executed.map((i) => i.to)).toEqual(['0xA', '0xB'])
        expect(res.logs[0]).toBe('0xtx1 0xtx2')
        expect(res.logs[1]).toMatch(/Over budget: .* AVAX spent to 2.1, above the 2 allowed/)
        expect(prompts).toEqual([subjects.avalanche])
        expect(res.results.map((r) => r.status)).toEqual(['done', 'done'])
    })

    it('caps the number of transactions', async () => {
        const res = await run(`for (let i = 0; i < 5; i++) await tx.send({ platform: 'avalanche', to: '0x' + i, amount: '0.1' })`, {
            mode: 'live',
            budget: [AVAX('100')],
            maxSends: 2,
        })
        expect(res.error).toMatch(/at most 2 transactions/)
        expect(executed).toHaveLength(2)
    })

    it('counts a failed send against the budget, so it cannot be retried past it', async () => {
        execMock.mockRejectedValueOnce(new Error('nonce too low'))
        const res = await run(
            `
            try { await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' }) } catch (e) { log(e.message) }
            await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' })
            `,
            { mode: 'live', budget: [AVAX('1')] }
        )
        expect(res.logs[0]).toBe('nonce too low')
        expect(res.error).toMatch(/Over budget/)
        expect(res.results.map((r) => r.status)).toEqual(['failed'])
    })

    it('stops at abort before the next transaction', async () => {
        const c = new AbortController()
        execMock.mockImplementationOnce(async (i: Intent) => {
            c.abort()
            executed.push(i)
            return { txId: '0xfirst' } as any
        })
        const res = await run(
            `await tx.send({ platform: 'avalanche', to: '0xA', amount: '0.1' }); await tx.send({ platform: 'avalanche', to: '0xB', amount: '0.1' })`,
            { mode: 'live', budget: [AVAX('1')], signal: c.signal }
        )
        expect(res).toMatchObject({ ok: false, error: 'Aborted.' })
        expect(executed.map((i) => i.to)).toEqual(['0xA'])
    })

    it('refuses a step the wallet cannot sign right now', async () => {
        blockers.set(1, 'Open the Avalanche tab to execute Avalanche steps.')
        const res = await run(`await tx.send({ platform: 'avalanche', to: '0xA', amount: '0.1' })`, { mode: 'live', budget: [AVAX('1')] })
        expect(res.error).toMatch(/Open the Avalanche tab/)
        expect(execMock).not.toHaveBeenCalled()
    })

    it('rejects a malformed budget', () => {
        expect(() => budgetLimits([AVAX('1.0000000000000000001')])).toThrow(/more than 18 decimal places/)
        expect(budgetLimits([AVAX(''), AVAX('0')]).size).toBe(0)
    })
})

describe('executing a plan', () => {
    const planOf = async (src: string) => (await run(src)).intents

    it('executes exactly the recorded intents, in order, one prompt per run of same-wallet steps', async () => {
        const plan = await planOf(`
            await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' })
            await tx.send({ platform: 'avalanche', to: '0xB', amount: '2' })
            await tx.send({ platform: 'solana', to: 'So1', amount: '3' })
        `)
        expect(reviewPlan(plan)).toMatchObject({ prompts: 2, blockers: ['', '', ''] })
        expect(reviewPlan(plan).totals.map((t) => [t.symbol, t.total.toString()])).toEqual([
            ['AVAX', '3000000000000000000'],
            ['SOL', '3000000000'],
        ])
        const seen: string[] = []
        const results = await executePlan(plan, { onResult: (r) => seen.push(`${r.index}:${r.status}`) })
        expect(executed).toEqual(plan)
        expect(results.map((r) => r.txId)).toEqual(['0xtx1', '0xtx2', '0xtx3'])
        expect(prompts).toEqual([subjects.avalanche, subjects.solana])
        expect(seen).toContain('3:done')
    })

    it('stops at the first failure and skips the rest', async () => {
        const plan = await planOf(`for (const to of ['0xA', '0xB', '0xC']) await tx.send({ platform: 'avalanche', to, amount: '1' })`)
        execMock.mockImplementation(async (i: Intent) => {
            if (i.index === 2) throw new Error('insufficient funds')
            executed.push(i)
            return { txId: `0xtx${i.index}` } as any
        })
        const results: any[] = []
        await expect(executePlan(plan, { onResult: (r) => (results[r.index - 1] = Object.assign({}, r)) })).rejects.toThrow('insufficient funds')
        expect(results.map((r) => r.status)).toEqual(['done', 'failed', 'skipped'])
        expect(executed.map((i) => i.to)).toEqual(['0xA'])
        execMock.mockImplementation(async (i: Intent) => {
            executed.push(i)
            return { txId: `0xtx${i.index}` } as any
        })
    })

    it('refuses to start when any step is blocked', async () => {
        const plan = await planOf(`await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' }); await tx.send({ platform: 'evm', to: '0xB', amount: '1' })`)
        blockers.set(2, 'The EVM wallet is on Base; this step is for Ethereum.')
        expect(reviewPlan(plan).blockers[1]).toMatch(/Base/)
        await expect(executePlan(plan, { onResult: () => {} })).rejects.toThrow(/Base/)
        expect(execMock).not.toHaveBeenCalled()
    })

    it('stops before the next signature on abort', async () => {
        const plan = await planOf(`await tx.send({ platform: 'avalanche', to: '0xA', amount: '1' }); await tx.send({ platform: 'avalanche', to: '0xB', amount: '1' })`)
        const c = new AbortController()
        execMock.mockImplementationOnce(async (i: Intent) => {
            c.abort()
            executed.push(i)
            return { txId: '0x1' } as any
        })
        const results = await executePlan(plan, { onResult: () => {}, signal: c.signal })
        expect(results.map((r) => r.status)).toEqual(['done', 'skipped'])
    })
})
