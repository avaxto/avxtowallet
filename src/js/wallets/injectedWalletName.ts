/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Names for the wallet-type badge, asked of the extension itself:
 *
 *  - `injectedAccountName` — the connected ACCOUNT's name as the extension
 *    shows it ("Account 1", or whatever the user renamed it to). Only Core
 *    exposes this, through `avalanche_getAccounts`; other wallets — MetaMask
 *    included — do not tell websites their account labels at all.
 *  - `injectedWalletName` — the EXTENSION's name ("Core", "MetaMask", …), the
 *    fallback when there is no account name.
 *
 * The extension name comes from EIP-6963: the page dispatches
 * `eip6963:requestProvider` and every installed wallet answers with an
 * `eip6963:announceProvider` event carrying its `info.name` and its provider
 * object. The name is taken from the announcement whose provider IS the one
 * the wallet is connected through, so two installed extensions cannot be
 * confused for each other.
 *
 * Extensions that predate EIP-6963, or that announce a different object from
 * the `window.ethereum` / `window.avalanche` handle in use, fall back to the
 * identity flags wallets set on their provider. Core is checked before
 * MetaMask on purpose: Core also sets `isMetaMask` for compatibility.
 *
 * Reactive: announcements can arrive after a wallet connected (an extension
 * that loads late), and `walletEpoch` makes any computed that read a name
 * re-run when one does.
 */
import { ref } from 'vue'

interface Eip6963Info {
    uuid?: string
    name?: string
    icon?: string
    rdns?: string
}

/** Announced providers, by provider object. A WeakMap: nothing kept alive. */
const announced = new WeakMap<object, Eip6963Info>()
const walletEpoch = ref(0)
let listening = false

function onAnnounce(event: Event): void {
    const detail = (event as CustomEvent).detail
    const provider = detail?.provider
    if (!provider || typeof provider !== 'object') return
    announced.set(provider, detail.info ?? {})
    walletEpoch.value++
}

/**
 * Starts listening for announcements and asks every wallet to announce.
 * Idempotent; called on first use, and harmless to call again (a second
 * request only makes wallets re-announce).
 */
export function discoverInjectedWallets(): void {
    if (typeof window === 'undefined') return
    if (!listening) {
        window.addEventListener('eip6963:announceProvider', onAnnounce)
        listening = true
    }
    window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Identity flags, most specific first. Core must precede MetaMask. */
const FLAG_NAMES: [flag: string, name: string][] = [
    ['isAvalanche', 'Core'],
    ['isCore', 'Core'],
    ['isRabby', 'Rabby'],
    ['isBraveWallet', 'Brave Wallet'],
    ['isCoinbaseWallet', 'Coinbase Wallet'],
    ['isPhantom', 'Phantom'],
    ['isTrust', 'Trust Wallet'],
    ['isOkxWallet', 'OKX Wallet'],
    ['isFrame', 'Frame'],
    ['isMetaMask', 'MetaMask'],
]

/** A name fit for a small badge: trimmed, bounded, and plain text. */
function clean(name: unknown): string | null {
    if (typeof name !== 'string') return null
    const s = name.replace(/\s+/g, ' ').trim()
    return s ? s.slice(0, 24) : null
}

/**
 * The extension's name for `provider`, or null when it cannot be told.
 * Reactive — see the module doc.
 */
export function injectedWalletName(provider: unknown): string | null {
    void walletEpoch.value
    if (!provider || typeof provider !== 'object') return null
    if (!listening) discoverInjectedWallets()

    const fromAnnouncement = clean(announced.get(provider)?.name)
    if (fromAnnouncement) return fromAnnouncement

    const p = provider as Record<string, unknown>
    for (const [flag, name] of FLAG_NAMES) {
        if (p[flag] === true) return name
    }
    return null
}

// ─── Account names (Core) ──────────────────────────────────────────────────

export interface InjectedAccountName {
    /** The account's name in the extension, e.g. "Account 1". */
    name: string
    /** The extension wallet (seed phrase, ledger, …) it belongs to, e.g. "Seed Phrase 1". */
    walletName: string | null
}

/**
 * Per provider, per lowercased address: the name, null when the extension has
 * no name for it, or 'pending' while asking. Read once per address per page
 * load: a rename inside Core shows after a reload. `accountEpoch` makes a
 * computed that read a pending entry re-run when it resolves.
 */
const accountNames = new WeakMap<object, Record<string, InjectedAccountName | null | 'pending'>>()
const accountEpoch = ref(0)

/** Whether `provider` is Core, the one extension with `avalanche_getAccounts`. */
function isCore(provider: object): boolean {
    const p = provider as Record<string, unknown>
    if (p.isAvalanche === true || p.isCore === true) return true
    const info = announced.get(provider)
    return /core/i.test(String(info?.rdns ?? '')) || info?.name === 'Core'
}

async function fetchAccountName(provider: any, address: string): Promise<InjectedAccountName | null> {
    const accounts: any[] = await provider.request({ method: 'avalanche_getAccounts', params: [] })
    // Matched by address, never by `active`: the active account can differ
    // from the one this dapp is connected to, and showing another account's
    // name on this wallet would be exactly the confusion the badge is for.
    const match = (Array.isArray(accounts) ? accounts : []).find(
        (a) => typeof a?.addressC === 'string' && a.addressC.toLowerCase() === address
    )
    const name = clean(match?.name)
    return name ? { name, walletName: clean(match?.walletName) } : null
}

/**
 * The connected account's name in the extension, or null (not Core, not
 * found, or still being asked). Starts the lookup on first use; reactive, so
 * a badge that asked early fills in once the answer arrives.
 */
export function injectedAccountName(provider: unknown, address: string | null | undefined): InjectedAccountName | null {
    void accountEpoch.value
    if (!provider || typeof provider !== 'object' || !address) return null
    if (!isCore(provider)) return null

    const key = (address.startsWith('0x') ? address : '0x' + address).toLowerCase()
    let byAddress = accountNames.get(provider)
    if (!byAddress) {
        byAddress = {}
        accountNames.set(provider, byAddress)
    }
    const known = byAddress[key]
    if (known === 'pending') return null
    if (known !== undefined) return known

    byAddress[key] = 'pending'
    fetchAccountName(provider, key)
        .catch((e) => {
            console.warn('[injectedWalletName] Could not read the account name:', e)
            return null
        })
        .then((result) => {
            byAddress![key] = result
            accountEpoch.value++
        })
    return null
}
