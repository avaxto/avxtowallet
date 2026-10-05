/**
 * @jest-environment node
 */
/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The QuickJS sandbox itself: what a script can and cannot reach, and the
 * bounds that stop it (deadline, memory, host-call cap, abort). These run the
 * real wasm engine.
 */
import { runInSandbox, MAX_SYNC_MS, type SandboxOptions } from '@/scripting/engine'

function opts(over: Partial<SandboxOptions> = {}): SandboxOptions & { logs: string[]; calls: [string, unknown[]][] } {
    const logs: string[] = []
    const calls: [string, unknown[]][] = []
    return Object.assign(
        {
            hostCall: async (name: string, args: unknown[]) => {
                calls.push([name, args])
                return { echo: name, args }
            },
            onLog: (l: string) => logs.push(l),
            deadlineMs: 5000,
            logs,
            calls,
        },
        over
    )
}

jest.setTimeout(30_000)

describe('isolation', () => {
    it('has no network, DOM, timers, storage, wasm or module loading — and no raw host bridge', async () => {
        const o = opts()
        const res = await runInSandbox(
            `return [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof window, typeof document,
                     typeof localStorage, typeof setTimeout, typeof WebAssembly, typeof require, typeof process,
                     typeof importScripts, typeof __host, typeof __log, typeof Function('return this')().fetch]`,
            o
        )
        expect(res.ok).toBe(true)
        expect(res.value).toEqual(Array(14).fill('undefined'))
    })

    it('cannot load code from anywhere', async () => {
        const res = await runInSandbox(`return await import('https://evil.example/x.js')`, opts())
        expect(res.ok).toBe(false)
    })

    it('reaches the host only through the API, with JSON on both sides', async () => {
        const o = opts()
        const res = await runInSandbox(
            `const b = await wallet.balance('avalanche', { chain: 'C' }); log('got', b); return b`,
            o
        )
        expect(res.ok).toBe(true)
        expect(o.calls).toEqual([['wallet.balance', ['avalanche', { chain: 'C' }]]])
        expect(res.value).toEqual({ echo: 'wallet.balance', args: ['avalanche', { chain: 'C' }] })
        expect(o.logs[0]).toMatch(/^got \{"echo":"wallet.balance"/)
    })

    it('raises host errors inside the script, where it can catch them', async () => {
        const o = opts({
            hostCall: async () => {
                throw new Error('No budget allows spending AVAX')
            },
        })
        const res = await runInSandbox(
            `try { await tx.send({ platform: 'avalanche', to: 'x', amount: '1' }) } catch (e) { return 'caught: ' + e.message }`,
            o
        )
        expect(res).toMatchObject({ ok: true, value: 'caught: No budget allows spending AVAX' })
    })

    it('reports a script error with its message', async () => {
        const res = await runInSandbox(`throw new Error('boom')`, opts())
        expect(res).toMatchObject({ ok: false, error: 'boom' })
        const syntax = await runInSandbox(`return (`, opts())
        expect(syntax.ok).toBe(false)
        expect(syntax.error).toMatch(/SyntaxError/)
    })

    it('freezes the API objects so a script cannot swap them out', async () => {
        const res = await runInSandbox(`tx.send = () => 'mine'; return Object.isFrozen(tx) && tx.send !== undefined`, opts())
        expect(res).toMatchObject({ ok: true, value: true })
    })
})

describe('bounds', () => {
    it('stops an infinite loop at the deadline', async () => {
        const t = Date.now()
        const res = await runInSandbox(`while (true) {}`, opts({ deadlineMs: 300 }))
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/ran longer than/)
        expect(Date.now() - t).toBeLessThan(3000)
    })

    it('stops a script stuck waiting on the host at the deadline', async () => {
        const res = await runInSandbox(`await wallet.balances('evm'); return 'never'`, opts({ deadlineMs: 300, hostCall: () => new Promise(() => {}) }))
        expect(res).toMatchObject({ ok: false })
        expect(res.error).toMatch(/ran longer than/)
    })

    it('caps memory', async () => {
        const res = await runInSandbox(`return 'x'.repeat(50 * 1024 * 1024).length`, opts({ memoryBytes: 8 * 1024 * 1024 }))
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/out of memory/i)
    })

    it('caps host calls per run', async () => {
        const o = opts({ maxHostCalls: 3 })
        const res = await runInSandbox(`for (let i = 0; i < 10; i++) await wallet.platforms()`, o)
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Too many wallet calls \(limit 3/)
        expect(o.calls).toHaveLength(3)
    })

    it('stops a compute loop within seconds even when the deadline is long — the page thread must not freeze', async () => {
        const t = Date.now()
        const res = await runInSandbox(`while (true) {}`, opts({ deadlineMs: 600_000 }))
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/computed for over 3 s without pausing/)
        expect(Date.now() - t).toBeLessThan(MAX_SYNC_MS + 2000)
    })

    it('honours abort between host calls, before the next one runs', async () => {
        const c = new AbortController()
        const seen: string[] = []
        const o = opts({
            signal: c.signal,
            hostCall: async (name) => {
                seen.push(name)
                c.abort()
                return name
            },
        })
        const res = await runInSandbox(`await wallet.platforms(); await tx.send({}); return 'sent'`, o)
        expect(res).toMatchObject({ ok: false, error: 'Aborted.' })
        expect(seen).toEqual(['wallet.platforms'])
    })

    it('honours abort while the script waits on the host', async () => {
        const c = new AbortController()
        setTimeout(() => c.abort(), 100)
        const res = await runInSandbox(`await sleep(50000)`, opts({ signal: c.signal, hostCall: () => new Promise(() => {}) }))
        expect(res).toMatchObject({ ok: false, error: 'Aborted.' })
    })

    it('limits console output', async () => {
        const o = opts()
        await runInSandbox(`for (let i = 0; i < 5000; i++) log('line ' + i)`, o)
        expect(o.logs.length).toBe(1000)
        expect(o.logs[999]).toMatch(/limit reached/)
    })

    it('runs one script after another on the same engine', async () => {
        for (let i = 0; i < 3; i++) {
            const res = await runInSandbox(`return ${i} * 2`, opts())
            expect(res).toMatchObject({ ok: true, value: i * 2 })
        }
    })
})
