/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Avalanche's session teardown clears everything a session put there.
 *
 * Logging out of Avalanche used to be one line — `window.location.href = '/'`
 * — and that line did all the work: every store, poller and SDK singleton went
 * away with the page. It had to go, because a reload also destroys every other
 * platform's in-memory vault, so disconnecting Avalanche would silently log the
 * user out of Bitcoin and Solana too. `mainStore.resetSession` replaces it by
 * hand.
 *
 * Doing it by hand has one specific failure mode, and it is severe: anything
 * missed keeps the previous account's data, and the next wallet to connect
 * inherits it. Balances, addresses and transaction history belonging to someone
 * else, presented as the current wallet's own.
 *
 * So this file deliberately does NOT mirror the list of fields `resetSession`
 * clears. A test written that way passes exactly when the implementation is
 * copied into it, and stays silent about the case that actually matters —
 * someone adding session state later and not thinking about logout. Instead it
 * walks each store's state generically: dirty every key, reset, and require
 * every key to be back where it started unless this file explicitly says that
 * key is chain configuration rather than session data.
 *
 * Adding a session field and forgetting `resetSession` therefore fails here, by
 * name, without anyone having remembered to add an assertion for it.
 */
import { createPinia, setActivePinia, type Pinia } from 'pinia'

import { useMainStore } from '@/stores/main'
import { useAssetsStore } from '@/stores/assets'
import { useHistoryStore } from '@/stores/history'
import { useEarnStore } from '@/stores/earn'
import { useErc721Store } from '@/stores/erc721'
import { useEvmPortfolioStore } from '@/stores/evmPortfolio'
import { useOfflineSigningStore } from '@/stores/offlineSigning'
import { useTransferPrefillStore } from '@/stores/transferPrefill'
import { useSessionLogStore } from '@/stores/sessionlog'
import { useLedgerStore } from '@/stores/ledger'
import { useAvxtoStore } from '@/stores/avxto'

/**
 * State that deliberately OUTLIVES a session, with the reason.
 *
 * The rule: does this describe the chain, or the person logged in? Chain and
 * app configuration stays — clearing it would be a bug of its own, throwing
 * away the user's custom tokens or their saved networks on every logout.
 *
 * Every entry here is a claim that survives review. Adding one to silence a
 * failure is how this test stops being worth running.
 */
const PRESERVED: Record<string, Record<string, string>> = {
    main: {
        prices: 'The AVAX price is a market fact, not a property of the wallet.',
        cookiesAccepted: 'A consent decision, deliberately persisted across sessions.',
    },
    assets: {
        // The token *definitions* are chain configuration. The per-wallet
        // balances hanging off them are not, and are cleared — see
        // `Erc20Token.resetBalance`, which is exactly this distinction.
        erc20Tokens: 'Token definitions for the chain, not the wallet.',
        erc20TokensCustom: "The user's own added tokens — clearing them loses data.",
        tokenLists: 'Chain configuration.',
        tokenListUrls: 'Chain configuration.',
        tokenListsCustom: "The user's own token lists.",
        nftWhitelist: 'A user preference about display, not session data.',
        baseAsset: 'Describes the connected chain.',
        evmChainId: 'Describes the connected chain.',
    },
    offlineSigning: {
        isEnabled: 'A persisted mode the user turned on; surviving logout is the point.',
    },
    erc721: {
        erc721Tokens: 'Contract definitions for the chain.',
        erc721TokensCustom: "The user's own added contracts.",
    },
}

/** Marker pushed into arrays and object slots when dirtying state. */
const DIRTY = '__dirty__'

/**
 * A stand-in wallet-ish object to push into arrays.
 *
 * Teardown walks some of these arrays and calls into their members —
 * `clearWalletVaults` tests for a `vault`, `assets.resetSession` calls
 * `resetBalance` on every token. A bare string would make those throw for the
 * wrong reason, so the sentinel answers both harmlessly while still being
 * obviously not-real.
 */
function dirtyMember(): Record<string, unknown> {
    return { [DIRTY]: true, resetBalance: () => undefined }
}

/** A comparable summary of a value — enough to tell "cleared" from "not". */
function fingerprint(value: unknown): string {
    if (value === null) return 'null'
    if (value === undefined) return 'undefined'
    if (Array.isArray(value)) return `array:${value.length}`
    if (typeof value === 'object') {
        // BN, Big and friends: their own toString is the honest summary.
        const proto = Object.getPrototypeOf(value)
        if (proto && proto.constructor && proto.constructor.name !== 'Object') {
            return `${proto.constructor.name}:${String(value)}`
        }
        return `object:${Object.keys(value as object).sort().join(',')}`
    }
    return `${typeof value}:${String(value)}`
}

/** Mutates `value` into something visibly different, in place where possible. */
function dirty(value: unknown): unknown {
    if (Array.isArray(value)) {
        value.push(dirtyMember())
        return value
    }
    if (typeof value === 'string') return DIRTY
    if (typeof value === 'number') return value + 1
    if (typeof value === 'boolean') return !value
    if (value === null || value === undefined) return DIRTY
    if (typeof value === 'object') {
        try {
            ;(value as Record<string, unknown>)[DIRTY] = true
            return value
        } catch {
            return DIRTY
        }
    }
    return DIRTY
}

let pinia: Pinia

/** The stores `mainStore.resetSession` is responsible for, by store id. */
function avalancheStores() {
    return {
        main: useMainStore(),
        assets: useAssetsStore(),
        history: useHistoryStore(),
        earn: useEarnStore(),
        erc721: useErc721Store(),
        evmPortfolio: useEvmPortfolioStore(),
        offlineSigning: useOfflineSigningStore(),
        transferPrefill: useTransferPrefillStore(),
        sessionlog: useSessionLogStore(),
        ledger: useLedgerStore(),
        avxto: useAvxtoStore(),
    }
}

beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    localStorage.clear()
})

describe('resetSession', () => {
    it('returns every session-scoped field to its initial value', () => {
        const stores = avalancheStores()
        const storeIds = Object.keys(stores)

        // Snapshot first: some initial values are themselves non-trivial.
        const before: Record<string, Record<string, string>> = {}
        for (const id of storeIds) {
            const state = pinia.state.value[id] as Record<string, unknown>
            before[id] = {}
            for (const key of Object.keys(state)) {
                before[id][key] = fingerprint(state[key])
            }
        }

        // Dirty everything, indiscriminately — including the fields this test
        // expects to survive, so that "preserved" is also asserted rather than
        // merely skipped.
        for (const id of storeIds) {
            const state = pinia.state.value[id] as Record<string, unknown>
            for (const key of Object.keys(state)) {
                state[key] = dirty(state[key])
            }
        }

        stores.main.resetSession()

        const notCleared: string[] = []
        const wronglyCleared: string[] = []

        for (const id of storeIds) {
            const state = pinia.state.value[id] as Record<string, unknown>
            for (const key of Object.keys(state)) {
                const now = fingerprint(state[key])
                const wasPreserved = PRESERVED[id]?.[key] !== undefined
                const restored = now === before[id][key]

                if (wasPreserved && restored) {
                    // Declared session-independent, yet teardown put it back:
                    // one of the two is wrong, and silence would hide it.
                    wronglyCleared.push(`${id}.${key}`)
                } else if (!wasPreserved && !restored) {
                    notCleared.push(`${id}.${key} (${before[id][key]} -> ${now})`)
                }
            }
        }

        expect({ notCleared, wronglyCleared }).toEqual({
            notCleared: [],
            wronglyCleared: [],
        })
    })

    it('drops the persisted wallet so the next boot does not restore it', () => {
        localStorage.setItem('w', 'persisted-wallet-blob')

        useMainStore().resetSession()

        expect(localStorage.getItem('w')).toBeNull()
    })

    /**
     * The vault holds the session's secrets as ciphertext in ordinary memory.
     * Dropping the reference is not the same as clearing it: a wallet still
     * reachable from a closure, a pending promise or an undisposed component
     * keeps its vault — and its secrets — alive. Before Phase 3 the reload made
     * that moot.
     */
    it('wipes the vault of every wallet it held, not just the reference', () => {
        const store = useMainStore()
        const cleared: string[] = []
        const withVault = (id: string) => ({
            id,
            vault: {
                clear: () => {
                    cleared.push(id)
                },
            },
        })

        // Ledger and injected wallets have no vault — the key never leaves the
        // device or the extension — so teardown must tolerate their absence.
        const external = { id: 'ledger' }

        store.wallets = [withVault('a'), external, withVault('b')] as never
        store.volatileWallets = [withVault('volatile')] as never

        expect(() => store.resetSession()).not.toThrow()
        expect(cleared.sort()).toEqual(['a', 'b', 'volatile'])
    })
})
