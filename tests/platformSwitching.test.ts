/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Concurrent platform sessions — the state machine behind the platform tabs.
 *
 * What actually matters here is what gets DESTROYED. A wallet's vault lives
 * only in memory, so a stray `window.location` assignment or an over-eager
 * `logout()` silently costs the user every open session: the recovery phrase
 * and session password both have to be entered again. "It switched" is not the
 * property worth testing; "it switched and the other session is still live" is.
 *
 * So every case below asserts on the two observable side effects — which
 * platforms were logged out, and whether the app reloaded — rather than just
 * on the resulting `activePlatformId`.
 *
 * Uses purpose-built fake platforms rather than the real four: this is the
 * registry's own contract (`supportsConcurrentSession`), and pinning it to
 * Bitcoin/Solana/EVM specifically would turn a later, legitimate change to one
 * of those platforms into a failure here.
 */
import { createPinia, setActivePinia } from 'pinia'

import { registerPlatform } from '@/platforms/registry'
import { useActivePlatformStore } from '@/platforms/store'
import type { Platform, PlatformId, PlatformWallet } from '@/platforms/types'

/** Records what each fake platform was asked to do. */
interface FakeState {
    wallet: PlatformWallet | null
    logoutCalls: number
}

const state = new Map<PlatformId, FakeState>()

function fakeWallet(platformId: PlatformId): PlatformWallet {
    return {
        platformId,
        id: `${platformId}-wallet`,
        accessMethodId: 'mnemonic',
        isReadonly: false,
        getAddresses: () => [],
        getPrimaryAddress: () => `${platformId}-address`,
        getBalances: async () => [],
        native: null,
    }
}

/**
 * Set for the fakes that imitate a real platform store, whose `disconnect()`
 * ends by calling `finishDisconnect()` — the behaviour that makes teardown
 * re-entrant. See the reentrancy test at the bottom of this file.
 */
let callFinishDisconnectOnLogout = false

function makePlatform(id: PlatformId, supportsConcurrentSession: boolean): Platform {
    state.set(id, { wallet: null, logoutCalls: 0 })

    return {
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
        // Non-empty: `isPlatformAvailable` requires at least one access method
        // before a platform can be selected at all.
        accessMethods: [{ id: 'mnemonic', label: 'Mnemonic', kind: 'route', route: '/access' }],
        chains: [{ id: 'main', label: 'Main', kind: 'evm' }],
        networks: [],
        supportsConcurrentSession,
        getActiveWallet: () => state.get(id)!.wallet,
        logout: async () => {
            const s = state.get(id)!
            s.logoutCalls += 1
            s.wallet = null
            // Real stores clear the wallet through `setWallet(null)`, which
            // bumps the epoch — without that `connectedPlatforms` would stay
            // cached and this fake would not exercise the code that reads it.
            useActivePlatformStore().notifyWalletChanged()
            // What every real platform store does at the end of `disconnect()`
            // (see platforms/{bitcoin,solana,evm}/store.ts).
            if (callFinishDisconnectOnLogout) {
                await useActivePlatformStore().finishDisconnect()
            }
        },
    }
}

// Registered once for the whole file: the registry is a module-level Map, and
// re-registering the same id throws (deliberately — see registry.ts).
const CONCURRENT_A = 'test-concurrent-a'
const CONCURRENT_B = 'test-concurrent-b'
const EXCLUSIVE = 'test-exclusive'

registerPlatform(makePlatform(CONCURRENT_A, true))
registerPlatform(makePlatform(CONCURRENT_B, true))
registerPlatform(makePlatform(EXCLUSIVE, false))

/** Set whenever production code hard-navigates, i.e. resets the whole app. */
let reloadedTo: string | null = null

/**
 * How many logouts had completed at each hard-navigation.
 *
 * Assigning `window.location.href` starts navigating for real in a browser, so
 * *when* it happens is a safety property, not a detail: any vault not yet
 * cleared when the page starts unloading may never be cleared at all. jsdom
 * records the assignment instead of acting on it, so the ordering has to be
 * asserted explicitly.
 */
let reloadTrace: number[] = []

const totalLogouts = (): number =>
    Array.from(state.values()).reduce((sum, s) => sum + s.logoutCalls, 0)

beforeAll(() => {
    // jsdom refuses a real navigation, so `window.location` is replaced with a
    // plain object whose href assignment is observable. This is the only way
    // to distinguish "handed over in place" from "reloaded" — the entire point
    // of the feature.
    delete (window as any).location
    ;(window as any).location = {
        get href() {
            return reloadedTo ?? 'http://localhost/'
        },
        set href(value: string) {
            reloadedTo = value
            reloadTrace.push(totalLogouts())
        },
    }
})

beforeEach(() => {
    setActivePinia(createPinia())
    reloadedTo = null
    reloadTrace = []
    callFinishDisconnectOnLogout = false
    for (const s of state.values()) {
        s.wallet = null
        s.logoutCalls = 0
    }
})

/** Connects a fake wallet and tells the store the world changed. */
function connect(store: ReturnType<typeof useActivePlatformStore>, id: PlatformId): void {
    state.get(id)!.wallet = fakeWallet(id)
    store.notifyWalletChanged()
}

describe('switching between two platforms that both support concurrent sessions', () => {
    it('keeps the outgoing session connected — no logout, no reload', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await store.setActivePlatform(CONCURRENT_B)

        expect(store.activePlatformId).toBe(CONCURRENT_B)
        // The actual regression this guards: the previous platform's wallet
        // must still be there afterwards.
        expect(state.get(CONCURRENT_A)!.wallet).not.toBeNull()
        expect(state.get(CONCURRENT_A)!.logoutCalls).toBe(0)
        expect(reloadedTo).toBeNull()
    })

    it('reports both as connected, so the tab strip can render them', () => {
        const store = useActivePlatformStore()
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        const ids = store.connectedPlatforms.map((p) => p.descriptor.id)
        expect(ids).toEqual(expect.arrayContaining([CONCURRENT_A, CONCURRENT_B]))
        expect(store.isPlatformConnected(CONCURRENT_A)).toBe(true)
        expect(store.isPlatformConnected(EXCLUSIVE)).toBe(false)
    })

    it('is not flagged as destructive', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)

        expect(store.isDestructiveSwitch(CONCURRENT_B)).toBe(false)
    })
})

describe('switching to a platform that cannot share the page', () => {
    it('logs every live session out and reloads', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await store.setActivePlatform(EXCLUSIVE)

        // Both, not just the outgoing one: the reload ends them regardless, so
        // each vault has to be cleared on the way out rather than simply
        // vanishing with the page.
        expect(state.get(CONCURRENT_A)!.logoutCalls).toBeGreaterThanOrEqual(1)
        expect(state.get(CONCURRENT_B)!.logoutCalls).toBeGreaterThanOrEqual(1)
        expect(reloadedTo).toBe('/')
    })

    it('is flagged as destructive while sessions are open, so the UI can confirm first', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)

        expect(store.isDestructiveSwitch(EXCLUSIVE)).toBe(true)
    })

    it('is not destructive when nothing is connected yet', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A

        expect(store.isDestructiveSwitch(EXCLUSIVE)).toBe(false)
    })

    it('is likewise destructive when leaving one for a concurrent platform', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = EXCLUSIVE
        connect(store, EXCLUSIVE)

        // Both directions matter: the exclusive platform's global state is the
        // problem, whichever side of the switch it is on.
        expect(store.isDestructiveSwitch(CONCURRENT_A)).toBe(true)
    })
})

describe('disconnecting one platform', () => {
    it('hands over to a still-connected session instead of reloading', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_B)

        // CONCURRENT_A has already torn its own session down by this point —
        // this is what its store calls next.
        await store.finishDisconnect()

        expect(store.activePlatformId).toBe(CONCURRENT_B)
        expect(state.get(CONCURRENT_B)!.wallet).not.toBeNull()
        expect(state.get(CONCURRENT_B)!.logoutCalls).toBe(0)
        // The regression that motivated `finishDisconnect`: a reload here would
        // have taken CONCURRENT_B's in-memory vault with it.
        expect(reloadedTo).toBeNull()
    })

    it('falls back to a full reset when it was the last session', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A

        await store.finishDisconnect()

        expect(reloadedTo).toBe('/')
    })
})

describe('tearing down several sessions at once', () => {
    // Regression: each platform store's `disconnect()` ends by calling
    // `finishDisconnect()`, so the teardown loop inside `setActivePlatform`
    // re-enters this store once per platform it closes. Left unguarded, the
    // first logout handed over to a session the loop was about to close —
    // moving `activePlatformId` and persisting it, racing the id the switch
    // was actually heading for.
    beforeEach(() => {
        callFinishDisconnectOnLogout = true
    })

    it('still lands on the requested platform', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await store.setActivePlatform(EXCLUSIVE)

        expect(store.activePlatformId).toBe(EXCLUSIVE)
        expect(localStorage.getItem('activePlatform')).toBe(EXCLUSIVE)
        expect(reloadedTo).toBe('/')
    })

    it('logs each session out exactly once', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await store.setActivePlatform(EXCLUSIVE)

        // The outgoing platform is in `connectedPlatforms` AND is `previous`;
        // without de-duplication it was torn down twice.
        expect(state.get(CONCURRENT_A)!.logoutCalls).toBe(1)
        expect(state.get(CONCURRENT_B)!.logoutCalls).toBe(1)
    })

    it('does not start navigating until every vault has been cleared', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await store.setActivePlatform(EXCLUSIVE)

        // Exactly one navigation, and only once both logouts had finished.
        // Without the `isTearingDown` guard the first platform's own
        // `finishDisconnect` assigned `location.href` while the second was
        // still connected — in a real browser that begins unloading the page
        // mid-teardown, so the remaining vault may never be cleared.
        expect(reloadTrace).toEqual([2])
    })
})

describe('ensureActiveIsConnected', () => {
    it('snaps to a live session when the active platform has none', async () => {
        const store = useActivePlatformStore()
        // The state the add-another-session flow leaves behind: an unconnected
        // platform is active so its access methods render.
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_B)

        await expect(store.ensureActiveIsConnected()).resolves.toBe(true)
        expect(store.activePlatformId).toBe(CONCURRENT_B)
        expect(reloadedTo).toBeNull()
    })

    it('leaves an already-connected active platform alone', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A
        connect(store, CONCURRENT_A)
        connect(store, CONCURRENT_B)

        await expect(store.ensureActiveIsConnected()).resolves.toBe(true)
        expect(store.activePlatformId).toBe(CONCURRENT_A)
    })

    it('reports false when nothing at all is connected', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = CONCURRENT_A

        await expect(store.ensureActiveIsConnected()).resolves.toBe(false)
        // Must not reload: this runs inside a router guard, which redirects to
        // the home page itself.
        expect(reloadedTo).toBeNull()
    })
})
