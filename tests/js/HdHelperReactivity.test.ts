import { reactive, markRaw, computed, effect, ref } from 'vue'

/**
 * Regression test for the fix applied in src/js/HdHelper.ts.
 *
 * The bug: AbstractHdWallet's constructor kicks off HdHelper.oninit()
 * immediately after `new HdHelper(...)` returns — well before the owning
 * wallet is ever placed into the Pinia store and wrapped in Vue reactivity.
 * findHdIndex() (called from oninit()) is a regular async method, so once it
 * finally resolves and does `this.hdIndex = X`, that mutation happens through
 * whatever `this` was bound to at call time.
 *
 * Before the fix: `this` was the raw, unwrapped HdHelper instance (since no
 * proxy existed yet), so the mutation bypassed Vue's reactivity entirely — a
 * Vue computed that read hdIndex before the scan resolved got permanently
 * stuck at its first (usually 0, or a partial) value, e.g. the address list
 * on /wallet/addresses.
 *
 * The fix: HdHelper's own constructor now does `return reactive(this)`, so
 * every external reference to a HdHelper instance — including the one
 * AbstractHdWallet's constructor calls .oninit() on — is already the
 * reactive proxy from the moment the object exists. Because oninit()/
 * findHdIndex() are ordinary (non-arrow) methods, `this` inside them is
 * whatever they were CALLED ON (dynamic dispatch), not a value captured by a
 * lexical closure — so this self-wrap correctly propagates.
 *
 * These tests build a minimal shim reproducing that exact shape (self-wrap +
 * markRaw on the crypto-adjacent fields) rather than constructing a real
 * HdHelper, which pulls in a dependency chain (@avalanche-sdk/client,
 * bitcoinjs-lib) this project's current jest/babel install can't run yet —
 * a separate, pre-existing gap unrelated to this fix.
 */

// Mimics a third-party crypto object (like hdkey's HDKey) that must never be
// wrapped in a Vue Proxy — `.derive()` is called hundreds of times during a
// scan, and neither hdkey nor AvalancheJS is written expecting to run behind
// one.
class CryptoLikeNode {
    calls = 0
    derive(path: string) {
        this.calls++
        return this
    }
}

/** The buggy shape: no self-wrap, mutated by a fire-and-forget async method
 *  invoked from the owning object's own constructor. */
class HdHelperBuggy {
    hdIndex = 0
    masterKey = new CryptoLikeNode()

    async oninit() {
        await Promise.resolve()
        this.hdIndex = 42
    }
}

/** The fixed shape, matching HdHelper.ts. */
class HdHelperFixed {
    hdIndex = 0
    masterKey: CryptoLikeNode

    constructor() {
        this.masterKey = markRaw(new CryptoLikeNode())
        return reactive(this) as HdHelperFixed
    }

    async oninit() {
        await Promise.resolve()
        this.hdIndex = 42
    }
}

class WalletLike<T extends { oninit(): Promise<void> }> {
    helper: T
    constructor(makeHelper: () => T) {
        this.helper = makeHelper()
        // Mirrors AbstractHdWallet's constructor: fire-and-forget, not awaited.
        this.helper.oninit()
    }
}

function mountAsActiveWallet<T>(wallet: T) {
    // Mirrors stores/main.ts: a plain ref whose value is a class instance.
    // Vue's ref() internally reactive-wraps object values assigned to it.
    const _activeWallet = ref<T | null>(null)
    const activeWallet = computed({
        get: () => _activeWallet.value,
        set: (w: T | null) => {
            _activeWallet.value = w
        },
    })
    activeWallet.value = wallet
    return activeWallet
}

describe('HdHelper reactivity fix (reactive self-wrap + markRaw)', () => {
    it('demonstrates the bug: an unwrapped instance freezes a computed at its stale value', async () => {
        const wallet = new WalletLike(() => new HdHelperBuggy())
        const activeWallet = mountAsActiveWallet(wallet)

        const hdIndexComputed = computed(() => activeWallet.value!.helper.hdIndex)

        let runs = 0
        effect(() => {
            runs++
            hdIndexComputed.value
        })

        expect(hdIndexComputed.value).toBe(0)
        expect(runs).toBe(1)

        await Promise.resolve()
        await Promise.resolve()

        // The raw property IS updated...
        expect(wallet.helper.hdIndex).toBe(42)
        // ...but nothing notified Vue, so the computed never re-ran.
        expect(hdIndexComputed.value).toBe(0)
        expect(runs).toBe(1)
    })

    it('fixes it: a self-wrapped instance correctly notifies the computed', async () => {
        const wallet = new WalletLike(() => new HdHelperFixed())
        const activeWallet = mountAsActiveWallet(wallet)

        const hdIndexComputed = computed(() => activeWallet.value!.helper.hdIndex)

        let runs = 0
        effect(() => {
            runs++
            hdIndexComputed.value
        })

        expect(hdIndexComputed.value).toBe(0)
        expect(runs).toBe(1)

        await Promise.resolve()
        await Promise.resolve()

        expect(wallet.helper.hdIndex).toBe(42)
        expect(hdIndexComputed.value).toBe(42)
        expect(runs).toBe(2)
    })

    it('markRaw keeps the crypto-adjacent object un-proxied even once the helper is reactive', () => {
        const helper = new HdHelperFixed()
        // Vue's reactive() lazily wraps nested objects on first GET through the
        // proxy — accessing masterKey must NOT trigger that for a markRaw'd field.
        const node = helper.masterKey
        node.derive('m/0/0')
        node.derive('m/0/1')

        expect(node.calls).toBe(2)
        // If this were wrapped, `node` would be a Proxy, not the raw instance.
        expect(node).toBeInstanceOf(CryptoLikeNode)
    })
})
