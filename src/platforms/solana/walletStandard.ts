/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wallet Standard discovery, and a `SolanaProvider` adapter over it.
 *
 * Phantom, Solflare and the other Phantom-era extensions all still claim the
 * de-facto `window.solana`-shaped interface `provider.ts` detects directly.
 * Core does not: it registers its Solana wallet through the Wallet Standard
 * instead (https://github.com/wallet-standard/wallet-standard) — a
 * chain-agnostic, event-based discovery protocol several newer wallets use in
 * place of a global namespace, precisely so unrelated wallets stop fighting
 * over one. This file bridges the two: it discovers Wallet Standard wallets
 * and wraps the requested one in an object shaped exactly like
 * `SolanaProvider`, so nothing downstream — `connectInjectedSolana`,
 * `InjectedSolanaWallet`, the `isInjectedAvailable` check in
 * `platforms/solana/index.ts` — needs to know which discovery mechanism
 * actually found the wallet.
 *
 * Minimal local types rather than the `@wallet-standard/*` /
 * `@solana/wallet-standard-features` packages (not a dependency here): this
 * needs a handful of fields off the wallet object and four feature methods,
 * the same call `provider.ts` already makes for the Phantom-style interface
 * instead of depending on `@solana/wallet-adapter-phantom`.
 */
import type { Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import type { SolanaProvider } from './provider'

/** Chain identifiers this app can act on. Order is preference, not priority. */
const SOLANA_CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const

interface WalletStandardAccount {
    readonly address: string
    readonly publicKey: Uint8Array
    readonly chains: readonly string[]
    readonly features: readonly string[]
    readonly label?: string
}

interface StandardConnectFeature {
    readonly connect: (input?: {
        silent?: boolean
    }) => Promise<{ accounts: readonly WalletStandardAccount[] }>
}
interface StandardDisconnectFeature {
    readonly disconnect: () => Promise<void>
}
interface StandardEventsFeature {
    readonly on: (
        event: 'change',
        listener: (properties: { accounts?: readonly WalletStandardAccount[] }) => void
    ) => () => void
}
interface SolanaSignMessageFeature {
    readonly signMessage: (
        ...inputs: readonly { account: WalletStandardAccount; message: Uint8Array }[]
    ) => Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]>
}
interface SolanaSignAndSendTransactionFeature {
    readonly signAndSendTransaction: (
        ...inputs: readonly {
            account: WalletStandardAccount
            transaction: Uint8Array
            chain: string
        }[]
    ) => Promise<readonly { signature: Uint8Array }[]>
}

/** The Wallet Standard `Wallet` object, narrowed to the fields this file reads. */
export interface StandardWallet {
    readonly name: string
    readonly chains: readonly string[]
    readonly features: {
        readonly ['standard:connect']?: StandardConnectFeature
        readonly ['standard:disconnect']?: StandardDisconnectFeature
        readonly ['standard:events']?: StandardEventsFeature
        readonly ['solana:signMessage']?: SolanaSignMessageFeature
        readonly ['solana:signAndSendTransaction']?: SolanaSignAndSendTransactionFeature
        readonly [feature: string]: unknown
    }
}

/**
 * Whether a registered wallet is one this app can actually drive.
 *
 * It must speak at least one Solana chain and offer both connect and
 * sign-and-send — a wallet lacking either implements the Wallet Standard for
 * some OTHER capability set only (a hardware-signer-only wallet with no send,
 * say), and offering it here would produce a tab that cannot transact.
 */
function isUsableSolanaWallet(wallet: StandardWallet): boolean {
    return (
        wallet.chains.some((c) => (SOLANA_CHAINS as readonly string[]).includes(c)) &&
        !!wallet.features['standard:connect'] &&
        !!wallet.features['solana:signAndSendTransaction']
    )
}

const discovered: StandardWallet[] = []
const seen = new Set<StandardWallet>()

function registerOne(wallet: StandardWallet): void {
    if (seen.has(wallet)) return
    seen.add(wallet)
    discovered.push(wallet)
}

function registerApi(...wallets: StandardWallet[]): () => void {
    wallets.forEach(registerOne)
    // The Wallet Standard's `register` returns an unregister function; this
    // app never needs to un-know a wallet once seen, so it's a no-op rather
    // than plumbing a second event class through for a case that never fires.
    return () => {}
}

// Runs once at module load. Catches any wallet that self-announces at any
// point AFTER this module evaluates — including one whose content script
// hasn't run yet when this file first does. This is the half of the protocol
// `detectStandardWallets` below cannot cover on its own: an `app-ready`
// dispatch only reaches wallets that are already listening for it.
if (typeof window !== 'undefined') {
    window.addEventListener('wallet-standard:register-wallet', ((event: CustomEvent) => {
        event.detail({ register: registerApi })
    }) as EventListener)
}

/**
 * Synchronous snapshot of every usable Wallet Standard Solana wallet seen so
 * far.
 *
 * Two sources, matching the protocol's own two-event design (see
 * `window.ts` in wallet-standard/wallet-standard): wallets that had already
 * loaded and are listening for `app-ready` are caught by the dispatch below,
 * which every call re-issues; wallets that load afterwards are caught by the
 * persistent `register-wallet` listener above. Neither alone is sufficient —
 * the load order between this page and any given extension is not
 * guaranteed, and this file cannot control it.
 *
 * Deliberately synchronous, and re-dispatching on every call rather than
 * caching: `Platform.isInjectedAvailable()` is a synchronous, side-effect-free
 * contract (see the note on it in platforms/types.ts) called from render —
 * and per the note on `injectedConnectablePlatforms` in platforms/store.ts,
 * anything that can go stale relative to a real extension's async injection
 * must be re-read live, not cached once.
 */
export function detectStandardWallets(): StandardWallet[] {
    window.dispatchEvent(
        new CustomEvent('wallet-standard:app-ready', { detail: { register: registerApi } })
    )
    return discovered.filter(isUsableSolanaWallet)
}

/**
 * Adapts one Wallet Standard wallet to the Phantom-style `SolanaProvider`
 * interface every other Solana call site in this app already expects.
 */
class WalletStandardAdapter implements SolanaProvider {
    publicKey: { toString(): string } | null = null
    isConnected = false

    private account: WalletStandardAccount | null = null
    private readonly chain: string
    /**
     * One underlying Wallet Standard `change` subscription per registered
     * `(event, handler)` pair — `on` doesn't take a handler to remove later
     * the way the Phantom-style interface does, it hands back a disposer per
     * call, so this is what makes `removeListener` possible at all.
     */
    private readonly disposers = new Map<(...args: unknown[]) => void, () => void>()

    constructor(private readonly wallet: StandardWallet) {
        // The first Solana chain the wallet actually declares, not a
        // hardcoded guess — a wallet exposing devnet only must never be asked
        // to sign for mainnet.
        this.chain =
            wallet.chains.find((c) => (SOLANA_CHAINS as readonly string[]).includes(c)) ??
            SOLANA_CHAINS[0]
    }

    get name(): string {
        return this.wallet.name
    }

    async connect(opts?: {
        onlyIfTrusted?: boolean
    }): Promise<{ publicKey: { toString(): string } }> {
        const connect = this.wallet.features['standard:connect']
        if (!connect) throw new Error(`${this.wallet.name} does not support connecting.`)

        const { accounts } = await connect.connect({ silent: opts?.onlyIfTrusted })
        const account = accounts[0]
        if (!account) throw new Error(`No account returned from ${this.wallet.name}.`)

        this.account = account
        this.publicKey = { toString: () => account.address }
        this.isConnected = true
        return { publicKey: this.publicKey }
    }

    async disconnect(): Promise<void> {
        await this.wallet.features['standard:disconnect']?.disconnect()
        this.isConnected = false
        this.publicKey = null
        this.account = null
    }

    async signMessage(message: Uint8Array, _encoding?: string): Promise<{ signature: Uint8Array }> {
        const feature = this.wallet.features['solana:signMessage']
        if (!feature) throw new Error(`${this.wallet.name} does not support message signing.`)

        const [result] = await feature.signMessage({ account: this.requireAccount(), message })
        if (!result) throw new Error(`${this.wallet.name} returned no signature.`)
        return { signature: result.signature }
    }

    async signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }> {
        const feature = this.wallet.features['solana:signAndSendTransaction']
        if (!feature) throw new Error(`${this.wallet.name} does not support sending transactions.`)

        // Unsigned, serialized: the wallet signs AND submits in one round
        // trip — the same contract as the Phantom-style path this replaces,
        // see the note on InjectedSolanaWallet.sendSol in ./wallet.ts.
        const serialized = transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
        })
        const [result] = await feature.signAndSendTransaction({
            account: this.requireAccount(),
            transaction: serialized,
            chain: this.chain,
        })
        if (!result) throw new Error(`${this.wallet.name} returned no signature.`)
        // Every other SolanaProvider (Phantom, Solflare) returns this
        // base58-encoded already; callers (InjectedSolanaWallet.sendSol) treat
        // it as the transaction id string, so the raw bytes standard:events
        // hands back must be encoded the same way here.
        return { signature: bs58.encode(result.signature) }
    }

    /**
     * Bridges Wallet Standard's single `change` event onto the two discrete
     * events (`accountChanged`, `disconnect`) `platforms/solana/store.ts`
     * listens for — an empty `accounts` array in a `change` is how a Wallet
     * Standard wallet reports the site was disconnected from inside the
     * extension, since the protocol defines no separate disconnect event.
     */
    on(event: string, handler: (...args: unknown[]) => void): void {
        if (event !== 'accountChanged' && event !== 'disconnect') return
        const events = this.wallet.features['standard:events']
        if (!events) return

        const off = events.on('change', (properties) => {
            if (!properties.accounts) return
            const next = properties.accounts[0] ?? null
            this.account = next
            this.publicKey = next ? { toString: () => next.address } : null

            if (event === 'accountChanged') handler(this.publicKey)
            else if (!next) handler()
        })
        this.disposers.set(handler, off)
    }

    removeListener(event: string, handler: (...args: unknown[]) => void): void {
        void event
        this.disposers.get(handler)?.()
        this.disposers.delete(handler)
    }

    private requireAccount(): WalletStandardAccount {
        if (!this.account) throw new Error(`${this.wallet.name} is not connected.`)
        return this.account
    }
}

/**
 * The Wallet Standard wallet to use, adapted to `SolanaProvider`, or null when
 * none is registered. Picks the first usable one seen — same single-candidate
 * contract as `detectSolanaProvider` in ./provider.ts, which this backs as a
 * fallback for wallets that don't claim the legacy `window.solana` shape.
 */
export function detectStandardSolanaProvider(): { provider: SolanaProvider; name: string } | null {
    const wallet = detectStandardWallets()[0]
    if (!wallet) return null
    return { provider: new WalletStandardAdapter(wallet), name: wallet.name }
}
