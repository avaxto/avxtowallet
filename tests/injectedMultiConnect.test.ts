/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * One extension, a tab for every platform it can speak for.
 *
 * The injected twin of multiPlatformUnlock.test.ts, and it inherits that file's
 * three ways to lose a wallet (re-opening a live session, one failure
 * discarding the others, landing via the logout-and-reload path). Two
 * properties are specific to this pass and are the reason it exists separately:
 *
 *  1. **What is offered depends on what is installed.** The phrase set is
 *     fixed — a platform that derives from a seed always can — but this one is
 *     whatever the visitor has in their browser. Offering a platform the
 *     extension in front of us cannot open produces a prompt that can only
 *     fail, so `isInjectedAvailable()` gates the set.
 *  2. **The pass is sequential.** Each step raises an approval popup, and
 *     extensions serialise those behind one window. Running them concurrently
 *     — which is correct for the phrase unlock, since deriving talks to nobody
 *     — gets one prompt the user can act on and the rest dropped or queued.
 *
 * Fakes rather than the real EVM/Solana platforms, for the same reason as
 * multiPlatformUnlock.test.ts: this is the registry contract, and pinning it to
 * a real platform would turn a later legitimate change there into a failure
 * here.
 */
import { createPinia, setActivePinia } from 'pinia'

import { registerPlatform } from '@/platforms/registry'
import { useActivePlatformStore } from '@/platforms/store'
import type { Platform, PlatformId, PlatformWallet } from '@/platforms/types'

interface FakeState {
    wallet: PlatformWallet | null
    /** How many times `connectInjected` was called. */
    connectCalls: number
    /** When set, `connectInjected` rejects with this message. */
    failWith: string | null
    /** Whether this platform's provider is "installed" right now. */
    providerPresent: boolean
}

const state = new Map<PlatformId, FakeState>()

/** Highest number of `connectInjected` calls ever in flight at once. */
let inFlight = 0
let maxInFlight = 0

function fakeWallet(platformId: PlatformId): PlatformWallet {
    return {
        platformId,
        id: `${platformId}-wallet`,
        accessMethodId: 'injected',
        isReadonly: false,
        getAddresses: () => [],
        getPrimaryAddress: () => `${platformId}-address`,
        getBalances: async () => [],
        native: null,
    }
}

interface FakeOptions {
    supportsConcurrentSession: boolean
    /** Whether this platform implements `connectInjected` at all. */
    injectable: boolean
}

function makePlatform(id: PlatformId, options: FakeOptions): Platform {
    state.set(id, { wallet: null, connectCalls: 0, failWith: null, providerPresent: true })

    const platform: Platform = {
        descriptor: { id, name: id, symbol: id.toUpperCase(), status: 'available' },
        capabilities: {
            send: true,
            receive: true,
            stake: false,
            swap: false,
            crossChain: false,
            signMessage: false,
            collectibles: false,
            offlineSigning: false,
        },
        // Non-empty: `isPlatformAvailable` requires at least one access method.
        accessMethods: [
            { id: 'injected', label: 'Connect Wallet', kind: 'action', run: async () => {} },
        ],
        chains: [{ id: 'main', label: 'Main', kind: 'evm' }],
        networks: [],
        supportsConcurrentSession: options.supportsConcurrentSession,
        getActiveWallet: () => state.get(id)!.wallet,
        logout: async () => {
            state.get(id)!.wallet = null
            useActivePlatformStore().notifyWalletChanged()
        },
    }

    if (options.injectable) {
        platform.isInjectedAvailable = () => state.get(id)!.providerPresent
        platform.connectInjected = async () => {
            const s = state.get(id)!
            s.connectCalls++

            // Observing overlap is the only way to tell a sequential pass from
            // a concurrent one: both produce the same results, and only the
            // extension notices the difference.
            inFlight++
            maxInFlight = Math.max(maxInFlight, inFlight)
            try {
                // Yield, so a concurrent caller would have started its own
                // call by the time this one resumes.
                await Promise.resolve()
                if (s.failWith) throw new Error(s.failWith)
                s.wallet = fakeWallet(id)
                useActivePlatformStore().notifyWalletChanged()
            } finally {
                inFlight--
            }
        }
    }

    return platform
}

// Registered once for the file — the registry is a module-level Map and
// re-registering an id throws.
const EXT_A = 'test-injected-a'
const EXT_B = 'test-injected-b'
/**
 * No injected path at all — shaped like Bitcoin, whose browser wallets each
 * expose a bespoke API rather than anything common. It must stay out of the
 * pass, and rejoin the day it declares the two methods.
 */
const LOCAL_KEY_ONLY = 'test-injected-localkey'
/**
 * An extension can open it, but its session is not isolated. The one platform
 * that must NOT be swept in — a row of tabs that log each other out is exactly
 * what this feature exists to avoid.
 */
const EXT_BUT_EXCLUSIVE = 'test-injected-exclusive'

registerPlatform(makePlatform(EXT_A, { supportsConcurrentSession: true, injectable: true }))
registerPlatform(makePlatform(EXT_B, { supportsConcurrentSession: true, injectable: true }))
registerPlatform(
    makePlatform(LOCAL_KEY_ONLY, { supportsConcurrentSession: true, injectable: false })
)
registerPlatform(
    makePlatform(EXT_BUT_EXCLUSIVE, { supportsConcurrentSession: false, injectable: true })
)

/** Set whenever production code hard-navigates, i.e. resets the whole app. */
let reloadedTo: string | null = null

beforeAll(() => {
    // jsdom refuses a real navigation; a plain object makes the assignment
    // observable, which is the only way to tell "handed over" from "reloaded".
    delete (window as any).location
    ;(window as any).location = {
        get href() {
            return reloadedTo ?? 'http://localhost/'
        },
        set href(value: string) {
            reloadedTo = value
        },
    }
})

beforeEach(() => {
    setActivePinia(createPinia())
    reloadedTo = null
    inFlight = 0
    maxInFlight = 0
    for (const s of state.values()) {
        s.wallet = null
        s.connectCalls = 0
        s.failWith = null
        s.providerPresent = true
    }
})

/** Connects a fake wallet without going through the pass, and notifies. */
function connect(store: ReturnType<typeof useActivePlatformStore>, id: PlatformId): void {
    state.get(id)!.wallet = fakeWallet(id)
    store.notifyWalletChanged()
}

const idsOf = (results: Array<{ platformId: PlatformId }>): PlatformId[] =>
    results.map((r) => r.platformId).sort()

describe('which platforms an extension is offered for', () => {
    it('lists only platforms that connect through an extension and can share the page', () => {
        const store = useActivePlatformStore()
        const ids = store.injectedConnectablePlatforms().map((p) => p.descriptor.id)

        expect(ids).toEqual(expect.arrayContaining([EXT_A, EXT_B]))
        expect(ids).not.toContain(LOCAL_KEY_ONLY)
        expect(ids).not.toContain(EXT_BUT_EXCLUSIVE)
    })

    /**
     * The property that makes this honest about a given extension. Core speaks
     * three chains and MetaMask one; offering the user a platform whose
     * provider is not on the page promises a tab that cannot open.
     */
    it('drops a platform whose provider is not installed', () => {
        const store = useActivePlatformStore()
        state.get(EXT_B)!.providerPresent = false

        const ids = store.injectedConnectablePlatforms().map((p) => p.descriptor.id)

        expect(ids).toContain(EXT_A)
        expect(ids).not.toContain(EXT_B)
    })

    /**
     * The actual bug this reproduces: a provider that is not there yet on the
     * FIRST read (the access screen's own first render, which can race a real
     * extension's asynchronous injection — Core injects from its own service
     * worker into the page's MAIN world, not synchronously ahead of every
     * other script) but appears before the next read. A Vue `computed` here
     * would cache the first, empty read forever — no reactive dependency ever
     * marks it dirty — leaving `injectedConnectablePlatforms` permanently
     * blind to an extension that was, in fact, live moments later. Reading it
     * as a plain function call each time is what makes this pass.
     */
    it('reflects a provider that was not present on an earlier read', () => {
        const store = useActivePlatformStore()
        state.get(EXT_A)!.providerPresent = false

        const before = store.injectedConnectablePlatforms().map((p) => p.descriptor.id)
        expect(before).not.toContain(EXT_A)

        state.get(EXT_A)!.providerPresent = true
        const after = store.injectedConnectablePlatforms().map((p) => p.descriptor.id)

        expect(after).toContain(EXT_A)
    })

    it('does not sweep an excluded platform in even when named explicitly', async () => {
        const store = useActivePlatformStore()

        await expect(store.connectWithInjected([EXT_BUT_EXCLUSIVE])).rejects.toThrow(
            /no wallet extension/i
        )

        expect(state.get(EXT_BUT_EXCLUSIVE)!.connectCalls).toBe(0)
    })

    it('reports no extension rather than opening nothing silently', async () => {
        const store = useActivePlatformStore()
        for (const s of state.values()) s.providerPresent = false

        await expect(store.connectWithInjected()).rejects.toThrow(/no wallet extension/i)
    })
})

describe('connecting every platform one extension can open', () => {
    it('opens a session on each', async () => {
        const store = useActivePlatformStore()

        const settled = await store.connectWithInjected([EXT_A, EXT_B])

        expect(idsOf(settled)).toEqual([EXT_A, EXT_B].sort())
        expect(settled.every((r) => r.status === 'connected')).toBe(true)
        expect(store.connectedPlatforms.map((p) => p.descriptor.id).sort()).toEqual(
            [EXT_A, EXT_B].sort()
        )
    })

    /**
     * The one behavioural difference from the phrase unlock, and the reason
     * this cannot simply reuse `Promise.all`. Extensions show one approval
     * window at a time; overlapping requests get dropped or queued behind a
     * prompt the user cannot see the context for.
     */
    it('asks one platform at a time rather than raising every prompt at once', async () => {
        const store = useActivePlatformStore()

        await store.connectWithInjected([EXT_A, EXT_B])

        expect(maxInFlight).toBe(1)
    })

    /**
     * Three near-identical popups with nothing on the page saying which is
     * which reads like a stuck button, so the pass publishes what it is
     * waiting on. Only meaningful mid-pass — hence sampling before the await.
     */
    it('names the platform it is waiting on, and clears it when done', async () => {
        const store = useActivePlatformStore()

        const pass = store.connectWithInjected([EXT_A, EXT_B])
        // Synchronous up to the first connect's own await, so this observes
        // the platform whose prompt is currently open.
        expect(store.injectedConnectingId).toBe(EXT_A)

        await pass

        expect(store.injectedConnectingId).toBeNull()
    })

    /** A rejection must not strand the label on the platform that failed. */
    it('clears what it is waiting on even when a platform is declined', async () => {
        const store = useActivePlatformStore()
        state.get(EXT_B)!.failWith = 'User rejected the request.'

        await store.connectWithInjected([EXT_A, EXT_B])

        expect(store.injectedConnectingId).toBeNull()
    })
})

describe('what a partial pass must not destroy', () => {
    /**
     * Declining one platform in the extension is a decision, not a fault. The
     * sessions already approved in the same pass are live wallets with
     * reachable funds — there is nothing to roll back *to*.
     */
    it('keeps the sessions that opened when another is declined', async () => {
        const store = useActivePlatformStore()
        state.get(EXT_B)!.failWith = 'User rejected the request.'

        const settled = await store.connectWithInjected([EXT_A, EXT_B])

        expect(settled.find((r) => r.platformId === EXT_A)!.status).toBe('connected')
        const failure = settled.find((r) => r.platformId === EXT_B)!
        expect(failure.status).toBe('failed')
        expect(failure.error).toMatch(/rejected/i)

        expect(store.connectedPlatforms.map((p) => p.descriptor.id)).toEqual([EXT_A])
    })

    /**
     * Re-running the pass over a live session would replace the wallet behind
     * it — and with a different account selected in the extension, would
     * silently move the user onto different addresses.
     */
    it('leaves an already-connected platform untouched', async () => {
        const store = useActivePlatformStore()
        connect(store, EXT_A)
        const existing = state.get(EXT_A)!.wallet

        const settled = await store.connectWithInjected([EXT_A, EXT_B])

        expect(settled.find((r) => r.platformId === EXT_A)!.status).toBe('skipped')
        expect(state.get(EXT_A)!.connectCalls).toBe(0)
        expect(state.get(EXT_A)!.wallet).toBe(existing)
    })

    /**
     * The same trap as the phrase unlock: the app boots on a platform with no
     * session, so landing on one the pass just opened is the ordinary case.
     * Taking the destructive switch path there would log out every session the
     * pass had opened, one line after opening them.
     */
    it('lands on an opened platform without reloading the page', async () => {
        const store = useActivePlatformStore()

        await store.connectWithInjected([EXT_A, EXT_B])

        expect(reloadedTo).toBeNull()
        expect(store.connectedPlatforms.map((p) => p.descriptor.id).sort()).toEqual(
            [EXT_A, EXT_B].sort()
        )
    })
})
