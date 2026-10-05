/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The script sandbox: a separate JavaScript engine (QuickJS, compiled to
 * WebAssembly) with no network, DOM, timers or storage. A script cannot reach
 * the page, the wallet or the internet because no such thing exists inside
 * the engine — isolation by construction, not by deleting globals.
 *
 * The ONLY way out is `__host(name, argsJson)`, which hands a name and a JSON
 * string to `hostCall` and returns a promise of a JSON string. No object
 * reference ever crosses: values go across as JSON text and are parsed on the
 * other side (rule R1 of the scripting plan). What the names mean, and which
 * exist at all, is decided entirely by the host API (./api.ts).
 *
 * Bounds, enforced here whatever the script does:
 *  - a wall-clock deadline, checked by QuickJS's interrupt handler while the
 *    script computes and by a host timer while it waits;
 *  - a cap on UNINTERRUPTED computation (MAX_SYNC_MS): the engine runs on the
 *    page's thread, so while a script computes nothing else can — not even the
 *    Abort button. A script that computes for seconds without awaiting a
 *    wallet call is stopped, so `while(true){}` freezes the tab for at most
 *    that long rather than until the deadline;
 *  - a memory ceiling and a stack ceiling;
 *  - a cap on host calls per run, and on console output;
 *  - an abort signal, honoured at the next instruction or host call.
 *
 * The engine is loaded on first use, so the ~500 kB wasm only downloads for
 * people who actually open the scripting page.
 */

export interface SandboxOptions {
    /** Called for every `__host` call. Resolve with a JSON-safe value; throw to raise in the script. */
    hostCall(name: string, args: unknown[]): Promise<unknown>
    /** Console output from the script (`log`, `console.log`). */
    onLog(line: string): void
    deadlineMs: number
    memoryBytes?: number
    maxHostCalls?: number
    signal?: AbortSignal
}

export interface SandboxResult {
    ok: boolean
    /** The script's return value, as JSON-safe data (undefined → null). */
    value?: unknown
    error?: string
    hostCalls: number
    elapsedMs: number
}

const DEFAULT_MEMORY = 32 * 1024 * 1024
const STACK_BYTES = 1024 * 1024
const DEFAULT_MAX_HOST_CALLS = 500
/** Longest the script may compute without yielding (awaiting a wallet call or sleep). */
export const MAX_SYNC_MS = 3000
const MAX_LOG_LINES = 1000
const MAX_LOG_LINE_CHARS = 4000

let modulePromise: Promise<any> | null = null

/** Loads QuickJS once. A failed load is retried next time. */
export function loadQuickJS(): Promise<any> {
    if (!modulePromise) {
        modulePromise = (async () => {
            const [core, variantModule] = await Promise.all([
                import('quickjs-emscripten-core'),
                import('@jitl/quickjs-wasmfile-release-sync'),
            ])
            const base = (variantModule as any).default ?? variantModule
            // The same loader the variant ships, written here so it is compiled
            // with our code (Jest cannot run the variant's raw `import()`).
            const variant = Object.assign({}, base, {
                importModuleLoader: () =>
                    // @ts-ignore -- a package `exports` subpath: Vite and Node resolve it, this tsconfig's resolution cannot.
                    import('@jitl/quickjs-wasmfile-release-sync/emscripten-module').then((m: any) => m.default ?? m),
            })
            return core.newQuickJSWASMModuleFromVariant(variant)
        })()
        modulePromise.catch(() => {
            modulePromise = null
        })
    }
    return modulePromise
}

/**
 * The script's view of the world, defined INSIDE the sandbox. Everything here
 * funnels into `__host`; it adds no authority, only shape. `console` is
 * provided so habitual `console.log` works, and goes to the same console pane.
 */
const PRELUDE = `
(() => {
  const host = globalThis.__host;
  const hostLog = globalThis.__log;
  delete globalThis.__host;
  delete globalThis.__log;
  const call = async (name, args) => {
    const reply = JSON.parse(await host(name, JSON.stringify(args)));
    if ('err' in reply) throw new Error(reply.err);
    return reply.ok;
  };
  const fmt = (v) => {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v, (k, x) => typeof x === 'bigint' ? x.toString() : x); } catch (e) { return String(v); }
  };
  const log = (...parts) => hostLog(parts.map(fmt).join(' '));
  const fn = (name) => (...args) => call(name, args);
  const freeze = (o) => Object.freeze(o);
  globalThis.log = log;
  globalThis.console = freeze({ log, info: log, warn: log, error: log });
  globalThis.sleep = fn('sleep');
  globalThis.wallet = freeze({
    platforms: fn('wallet.platforms'),
    addresses: fn('wallet.addresses'),
    address: fn('wallet.address'),
    balances: fn('wallet.balances'),
    balance: fn('wallet.balance'),
    token: fn('wallet.token'),
  });
  globalThis.network = freeze({ info: fn('network.info') });
  globalThis.tx = freeze({
    send: fn('tx.send'),
    sendNative: (o) => call('tx.send', [Object.assign({}, o, { token: undefined })]),
    sendToken: fn('tx.send'),
    crossChain: fn('tx.crossChain'),
  });
  globalThis.run = freeze({ info: fn('run.info') });
})();
`

/** Runs `code` (plain JavaScript; see ./transpile for TypeScript) to completion or until a bound is hit. */
export async function runInSandbox(code: string, opts: SandboxOptions): Promise<SandboxResult> {
    const started = Date.now()
    const deadline = started + opts.deadlineMs
    const maxCalls = opts.maxHostCalls ?? DEFAULT_MAX_HOST_CALLS
    let hostCalls = 0
    let logLines = 0
    let stopReason = ''
    // Set while QuickJS is executing synchronously; 0 while the script is waiting on the host.
    let burstStart = 0

    const stopped = () => {
        if (stopReason) return true
        if (burstStart && Date.now() - burstStart > MAX_SYNC_MS) {
            stopReason = `Stopped: the script computed for over ${MAX_SYNC_MS / 1000} s without pausing (an endless loop?).`
            return true
        }
        if (opts.signal?.aborted) stopReason = 'Aborted.'
        else if (Date.now() > deadline) stopReason = `Stopped: the script ran longer than ${Math.round(opts.deadlineMs / 1000)} s.`
        return !!stopReason
    }
    const result = (r: Omit<SandboxResult, 'hostCalls' | 'elapsedMs'>): SandboxResult =>
        Object.assign(r, { hostCalls, elapsedMs: Date.now() - started })

    const QuickJS = await loadQuickJS()
    const runtime = QuickJS.newRuntime()
    runtime.setMemoryLimit(opts.memoryBytes ?? DEFAULT_MEMORY)
    runtime.setMaxStackSize(STACK_BYTES)
    runtime.setInterruptHandler(() => stopped())
    const ctx = runtime.newContext()
    // Deferred promises handed to the script and not yet settled; disposed before the context.
    const pending = new Set<any>()
    let disposed = false
    const burst = <T>(fn: () => T): T => {
        burstStart = Date.now()
        try {
            return fn()
        } finally {
            burstStart = 0
        }
    }

    const settle = (deferred: any, reply: { ok: unknown } | { err: string }) => {
        if (disposed || !pending.has(deferred)) return
        pending.delete(deferred)
        const h = ctx.newString(JSON.stringify(reply))
        deferred.resolve(h)
        h.dispose()
        deferred.dispose()
        burst(() => runtime.executePendingJobs())
    }

    try {
        const hostFn = ctx.newFunction('__host', (nameH: any, argsH: any) => {
            const name = ctx.getString(nameH)
            const argsText = ctx.getString(argsH)
            const deferred = ctx.newPromise()
            pending.add(deferred)
            hostCalls += 1
            let p: Promise<unknown>
            if (hostCalls > maxCalls) {
                p = Promise.reject(new Error(`Too many wallet calls (limit ${maxCalls} per run).`))
            } else if (stopped()) {
                p = Promise.reject(new Error(stopReason))
            } else {
                let args: unknown[]
                try {
                    const parsed = JSON.parse(argsText)
                    args = Array.isArray(parsed) ? parsed : []
                } catch {
                    args = []
                }
                p = Promise.resolve().then(() => opts.hostCall(name, args))
            }
            p.then(
                (value) => settle(deferred, { ok: value === undefined ? null : JSON.parse(JSON.stringify(value)) }),
                (e) => settle(deferred, { err: e instanceof Error ? e.message : String(e) })
            )
            return deferred.handle
        })
        ctx.setProp(ctx.global, '__host', hostFn)
        hostFn.dispose()

        const logFn = ctx.newFunction('__log', (lineH: any) => {
            if (logLines >= MAX_LOG_LINES) return
            logLines += 1
            const line = ctx.getString(lineH)
            opts.onLog(logLines === MAX_LOG_LINES ? '… console output limit reached' : line.slice(0, MAX_LOG_LINE_CHARS))
        })
        ctx.setProp(ctx.global, '__log', logFn)
        logFn.dispose()

        const prelude = ctx.evalCode(PRELUDE, 'prelude.js')
        if (prelude.error) {
            const msg = ctx.dump(prelude.error)
            prelude.error.dispose()
            throw new Error(`Sandbox setup failed: ${JSON.stringify(msg)}`)
        }
        prelude.value.dispose()

        // The script body runs as an async function, so `await` works at top level and `return` gives its result.
        const evaluated = burst(() => ctx.evalCode(`(async () => {\n${code}\n})()`, 'script.js'))
        if (evaluated.error) {
            const err = describeError(ctx.dump(evaluated.error))
            evaluated.error.dispose()
            return result({ ok: false, error: stopReason || err })
        }
        const promiseHandle = evaluated.value
        const native: Promise<any> = ctx.resolvePromise(promiseHandle)
        promiseHandle.dispose()
        burst(() => runtime.executePendingJobs())

        // Wait for the script, but never past the deadline or an abort.
        let timer: ReturnType<typeof setInterval> | null = null
        const watchdog = new Promise<'stopped'>((resolve) => {
            timer = setInterval(() => {
                if (stopped()) resolve('stopped')
            }, 50)
        })
        const outcome = await Promise.race([native, watchdog])
        if (timer) clearInterval(timer)
        if (outcome === 'stopped') return result({ ok: false, error: stopReason })

        if (outcome.error) {
            const err = describeError(ctx.dump(outcome.error))
            outcome.error.dispose()
            return result({ ok: false, error: stopReason || err })
        }
        const value = ctx.dump(outcome.value)
        outcome.value.dispose()
        return result({ ok: true, value: toJsonSafe(value) })
    } catch (e) {
        return result({ ok: false, error: stopReason || (e instanceof Error ? e.message : String(e)) })
    } finally {
        disposed = true
        for (const d of pending) {
            try {
                d.dispose()
            } catch {
                /* already gone */
            }
        }
        pending.clear()
        try {
            ctx.dispose()
            runtime.dispose()
        } catch {
            // A run killed mid-flight can leave handles QuickJS still counts; the
            // module is reusable either way and this runtime is unreachable now.
        }
    }
}

function describeError(dumped: any): string {
    if (dumped && typeof dumped === 'object') {
        const name = dumped.name && dumped.name !== 'Error' ? `${dumped.name}: ` : ''
        if (dumped.message) return `${name}${dumped.message}`
    }
    return typeof dumped === 'string' ? dumped : JSON.stringify(dumped)
}

function toJsonSafe(v: unknown): unknown {
    if (v === undefined) return null
    try {
        return JSON.parse(JSON.stringify(v))
    } catch {
        return String(v)
    }
}
