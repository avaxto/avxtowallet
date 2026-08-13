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

export interface PlatformDescriptor {
    id: PlatformId
    name: string
    /** Ticker of the platform's native asset, for UI labels. */
    symbol: string
    status: PlatformStatus
    /** Short line shown next to the platform in the picker. */
    description?: string
    icon?: string
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

export interface Platform {
    readonly descriptor: PlatformDescriptor
    readonly capabilities: PlatformCapabilities
    /** Empty for `planned` platforms — nothing to log into yet. */
    readonly accessMethods: AccessMethodDescriptor[]

    /** Called when this platform becomes the active one. */
    activate?(): Promise<void>
    /** Called when the user switches away from this platform. */
    deactivate?(): Promise<void>

    /** The currently connected wallet on this platform, or null. */
    getActiveWallet(): PlatformWallet | null
    /** Disconnect and clear all session state for this platform. */
    logout(): Promise<void>
}
