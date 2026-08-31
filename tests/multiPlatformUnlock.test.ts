/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * One recovery phrase, a session on every platform that can take one.
 *
 * The risky part of this feature is not the happy path — it is what happens to
 * sessions the pass did NOT open. Three ways to lose a wallet here, and each
 * has a test below:
 *
 *  1. Re-running the unlock over a platform that is already connected would
 *     replace a live wallet, and with a different phrase would silently swap
 *     the user onto different addresses.
 *  2. One platform's RPC failing must not discard the wallets that opened
 *     successfully alongside it — there is nothing to roll back *to*, and the
 *     funds on the platforms that did open are reachable.
 *  3. Landing on the opened platform must not take the logout-and-reload path.
 *     The app boots on Avalanche, which cannot hold a concurrent session, so
 *     this is the ordinary case rather than an exotic one: getting it wrong
 *     logs out every session the pass had just opened, one line after opening
 *     them.
 *
 * Fakes rather than the real Bitcoin/Solana platforms, for the same reason as
 * platformSwitching.test.ts: this is the registry contract, and pinning it to
 * a real platform would turn a later legitimate change there into a failure
 * here.
 */
import { createPinia, setActivePinia } from 'pinia'

import { registerPlatform } from '@/platforms/registry'
import { useActivePlatformStore } from '@/platforms/store'
import type { Platform, PlatformId, PlatformWallet } from '@/platforms/types'

interface FakeState {
    wallet: PlatformWallet | null
    /** Every (phrase, password) pair this platform was asked to unlock with. */
    unlockCalls: Array<{ mnemonic: string; password: string }>
    /** When set, `unlockWithMnemonic` rejects with this message. */
    failWith: string | null
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

interface FakeOptions {
    supportsConcurrentSession: boolean
    /** Whether this platform implements `unlockWithMnemonic` at all. */
    seedUnlockable: boolean
}

function makePlatform(id: PlatformId, options: FakeOptions): Platform {
    state.set(id, { wallet: null, unlockCalls: [], failWith: null })

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
        accessMethods: [{ id: 'mnemonic', label: 'Mnemonic', kind: 'route', route: '/access' }],
        chains: [{ id: 'main', label: 'Main', kind: 'evm' }],
        networks: [],
        supportsConcurrentSession: options.supportsConcurrentSession,
        getActiveWallet: () => state.get(id)!.wallet,
        logout: async () => {
            state.get(id)!.wallet = null
            useActivePlatformStore().notifyWalletChanged()
        },
    }

    if (options.seedUnlockable) {
        platform.unlockWithMnemonic = async (mnemonic: string, password: string) => {
            const s = state.get(id)!
            s.unlockCalls.push({ mnemonic, password })
            if (s.failWith) throw new Error(s.failWith)
            // Mirrors a real store's `setWallet`, which bumps the epoch.
            s.wallet = fakeWallet(id)
            useActivePlatformStore().notifyWalletChanged()
        }
    }

    return platform
}

// Registered once for the file — the registry is a module-level Map and
// re-registering an id throws.
const SEED_A = 'test-seed-a'
const SEED_B = 'test-seed-b'
/**
 * Connects only through an extension, so no phrase can open it. No shipped
 * platform is in this category any more — EVM was, until it learned to open
 * from a phrase — but the registry must keep excluding one that is.
 */
const EXTENSION_ONLY = 'test-extension-only'
/**
 * A phrase opens it, but its session is not isolated — shaped like Avalanche.
 * The one platform that must NOT be swept into the pass.
 */
const SEED_BUT_EXCLUSIVE = 'test-seed-exclusive'

registerPlatform(makePlatform(SEED_A, { supportsConcurrentSession: true, seedUnlockable: true }))
registerPlatform(makePlatform(SEED_B, { supportsConcurrentSession: true, seedUnlockable: true }))
registerPlatform(
    makePlatform(EXTENSION_ONLY, { supportsConcurrentSession: true, seedUnlockable: false })
)
registerPlatform(
    makePlatform(SEED_BUT_EXCLUSIVE, { supportsConcurrentSession: false, seedUnlockable: true })
)

const PHRASE = 'abandon abandon abandon abandon abandon abandon about'
const PASSWORD = 'correct horse battery staple'

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
    for (const s of state.values()) {
        s.wallet = null
        s.unlockCalls = []
        s.failWith = null
    }
})

/** Connects a fake wallet without going through the unlock, and notifies. */
function connect(store: ReturnType<typeof useActivePlatformStore>, id: PlatformId): void {
    state.get(id)!.wallet = fakeWallet(id)
    store.notifyWalletChanged()
}

const idsOf = (results: Array<{ platformId: PlatformId }>): PlatformId[] =>
    results.map((r) => r.platformId).sort()

describe('which platforms a phrase is offered for', () => {
    it('lists only platforms that both take a phrase and can share the page', () => {
        const store = useActivePlatformStore()
        const ids = store.mnemonicUnlockablePlatforms.map((p) => p.descriptor.id)

        expect(ids).toEqual(expect.arrayContaining([SEED_A, SEED_B]))
        expect(ids).not.toContain(EXTENSION_ONLY)
    })

    /**
     * The property that keeps the feature honest. A platform whose session is
     * not isolated could be derived from the phrase perfectly well — and
     * opening it would still be wrong, because the user would end up with a
     * row of tabs that log each other out the moment one is clicked.
     */
    it('excludes a seed-derivable platform whose session cannot coexist', () => {
        const store = useActivePlatformStore()
        const ids = store.mnemonicUnlockablePlatforms.map((p) => p.descriptor.id)

        expect(ids).not.toContain(SEED_BUT_EXCLUSIVE)
    })

    it('does not sweep an excluded platform in even when named explicitly', async () => {
        const store = useActivePlatformStore()

        await expect(
            store.unlockWithMnemonic(PHRASE, PASSWORD, [SEED_BUT_EXCLUSIVE])
        ).rejects.toThrow(/no platform/i)

        expect(state.get(SEED_BUT_EXCLUSIVE)!.unlockCalls).toHaveLength(0)
        expect(state.get(SEED_BUT_EXCLUSIVE)!.wallet).toBeNull()
    })
})

describe('opening several platforms from one phrase', () => {
    it('connects every target with the same phrase and password', async () => {
        const store = useActivePlatformStore()

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(idsOf(results)).toEqual([SEED_A, SEED_B].sort())
        expect(results.every((r) => r.status === 'connected')).toBe(true)

        for (const id of [SEED_A, SEED_B]) {
            expect(state.get(id)!.wallet).not.toBeNull()
            // The phrase itself is handed to each platform — deriving one seed
            // and sharing the buffer would leave the second platform deriving
            // from zeroes, since `vaultWith` wipes what it is given.
            expect(state.get(id)!.unlockCalls).toEqual([
                { mnemonic: PHRASE, password: PASSWORD },
            ])
        }

        const connected = store.connectedPlatforms.map((p) => p.descriptor.id)
        expect(connected).toEqual(expect.arrayContaining([SEED_A, SEED_B]))
    })

    it('opens only the platforms named in `ids`', async () => {
        const store = useActivePlatformStore()

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD, [SEED_A])

        expect(idsOf(results)).toEqual([SEED_A])
        expect(state.get(SEED_B)!.unlockCalls).toHaveLength(0)
        expect(state.get(SEED_B)!.wallet).toBeNull()
    })

    it('never navigates — the caller decides that once, having seen the results', async () => {
        const store = useActivePlatformStore()

        await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(reloadedTo).toBeNull()
    })

    it('throws rather than silently doing nothing when no platform qualifies', async () => {
        const store = useActivePlatformStore()

        await expect(
            store.unlockWithMnemonic(PHRASE, PASSWORD, [EXTENSION_ONLY])
        ).rejects.toThrow(/no platform/i)
    })
})

describe('a platform that is already connected', () => {
    it('is left strictly alone, not re-opened', async () => {
        const store = useActivePlatformStore()
        connect(store, SEED_A)
        const existing = state.get(SEED_A)!.wallet

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(results.find((r) => r.platformId === SEED_A)!.status).toBe('skipped')
        // The real hazard: a different phrase would move the user onto
        // different addresses without ever saying so.
        expect(state.get(SEED_A)!.unlockCalls).toHaveLength(0)
        expect(state.get(SEED_A)!.wallet).toBe(existing)
    })

    it('does not stop the others in the same pass from opening', async () => {
        const store = useActivePlatformStore()
        connect(store, SEED_A)

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(results.find((r) => r.platformId === SEED_B)!.status).toBe('connected')
        expect(state.get(SEED_B)!.wallet).not.toBeNull()
    })
})

describe('when one platform fails', () => {
    it('keeps the wallet that did open and reports only the one that did not', async () => {
        const store = useActivePlatformStore()
        state.get(SEED_B)!.failWith = 'Esplora is unreachable'

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        const a = results.find((r) => r.platformId === SEED_A)!
        const b = results.find((r) => r.platformId === SEED_B)!

        expect(a.status).toBe('connected')
        expect(state.get(SEED_A)!.wallet).not.toBeNull()

        expect(b.status).toBe('failed')
        expect(b.error).toBe('Esplora is unreachable')
        expect(state.get(SEED_B)!.wallet).toBeNull()
    })

    it('resolves rather than rejecting, so the surviving session is not thrown away', async () => {
        const store = useActivePlatformStore()
        state.get(SEED_B)!.failWith = 'nope'

        await expect(store.unlockWithMnemonic(PHRASE, PASSWORD)).resolves.toBeDefined()
    })

    it('reports every failure when nothing opens, and connects nothing', async () => {
        const store = useActivePlatformStore()
        state.get(SEED_A)!.failWith = 'That is not a valid BIP-39 recovery phrase.'
        state.get(SEED_B)!.failWith = 'That is not a valid BIP-39 recovery phrase.'

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(results.every((r) => r.status === 'failed')).toBe(true)
        expect(store.connectedPlatforms).toHaveLength(0)
        expect(reloadedTo).toBeNull()
    })
})

describe('where the user lands afterwards', () => {
    /**
     * The regression this feature would otherwise ship with. Starting on an
     * unconnected non-concurrent platform is not a corner case — it is every
     * cold start, because the app boots on Avalanche. Taking the reload path to
     * leave it would log out both wallets the pass had just opened.
     */
    it('moves to an opened platform without reloading, from a cold start', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_BUT_EXCLUSIVE

        const results = await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(results.every((r) => r.status === 'connected')).toBe(true)
        expect([SEED_A, SEED_B]).toContain(store.activePlatformId)
        expect(reloadedTo).toBeNull()
        // Both survived the move — the whole point.
        expect(state.get(SEED_A)!.wallet).not.toBeNull()
        expect(state.get(SEED_B)!.wallet).not.toBeNull()
    })

    it('prefers a platform this pass opened over one that was already connected', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_BUT_EXCLUSIVE
        connect(store, SEED_A)

        await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(store.activePlatformId).toBe(SEED_B)
    })

    it('leaves the active platform alone when it already has a session', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_A
        connect(store, SEED_A)

        await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(store.activePlatformId).toBe(SEED_A)
        expect(reloadedTo).toBeNull()
    })

    it('does not move anywhere when every platform failed', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_BUT_EXCLUSIVE
        state.get(SEED_A)!.failWith = 'no'
        state.get(SEED_B)!.failWith = 'no'

        await store.unlockWithMnemonic(PHRASE, PASSWORD)

        expect(store.activePlatformId).toBe(SEED_BUT_EXCLUSIVE)
        expect(reloadedTo).toBeNull()
    })
})

/**
 * The switch rule the unlock depends on, tested directly rather than only
 * through it — the reload exists to clear the OUTGOING platform's state, so
 * what matters is whether that platform has any.
 */
describe('leaving a platform that cannot share the page', () => {
    it('hands over in place when it was never logged into', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_BUT_EXCLUSIVE
        connect(store, SEED_A)

        await store.setActivePlatform(SEED_A)

        expect(store.activePlatformId).toBe(SEED_A)
        expect(reloadedTo).toBeNull()
        expect(state.get(SEED_A)!.wallet).not.toBeNull()
        expect(store.isDestructiveSwitch(SEED_B)).toBe(false)
    })

    it('still reloads when it does hold a live session', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SEED_BUT_EXCLUSIVE
        connect(store, SEED_BUT_EXCLUSIVE)

        expect(store.isDestructiveSwitch(SEED_A)).toBe(true)

        await store.setActivePlatform(SEED_A)

        expect(reloadedTo).toBe('/')
    })
})
