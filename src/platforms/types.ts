/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Platform abstraction.
 *
 * A "platform" is a source of accounts and assets the wallet can operate on —
 * a blockchain (Avalanche, Ethereum, Solana, Bitcoin) or an account-based
 * brokerage/custodial service (e.g. Robinhood). The interface is deliberately
 * neutral on BOTH axes that differ between them:
 *
 *   - custody: nothing here assumes the app holds a private key. A platform may
 *     sign locally (mnemonic), delegate to a device (Ledger), delegate to an
 *     extension (Core App), or simply call a remote API against a session token
 *     (a brokerage). That is why access is modelled as "access methods" rather
 *     than "import a key".
 *   - chain shape: a platform may expose several sub-chains (Avalanche's X/P/C)
 *     or exactly one, so addresses are a list tagged with a chain label rather
 *     than a fixed set of named fields.
 *
 * Everything a platform can't do is expressed through `PlatformCapabilities`
 * so the UI can branch on a capability instead of on a platform id — adding a
 * platform must not require editing feature components.
 */
import type Big from 'big.js'

import type { EvmSigner } from '@/evm/signer'

/**
 * Known platform ids. The `(string & {})` arm keeps the union open so a new
 * platform folder can introduce its own id without editing this file, while
 * still giving autocomplete for the ones that exist.
 */
export type PlatformId =
    | 'avalanche'
    | 'ethereum'
    | 'solana'
    | 'bitcoin'
    | 'robinhood'
    | (string & {})

/**
 * `available` platforms can be selected and logged into. `planned` ones are
 * listed (so the roadmap is visible) but cannot be activated — they have no
 * working access methods behind them.
 */
export type PlatformStatus = 'available' | 'planned'

/**
 * How an access method presents itself in the login UI.
 *  - `route`     — navigate to a dedicated view (mnemonic, keystore, …)
 *  - `action`    — run `run()` in place (connect to an injected extension)
 *  - `component` — a bespoke multi-step flow owns the button (Ledger)
 */
export type AccessMethodKind = 'route' | 'action' | 'component'

export interface AccessMethodDescriptor {
    id: string
    /** Fallback label, used when `labelKey` is absent or has no translation. */
    label: string
    /** i18n key, preferred over `label` so platforms stay localisable. */
    labelKey?: string
    kind: AccessMethodKind
    /** For `kind: 'route'`. */
    route?: string
    /** For `kind: 'action'`. Rejects with a user-facing message on failure. */
    run?: () => Promise<void>
    /**
     * For `kind: 'component'` — a key the login screen maps to a component it
     * already imports. Kept as a key (not the component itself) so this module
     * stays free of Vue imports and can be unit-tested headlessly.
     */
    component?: string
    icon?: { day: string; night: string }
    /** Watch-only: balances are visible but nothing can ever be signed. */
    readonly?: boolean
}

/**
 * What a platform supports. The UI should test these rather than testing a
 * platform id or a wallet `type` string.
 */
export interface PlatformCapabilities {
    send: boolean
    receive: boolean
    /** Native staking / delegation. */
    stake: boolean
    /** In-app token swap or DEX aggregation. */
    swap: boolean
    /** Transfers between a platform's own sub-chains (Avalanche X/P/C). */
    crossChain: boolean
    /** Arbitrary message signing, for proving address ownership. */
    signMessage: boolean
    /** NFTs / collectibles. */
    collectibles: boolean
    /** Sign now, broadcast later. */
    offlineSigning: boolean
}

/**
 * What kind of chain a sub-chain is, so UI can reason about it without knowing
 * platform names:
 *  - `evm`      — account/nonce model, 0x addresses, ERC-20s (C-Chain, Ethereum,
 *                 Robinhood Chain)
 *  - `utxo`     — UTXO model with atomic imports/exports (Avalanche X, Bitcoin)
 *  - `staking`  — a validator/delegation chain (Avalanche P)
 *  - `solana`   — account model, but ed25519/base58 keys and SPL token
 *                 accounts rather than contract balances. Distinct from `evm`
 *                 on purpose: `evm` is what EVM-only surfaces (the ERC-20
 *                 dropdown, `getEvmSigner`) gate on, and Solana can serve none
 *                 of them. Nothing currently gates *on* `solana` — it exists so
 *                 that a Solana chain matches none of the other kinds and the
 *                 platform renders as a plain single-chain account wallet.
 *  - `bitcoin`  — a UTXO chain, but NOT `utxo`. See the warning below.
 *
 * ## `utxo` means "Avalanche X-Chain", not "any UTXO chain"
 *
 * Bitcoin is a UTXO chain, so `kind: 'utxo'` looks like the honest label for
 * it. It is not, because of how this kind is actually consumed: every call
 * site tests `hasChainKind('utxo') || hasChainKind('staking')` and names the
 * result `isAvalanche` — App.vue boots the Avalanche network store behind it,
 * Transfer.vue renders the X-Chain send form, BalanceCard renders X/P balance
 * rows from Avalanche's store. A second platform claiming `utxo` turns all of
 * those on and breaks it entirely.
 *
 * Re-pointing those checks at something Avalanche-specific would be the
 * cleaner fix, but it means editing eight Avalanche-critical views for the
 * benefit of a label. `bitcoin` matches none of them, so Bitcoin renders as
 * the plain single-chain wallet it should — same reasoning as `solana`.
 */
export type PlatformChainKind = 'evm' | 'utxo' | 'staking' | 'solana' | 'bitcoin'

/**
 * One sub-chain exposed by a platform.
 *
 * Avalanche declares three (X/P/C); a single-chain platform declares exactly
 * one. This is what lets the UI hide X/P features generically: it checks for
 * the presence of a `utxo` / `staking` chain rather than testing
 * `platformId === 'avalanche'`.
 */
export interface PlatformChain {
    /** Short id, unique within the platform. Matches `PlatformAddress.chain`. */
    id: string
    /** Human label, e.g. 'X-Chain' or 'Robinhood Chain'. */
    label: string
    kind: PlatformChainKind
    /** EVM chain id — present only on `kind: 'evm'` chains. */
    evmChainId?: number
}

/**
 * A network (mainnet / testnet / custom) a platform can be pointed at.
 *
 * This generalises what used to be Avalanche's `AvaNetwork`: the wallet needs
 * an RPC endpoint, an explorer and the native asset's shape regardless of which
 * platform it is talking to.
 */
export interface PlatformNetwork {
    /** Stable id, unique within the platform (e.g. 'mainnet', 'testnet'). */
    id: string
    name: string
    isTestnet: boolean
    /** JSON-RPC endpoint used for reads and broadcasts. */
    rpcUrl: string
    /** Optional subscription endpoint, when the platform offers one. */
    wsUrl?: string
    /** Base URL of a block explorer, no trailing slash. */
    explorerUrl?: string
    /** EVM chain id, for `evm` platforms. */
    evmChainId?: number
    nativeSymbol: string
    nativeDecimals: number
}

/**
 * Per-platform interface tint.
 *
 * Applied as CSS custom properties when the platform becomes active, so the
 * whole UI re-themes without any component knowing which platform is selected.
 * Only the accent-ish tokens are overridable — backgrounds stay fixed so a
 * platform can't render the app unreadable.
 */
export interface PlatformTheme {
    /** Primary accent (buttons, active states). CSS colour string. */
    accent: string
    /** Text/icon colour to use *on top of* `accent`. */
    onAccent: string
    /** Colour the app logo is tinted to. */
    logo: string
}

/**
 * One entry in a platform's token registry — its pinned address for a known
 * token symbol. See `PlatformTokenRegistry` for what the registry is for.
 */
export interface PlatformTokenRegistryEntry {
    /**
     * The platform's native asset is not a contract — it has no address to
     * register. `null` is reserved for that entry specifically, not a
     * placeholder for "unknown". Every other entry must have a real one.
     */
    contractAddress: string | null
    name: string
    description: string
    symbol: string
    websiteUrl: string
    /**
     * Sub-chain id (`PlatformChain.id`) or EVM chain id the contract is
     * deployed on, for a platform that needs to disambiguate — e.g.
     * Avalanche's mainnet/Fuji use the same symbols at different addresses.
     * Omitted for the native entry and for any entry valid regardless of
     * which of the platform's networks is active.
     */
    chainId?: number
}

/**
 * A platform's own allowlist of pinned token addresses — used to catch
 * impostors of well-known symbols WITHOUT restricting what the platform can
 * otherwise discover or display. A token the registry has no entry for is
 * simply not something it has an opinion on; it isn't hidden or blocked, it
 * just isn't cross-checked. Only a candidate CLAIMING a symbol the registry
 * *does* know, at an address that isn't the one on file, gets rejected — see
 * `isSpoofedToken`.
 *
 * Optional on `Platform`: a platform with no registry yet has no
 * impostor-detection layer at all, which is exactly how every platform
 * behaved before this concept existed. See
 * `platforms/avalanche/tokenRegistry/` for the canonical, fully-populated
 * implementation and its complete design rationale — this interface is
 * deliberately just the shape other platforms implement to get the same
 * protection with their own data.
 */
export interface PlatformTokenRegistry {
    /** Every entry, native asset included. */
    getAll(): PlatformTokenRegistryEntry[]
    /** The entry for the platform's native asset. */
    getNativeEntry(): PlatformTokenRegistryEntry
    /** The registry entry for a contract address, or undefined if unregistered. */
    findToken(contractAddress: string, chainId?: number): PlatformTokenRegistryEntry | undefined
    /**
     * True when `symbol` matches a registry entry but `contractAddress`
     * doesn't match any registered contract for that symbol — i.e. this
     * looks like a known token but isn't deployed where the real one is.
     * False whenever `symbol` isn't one the registry has an entry for.
     */
    isSpoofedToken(symbol: string, contractAddress: string, chainId?: number): boolean
    /**
     * True for any symbol/name that reads as the platform's native asset
     * (e.g. "AVAX") — for chain shapes with no contract address to check
     * (Avalanche's X-chain "ANTs"), so an impostor of the native symbol can
     * still be rejected by name alone.
     */
    isReservedNativeSymbol(symbolOrName: string): boolean
}

export interface PlatformDescriptor {
    id: PlatformId
    name: string
    /** Ticker of the platform's native asset, for UI labels. */
    symbol: string
    status: PlatformStatus
    /** Short line shown next to the platform in the picker. */
    description?: string
    icon?: string
    /** Overrides the default interface colours while this platform is active. */
    theme?: PlatformTheme
}

export interface PlatformAddress {
    /**
     * Sub-chain label. Avalanche uses 'X' | 'P' | 'C'; single-chain platforms
     * should use their own short label (e.g. 'BTC') rather than an empty string
     * so the UI always has something to render.
     */
    chain: string
    address: string
    label?: string
}

export interface PlatformBalance {
    /** Platform-unique asset identifier (asset id, contract address, ticker). */
    assetId: string
    symbol: string
    name: string
    decimals: number
    /** Human-readable amount, already scaled by `decimals`. */
    amount: Big
    logoUri?: string
    /** Sub-chain this balance sits on, matching `PlatformAddress.chain`. */
    chain?: string
}

/**
 * A connected account on a platform.
 *
 * Note this is intentionally a *narrow* surface: it covers what generic,
 * platform-agnostic UI needs. Deep platform-specific operations (Avalanche's
 * X/P/C atomic import/export, EVM contract calls, …) stay on the underlying
 * object reached through `native`.
 */
export interface PlatformWallet {
    readonly platformId: PlatformId
    /** Stable within a session; used to tell multiple connected wallets apart. */
    readonly id: string
    /** Which `AccessMethodDescriptor.id` produced this wallet. */
    readonly accessMethodId: string
    /** True for watch-only access (XPUB, address-only). */
    readonly isReadonly: boolean

    getAddresses(): PlatformAddress[]
    /** The address to show when only one can be shown. */
    getPrimaryAddress(): string
    getBalances(): Promise<PlatformBalance[]>
    /** Present only when `capabilities.signMessage` is true. */
    signMessage?(message: string, address?: string): Promise<string>

    /**
     * The platform's own wallet object.
     *
     * Escape hatch for the large body of existing code that is still written
     * against a specific platform's types. New code should prefer the methods
     * above; this exists so the abstraction can be adopted incrementally
     * instead of requiring every consumer to migrate at once.
     */
    readonly native: unknown
}

/**
 * Per-call options for a platform store's `access*` methods.
 *
 * Only `navigate` today. It exists because those methods have always ended by
 * pushing `/wallet`, which is right for the single-platform login screens that
 * call them but wrong for the multi-platform unlock, where several run
 * concurrently and the first to finish would navigate away from the form still
 * opening the others. Defaulted to navigating so every existing caller keeps
 * its current behaviour without passing anything.
 */
export interface AccessOptions {
    /** Push `/wallet` on success. Default true. */
    navigate?: boolean
}

export interface Platform {
    readonly descriptor: PlatformDescriptor
    readonly capabilities: PlatformCapabilities
    /** Empty for `planned` platforms — nothing to log into yet. */
    readonly accessMethods: AccessMethodDescriptor[]

    /**
     * Sub-chains this platform exposes.
     *
     * Empty for `planned` platforms. The UI uses this — not the platform id —
     * to decide whether to show chain-shape-specific features, so a
     * single-EVM-chain platform automatically renders as a plain account
     * wallet with no cross-chain or staking surface.
     */
    readonly chains: PlatformChain[]

    /** Networks this platform can be pointed at. Empty for `planned` ones. */
    readonly networks: PlatformNetwork[]

    /** This platform's pinned-address allowlist, when it has one. See PlatformTokenRegistry. */
    readonly tokenRegistry?: PlatformTokenRegistry
    /** The network currently selected, or null when the platform has none. */
    getActiveNetwork?(): PlatformNetwork | null
    /** Point the platform at one of its `networks`. */
    setActiveNetwork?(id: string): Promise<void>

    /**
     * True when this platform's entire session lives in its own store, so it
     * can stay connected alongside other platforms without a page reload.
     *
     * This is what makes the tabbed multi-platform session possible: switching
     * between two platforms that both declare it only moves
     * `activePlatformId`, leaving both wallets live. See `setActivePlatform`
     * in ./store.ts.
     *
     * Every shipped platform declares it. Avalanche was the last to, and is
     * worth reading as the general case rather than the exception: its session
     * still lives in the legacy global stores, not a per-platform one. What
     * disqualified it was never *where* the state lived but two consequences
     * of it — a wallet visible to platform-agnostic readers while another
     * platform was active, and a `logout()` that reloaded the page. Both are
     * addressed at their source (see the notes on `mainStore.activeWallet` and
     * `resetSession`), so the flag is about observable behaviour, not file
     * layout.
     *
     * A platform declaring this must also keep `logout()` free of
     * `window.location` navigation, or disconnecting it would tear down every
     * *other* live session with it — their vaults are in memory only.
     */
    readonly supportsConcurrentSession?: boolean

    /**
     * Open a session on this platform from a BIP-39 recovery phrase, WITHOUT
     * navigating afterwards.
     *
     * This is what the one-phrase multi-platform unlock drives (see
     * `unlockWithMnemonic` in ../store.ts). It is deliberately separate from
     * the `mnemonic` entry in `accessMethods`: that one is a route to a
     * platform-specific screen which ends by pushing `/wallet`, which is
     * exactly wrong when several platforms are being opened in one go — the
     * first one to finish would navigate away from the form still unlocking
     * the rest.
     *
     * Declaring this is a promise about two things beyond derivation:
     *
     *  - the phrase alone is enough (no extension, no device), and
     *  - the resulting session is isolated, so it can coexist with the other
     *    platforms unlocked in the same pass. `supportsConcurrentSession` is
     *    therefore a prerequisite; the store filters on both, because opening a
     *    non-isolated session alongside others would leave the user with tabs
     *    that log each other out.
     *
     * Avalanche implements this too, and had to earn it: its session must also
     * bring the Avalanche network up first, since the one-phrase unlock can run
     * while a different platform is active and nothing will have configured the
     * SDK's endpoints yet.
     */
    unlockWithMnemonic?(mnemonic: string, sessionPassword: string): Promise<void>

    /**
     * Whether an extension that can open THIS platform is installed right now.
     *
     * Must be synchronous and side-effect free — no `request`, no popup. It is
     * called to decide which platforms to *offer*, on every render of the
     * access screen, long before the user has agreed to connect anything.
     * Probing the extension here would prompt them for permission to answer a
     * question they have not asked yet.
     *
     * This is what makes the multi-platform connect honest about a given
     * extension. Core speaks Bitcoin, EVM and Solana; Phantom speaks Solana;
     * MetaMask speaks EVM only. Rather than keeping a table of which vendor
     * supports what — which would be wrong the week any of them ships a new
     * chain — each platform answers for itself by looking for its own provider,
     * and the fan-out opens whatever answers yes.
     */
    isInjectedAvailable?(): boolean

    /**
     * Open a session on this platform from an injected extension, WITHOUT
     * navigating afterwards.
     *
     * The injected counterpart of `unlockWithMnemonic`, and separate from the
     * `injected` entry in `accessMethods` for the same reason: that one ends by
     * pushing `/wallet`, which is exactly wrong when several platforms are
     * being opened in one pass — the first to finish would navigate away from
     * the screen still connecting the rest.
     *
     * Declaring this is a promise that the resulting session is isolated, so it
     * can coexist with the other platforms opened in the same pass;
     * `supportsConcurrentSession` is therefore a prerequisite, and the store
     * filters on both. See `connectWithInjected` in ../store.ts.
     *
     * A platform with no injected path at all simply omits this and stays out
     * of the fan-out. Bitcoin is the current example: browser wallets there
     * (Unisat, Xverse, Leather, OKX) each expose a bespoke API rather than
     * anything resembling EIP-1193, so it is local-key only — see the note at
     * the top of ./bitcoin/index.ts. It joins the moment it can answer these
     * two methods, with no edit to the store or the access screen.
     */
    connectInjected?(): Promise<void>

    /** Called when this platform becomes the active one. */
    activate?(): Promise<void>
    /** Called when the user switches away from this platform. */
    deactivate?(): Promise<void>

    /** The currently connected wallet on this platform, or null. */
    getActiveWallet(): PlatformWallet | null

    /**
     * An EVM signer for the connected wallet, when this platform has an `evm`
     * chain and something is connected to sign with.
     *
     * Absent on platforms with no EVM chain at all (Bitcoin, Solana) — which is
     * how EVM-only features stay generic: they ask the active platform for a
     * signer and disable themselves when there isn't one, instead of testing
     * a platform id. See `@/evm/signer`.
     */
    getEvmSigner?(): EvmSigner | null

    /** Disconnect and clear all session state for this platform. */
    logout(): Promise<void>
}
