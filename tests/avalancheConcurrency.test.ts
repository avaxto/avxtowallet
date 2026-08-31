/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Avalanche as one tab among several — the contract Phase 3 had to satisfy.
 *
 * Avalanche was the platform every earlier phase had to route around: it forced
 * a page reload on every switch, and a reload takes every other platform's
 * in-memory vault with it. Two things disqualified it, and this file is about
 * what had to become true for each.
 *
 *  1. **It must be invisible while another tab is in front.** Roughly seventy
 *     call sites read `mainStore.activeWallet` and are written assuming it is
 *     null on any other platform. That used to hold by accident — only one
 *     platform could be connected. Now it holds because the accessor is gated
 *     on `isAvalancheActive`, which is what these tests pin down. Get this
 *     wrong and X/P addresses render over a Bitcoin session, which is the worst
 *     failure available here: a user could send to an address the interface
 *     attributed to the wrong chain.
 *
 *  2. **It must be able to end its session in place.** Not by reloading, which
 *     is how it used to "clear" its stores.
 *
 * ## What this file does and does not cover
 *
 * The rule in (1) and the platform-layer consequences of (2) are tested here,
 * for real, with fake platforms — the same approach as platformSwitching and
 * multiPlatformUnlock, and for the same reason: this is the registry's
 * contract, not any one platform's implementation.
 *
 * What is NOT covered here is the *content* of Avalanche's teardown — that
 * `resetSession` in @/stores/main clears every store holding session state.
 * That cannot be tested until the repo's Jest setup is fixed: `@/stores/main`
 * reaches `@avalanche-sdk/chainkit`, which ships untransformed TypeScript that
 * the current config cannot load. Stubbing far enough to get there would leave
 * the stores under test mostly fakes, which would prove nothing about the real
 * ones. It is the single most valuable test to add once `yarn test` runs.
 */
import { createPinia, setActivePinia } from 'pinia'

import { registerPlatform } from '@/platforms/registry'
import { useActivePlatformStore } from '@/platforms/store'
import type {
    Platform,
    PlatformChain,
    PlatformId,
    PlatformWallet,
} from '@/platforms/types'

interface FakeState {
    wallet: PlatformWallet | null
    logoutCalls: number
    activateCalls: number
    /** Set by the fake's own logout, mimicking a real store clearing in place. */
    tornDownInPlace: boolean
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

function makePlatform(id: PlatformId, chains: PlatformChain[]): Platform {
    state.set(id, {
        wallet: null,
        logoutCalls: 0,
        activateCalls: 0,
        tornDownInPlace: false,
    })

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
        accessMethods: [{ id: 'mnemonic', label: 'Mnemonic', kind: 'route', route: '/access' }],
        chains,
        networks: [],
        supportsConcurrentSession: true,
        getActiveWallet: () => state.get(id)!.wallet,
        async activate() {
            state.get(id)!.activateCalls += 1
        },
        async unlockWithMnemonic() {
            const s = state.get(id)!
            s.wallet = fakeWallet(id)
            useActivePlatformStore().notifyWalletChanged()
        },
        // Shaped like the real stores after Phase 3: clear in place, then defer
        // to the platform layer instead of assigning `window.location`.
        logout: async () => {
            const s = state.get(id)!
            s.logoutCalls += 1
            s.wallet = null
            s.tornDownInPlace = true
            const store = useActivePlatformStore()
            store.notifyWalletChanged()
            await store.finishDisconnect()
        },
    }
}

/**
 * Avalanche's shape: an X chain (`utxo`) and a P chain (`staking`). Those two
 * kinds are what `isAvalancheActive` looks for, and no other platform declares
 * them — see the note on PlatformChainKind.
 */
const AVALANCHE_LIKE = 'test-ava-like'
/** Bitcoin's shape: a `bitcoin` chain, deliberately NOT `utxo`. */
const BITCOIN_LIKE = 'test-btc-like'
/** Solana's shape. */
const SOLANA_LIKE = 'test-sol-like'

registerPlatform(
    makePlatform(AVALANCHE_LIKE, [
        { id: 'X', label: 'X-Chain', kind: 'utxo' },
        { id: 'P', label: 'P-Chain', kind: 'staking' },
        { id: 'C', label: 'C-Chain', kind: 'evm', evmChainId: 43114 },
    ])
)
registerPlatform(makePlatform(BITCOIN_LIKE, [{ id: 'BTC', label: 'Bitcoin', kind: 'bitcoin' }]))
registerPlatform(makePlatform(SOLANA_LIKE, [{ id: 'SOL', label: 'Solana', kind: 'solana' }]))

let reloadedTo: string | null = null

beforeAll(() => {
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
        s.logoutCalls = 0
        s.activateCalls = 0
        s.tornDownInPlace = false
    }
})

function connect(store: ReturnType<typeof useActivePlatformStore>, id: PlatformId): void {
    state.get(id)!.wallet = fakeWallet(id)
    store.notifyWalletChanged()
}

/**
 * The rule `mainStore.activeWallet` is gated on. Everything in section (1) of
 * the header depends on this answering for the ACTIVE platform, never for
 * whichever platforms happen to be connected.
 */
describe('isAvalancheActive', () => {
    it('is true for a platform with X and P chains', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE

        expect(store.isAvalancheActive).toBe(true)
    })

    it('is false for a Bitcoin-shaped platform — a UTXO chain is not an X chain', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = BITCOIN_LIKE

        expect(store.isAvalancheActive).toBe(false)
    })

    it('is false for a single-chain non-UTXO platform', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = SOLANA_LIKE

        expect(store.isAvalancheActive).toBe(false)
    })

    /**
     * The property the gate exists for. Avalanche being *connected* must not
     * make it *active* — that is exactly the state Phase 3 created and the
     * seventy readers cannot tell apart on their own.
     */
    it('is false while Avalanche is connected but another platform is in front', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)

        expect(store.isAvalancheActive).toBe(true)

        store.activePlatformId = BITCOIN_LIKE

        // Still connected — the tab is there to go back to...
        expect(store.isPlatformConnected(AVALANCHE_LIKE)).toBe(true)
        // ...but its wallet must read as absent to everything platform-agnostic.
        expect(store.isAvalancheActive).toBe(false)
    })
})

describe('Avalanche alongside another platform', () => {
    it('switches away and back with no reload and no logout', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)

        await store.setActivePlatform(BITCOIN_LIKE)
        await store.setActivePlatform(AVALANCHE_LIKE)

        expect(reloadedTo).toBeNull()
        expect(state.get(AVALANCHE_LIKE)!.logoutCalls).toBe(0)
        expect(state.get(BITCOIN_LIKE)!.logoutCalls).toBe(0)
        expect(state.get(AVALANCHE_LIKE)!.wallet).not.toBeNull()
        expect(state.get(BITCOIN_LIKE)!.wallet).not.toBeNull()
    })

    it('is no longer a destructive switch in either direction', () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)

        expect(store.isDestructiveSwitch(BITCOIN_LIKE)).toBe(false)

        store.activePlatformId = BITCOIN_LIKE
        expect(store.isDestructiveSwitch(AVALANCHE_LIKE)).toBe(false)
    })

    it('re-entering the tab activates the platform so it can refresh', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)

        await store.setActivePlatform(BITCOIN_LIKE)
        await store.setActivePlatform(AVALANCHE_LIKE)

        // Avalanche's pollers no-op while its tab is not in front, so `activate`
        // is the only thing that brings the data back up to date.
        expect(state.get(AVALANCHE_LIKE)!.activateCalls).toBeGreaterThan(0)
    })

    it('shows both in the tab strip', () => {
        const store = useActivePlatformStore()
        connect(store, AVALANCHE_LIKE)
        connect(store, SOLANA_LIKE)

        const ids = store.connectedPlatforms.map((p) => p.descriptor.id)
        expect(ids).toEqual(expect.arrayContaining([AVALANCHE_LIKE, SOLANA_LIKE]))
    })
})

describe('ending the Avalanche session', () => {
    /**
     * The regression Phase 3 exists to prevent. Avalanche's logout used to be
     * `window.location.href = '/'`, which cleared its stores by discarding the
     * page — and with it every other platform's vault, since those live only in
     * memory. Disconnecting one platform must never cost the user another.
     */
    it('leaves every other live session untouched', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)
        connect(store, SOLANA_LIKE)

        await state.get(AVALANCHE_LIKE)!.wallet!.platformId
        await store.activePlatform!.logout()

        expect(reloadedTo).toBeNull()
        expect(state.get(AVALANCHE_LIKE)!.wallet).toBeNull()
        expect(state.get(AVALANCHE_LIKE)!.tornDownInPlace).toBe(true)
        expect(state.get(BITCOIN_LIKE)!.wallet).not.toBeNull()
        expect(state.get(SOLANA_LIKE)!.wallet).not.toBeNull()
        expect(state.get(BITCOIN_LIKE)!.logoutCalls).toBe(0)
        expect(state.get(SOLANA_LIKE)!.logoutCalls).toBe(0)
    })

    it('hands the user to a surviving session rather than stranding them', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)
        connect(store, BITCOIN_LIKE)

        await store.activePlatform!.logout()

        expect(store.activePlatformId).toBe(BITCOIN_LIKE)
    })

    /**
     * The reload is still correct when there is nothing left to protect — and
     * it is still what clears the Avalanche stores most thoroughly, so the
     * fallback must not be lost in the process of avoiding it.
     */
    it('still falls back to a full reset when it was the last session', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE
        connect(store, AVALANCHE_LIKE)

        await store.activePlatform!.logout()

        expect(reloadedTo).toBe('/')
    })
})

describe('Avalanche in the one-phrase unlock', () => {
    it('is offered now that it can hold a concurrent session', () => {
        const store = useActivePlatformStore()
        const ids = store.mnemonicUnlockablePlatforms.map((p) => p.descriptor.id)

        expect(ids).toContain(AVALANCHE_LIKE)
    })

    it('opens alongside the others from one phrase, with no reload', async () => {
        const store = useActivePlatformStore()
        store.activePlatformId = AVALANCHE_LIKE

        const results = await store.unlockWithMnemonic('phrase', 'password', [
            AVALANCHE_LIKE,
            BITCOIN_LIKE,
            SOLANA_LIKE,
        ])

        expect(results.every((r) => r.status === 'connected')).toBe(true)
        expect(store.connectedPlatforms).toHaveLength(3)
        expect(reloadedTo).toBeNull()
    })
})
