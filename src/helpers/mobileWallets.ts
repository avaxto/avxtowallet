/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wallet apps on phones.
 *
 * A phone's normal browser (Chrome on Android, Safari on iOS) runs no wallet
 * extensions: MetaMask, Rabby, Phantom and the rest are separate apps there,
 * and they only inject a wallet (`window.ethereum`, …) into pages opened inside
 * their OWN in-app browser. So on a phone "no extension found" is not "you have
 * no wallet" — it is "you are in the wrong browser". These helpers spot that
 * case and build the links that reopen this page inside a wallet app.
 *
 * Only wallets with a documented "open this URL in the app's browser" link are
 * listed; for the rest (Rabby, Core, …) the page shows the address to paste
 * into the app's browser instead.
 */

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i

/** A phone or tablet browser, judged by its user agent. */
export function isMobileBrowser(userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): boolean {
    return MOBILE_UA.test(userAgent)
}

/** Whether any wallet has injected itself into this page (EVM, Core, or Solana). */
export function hasInjectedWallet(win: any = typeof window !== 'undefined' ? window : {}): boolean {
    return !!(win.ethereum || win.avalanche || win.phantom?.solana || win.solana)
}

/** On a phone, with no wallet injected: the case the "open in your wallet app" help is for. */
export function needsWalletAppBrowser(): boolean {
    return isMobileBrowser() && !hasInjectedWallet()
}

export interface WalletAppLink {
    name: string
    href: string
}

/**
 * Links that open `pageUrl` inside each wallet app's own browser, where its
 * wallet is injected. Formats are each vendor's documented deep link.
 */
export function walletAppLinks(pageUrl: string): WalletAppLink[] {
    const url = new URL(pageUrl)
    const enc = encodeURIComponent(url.href)
    const withoutScheme = url.href.replace(/^https?:\/\//, '')
    return [
        { name: 'MetaMask', href: `https://metamask.app.link/dapp/${withoutScheme}` },
        { name: 'Phantom', href: `https://phantom.app/ul/browse/${enc}?ref=${encodeURIComponent(url.origin)}` },
        { name: 'Coinbase Wallet', href: `https://go.cb-w.com/dapp?cb_url=${enc}` },
        { name: 'Trust Wallet', href: `https://link.trustwallet.com/open_url?coin_id=60&url=${enc}` },
    ]
}
