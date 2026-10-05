/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Runs a script and executes plans. This is the host side of the sandbox: the
 * enumerated list of calls a script can make (rule R2 — nothing is exposed by
 * reflection), and the two ways value can move.
 *
 * PLAN mode (default): `tx.*` calls are validated and RECORDED, nothing is
 * signed. The user reviews the resulting list; approving executes exactly
 * those recorded intents with `executePlan` — the script does not run again,
 * so what executes cannot branch away from what was shown.
 *
 * LIVE mode (explicit opt-in): `tx.*` really sends, during the run, but only
 * within a per-asset budget and a send-count cap the user set before starting,
 * and only until Abort. An asset with no budget line cannot be spent at all.
 *
 * Nothing that reads secrets is reachable from here (rule R3): there is no
 * call that returns a key, phrase or vault, and scripts never see a wallet
 * object — only JSON.
 */
import { runInSandbox, type SandboxResult } from './engine'
import { toJavaScript, moduleSyntaxError } from './transpile'
import { readAddress, readAddresses, readBalance, readBalances, readNetwork, readPlatforms, readToken } from './reads'
import { normalizeCrossChain, normalizeSend } from './intents'
import { authSubjectFor, executeIntent, readiness } from './execute'
import { ScopeHolder } from './scope'
import { fromBaseUnits, intentKey, intentTotals, toBaseUnits, type BudgetLine, type Intent, type RunMode, type StepResult } from './types'

export const PLAN_DEADLINE_MS = 60_000
/** Inside the 10 minute BATCH authorization window. */
export const LIVE_DEADLINE_MS = 9 * 60_000
export const MAX_PLANNED_INTENTS = 100
export const MAX_SLEEP_MS = 60_000
export const DEFAULT_MAX_SENDS = 5

export interface RunOptions {
    mode: RunMode
    onLog(line: string): void
    onIntent?(intent: Intent): void
    /** Live mode: progress of each send. */
    onStep?(intent: Intent, result: StepResult): void
    budget?: BudgetLine[]
    maxSends?: number
    signal?: AbortSignal
    deadlineMs?: number
    /** Live mode: holds the authorization across sends. Released by the runner when the run ends. */
    scope?: ScopeHolder
}

export interface RunOutcome extends SandboxResult {
    intents: Intent[]
    results: StepResult[]
}

/** The budget each asset key may spend in a live run, in base units. Lines with no amount are absent. */
export function budgetLimits(budget: BudgetLine[]): Map<string, bigint> {
    const m = new Map<string, bigint>()
    for (const b of budget) {
        const t = (b.max ?? '').trim()
        if (!t || /^0*\.?0*$/.test(t)) continue
        m.set(b.key, toBaseUnits(t, b.decimals, `Budget for ${b.symbol}`))
    }
    return m
}

export function budgetReason(budget: BudgetLine[]): string {
    const parts = budget.filter((b) => (b.max ?? '').trim() && !/^0*\.?0*$/.test(b.max.trim())).map((b) => `${b.max} ${b.symbol} (${b.label})`)
    return parts.length ? `up to ${parts.join(', ')}` : 'no spending allowed'
}

/** Runs `source` (TypeScript or JavaScript) in the sandbox. */
export async function runScript(source: string, opts: RunOptions): Promise<RunOutcome> {
    const intents: Intent[] = []
    const results: StepResult[] = []
    const fail = (error: string): RunOutcome => ({ ok: false, error, hostCalls: 0, elapsedMs: 0, intents, results })

    const moduleErr = moduleSyntaxError(source)
    if (moduleErr) return fail(moduleErr)
    let code: string
    try {
        code = await toJavaScript(source)
    } catch (e: any) {
        return fail(e.message)
    }

    const live = opts.mode === 'live'
    let limits = new Map<string, bigint>()
    try {
        limits = live ? budgetLimits(opts.budget ?? []) : limits
    } catch (e: any) {
        return fail(e.message)
    }
    const spent = new Map<string, bigint>()
    const maxSends = opts.maxSends ?? DEFAULT_MAX_SENDS
    const scope = opts.scope ?? new ScopeHolder()
    const reason = live ? `Live script — ${budgetReason(opts.budget ?? [])}, at most ${maxSends} transactions` : ''

    const record = async (intent: Intent) => {
        if (intents.length >= (live ? maxSends : MAX_PLANNED_INTENTS)) {
            throw new Error(live ? `This live run allows at most ${maxSends} transactions.` : `A plan can hold at most ${MAX_PLANNED_INTENTS} transactions.`)
        }
        if (!live) {
            intents.push(intent)
            opts.onIntent?.(intent)
            return { planned: true, step: intent.index, summary: intent.summary }
        }
        if (opts.signal?.aborted) throw new Error('Aborted.')
        const key = intentKey(intent)
        const limit = limits.get(key)
        if (limit === undefined) throw new Error(`No budget allows spending ${intent.asset.symbol} on ${intent.chainLabel}. Set one before running live.`)
        const after = (spent.get(key) ?? BigInt(0)) + BigInt(intent.amountBase)
        if (after > limit) {
            throw new Error(
                `Over budget: ${intent.summary} would bring ${intent.asset.symbol} spent to ${fromBaseUnits(after, intent.asset.decimals)}, above the ${fromBaseUnits(limit, intent.asset.decimals)} allowed.`
            )
        }
        const notReady = readiness(intent)
        if (notReady) throw new Error(notReady)
        intents.push(intent)
        // Counted against the budget before signing, so a failure part-way can never be retried past it.
        spent.set(key, after)
        const step: StepResult = { index: intent.index, status: 'running' }
        results.push(step)
        opts.onStep?.(intent, step)
        try {
            const r = await scope.run(authSubjectFor(intent), reason, () => executeIntent(intent))
            Object.assign(step, { status: 'done', txId: r.txId, txIds: r.txIds, explorerUrl: r.explorerUrl })
            opts.onStep?.(intent, step)
            return { step: intent.index, txId: r.txId, txIds: r.txIds ?? [r.txId], explorerUrl: r.explorerUrl ?? null }
        } catch (e: any) {
            Object.assign(step, { status: 'failed', error: e?.message ?? String(e) })
            opts.onStep?.(intent, step)
            throw e
        }
    }

    const api: Record<string, (args: unknown[]) => unknown> = {
        'wallet.platforms': () => readPlatforms(),
        'wallet.addresses': ([p]) => readAddresses(p),
        'wallet.address': ([p, chain]) => readAddress(p, chain),
        'wallet.balances': ([p]) => readBalances(p),
        'wallet.balance': ([p, o]) => readBalance(p, o),
        'wallet.token': ([p, address]) => readToken(p, address),
        'network.info': ([p]) => readNetwork(p),
        'run.info': () => ({
            mode: opts.mode,
            maxTransactions: live ? maxSends : MAX_PLANNED_INTENTS,
            transactions: intents.length,
            budget: live ? (opts.budget ?? []).map((b) => ({ asset: b.symbol, chain: b.label, max: b.max || '0' })) : null,
        }),
        'tx.send': async ([o]) => record(await normalizeSend(o, intents.length + 1)),
        'tx.crossChain': async ([o]) => record(await normalizeCrossChain(o, intents.length + 1)),
        sleep: ([ms]) => {
            const n = Number(ms)
            if (!Number.isFinite(n) || n < 0 || n > MAX_SLEEP_MS) throw new Error(`sleep(ms) takes 0 to ${MAX_SLEEP_MS} ms.`)
            return new Promise((resolve) => setTimeout(resolve, n))
        },
    }

    try {
        const res = await runInSandbox(code, {
            hostCall: async (name, args) => {
                const fn = Object.prototype.hasOwnProperty.call(api, name) ? api[name] : undefined
                if (!fn) throw new Error(`Unknown wallet call "${name}".`)
                return fn(args)
            },
            onLog: opts.onLog,
            deadlineMs: opts.deadlineMs ?? (live ? LIVE_DEADLINE_MS : PLAN_DEADLINE_MS),
            signal: opts.signal,
        })
        return Object.assign(res, { intents, results })
    } finally {
        if (live) await scope.releaseNow()
    }
}

export interface PlanReview {
    totals: ReturnType<typeof intentTotals>
    /** Per intent: '' when it can execute now, otherwise why not. */
    blockers: string[]
    /** How many password prompts approving will take (one per run of steps on the same wallet). */
    prompts: number
}

export function reviewPlan(intents: Intent[]): PlanReview {
    let prompts = 0
    let last: unknown = undefined
    const blockers = intents.map((i) => {
        const why = readiness(i)
        if (!why) {
            const subject = authSubjectFor(i)
            if (subject !== last) prompts += 1
            last = subject
        }
        return why
    })
    return { totals: intentTotals(intents), blockers, prompts }
}

/**
 * Executes approved intents in order, exactly as recorded. Stops at the first
 * failure (the rest are marked skipped) or on abort, before the next signature.
 */
export async function executePlan(
    intents: Intent[],
    opts: { onResult(result: StepResult): void; signal?: AbortSignal; scope?: ScopeHolder }
): Promise<StepResult[]> {
    const results: StepResult[] = intents.map((i) => ({ index: i.index, status: 'pending' }))
    results.forEach((r) => opts.onResult(r))
    const blocked = intents.map(readiness).find((b) => b)
    if (blocked) throw new Error(blocked)

    const scope = opts.scope ?? new ScopeHolder()
    const reason = `Approved script plan — ${intentTotals(intents)
        .map((t) => `${fromBaseUnits(t.total, t.decimals)} ${t.symbol} on ${t.chainLabel}`)
        .join(', ')} in ${intents.length} transaction${intents.length === 1 ? '' : 's'}`
    try {
        for (let n = 0; n < intents.length; n++) {
            const intent = intents[n]
            const r = results[n]
            if (opts.signal?.aborted) {
                for (const rest of results.slice(n)) {
                    Object.assign(rest, { status: 'skipped', error: 'Aborted.' })
                    opts.onResult(rest)
                }
                break
            }
            Object.assign(r, { status: 'running' })
            opts.onResult(r)
            try {
                const out = await scope.run(authSubjectFor(intent), reason, () => executeIntent(intent))
                Object.assign(r, { status: 'done', txId: out.txId, txIds: out.txIds, explorerUrl: out.explorerUrl })
                opts.onResult(r)
            } catch (e: any) {
                Object.assign(r, { status: 'failed', error: e?.message ?? String(e) })
                opts.onResult(r)
                for (const rest of results.slice(n + 1)) {
                    Object.assign(rest, { status: 'skipped', error: 'Not run: an earlier step failed.' })
                    opts.onResult(rest)
                }
                throw e
            }
        }
    } finally {
        await scope.releaseNow()
    }
    return results
}
