/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Detecting an injected Solana wallet extension.
 *
 * Solana has no EIP-1193 equivalent that everyone implements, so this targets
 * the de-facto interface Phantom established and Solflare/Backpack copied:
 * `connect`, `disconnect`, `signMessage`, `signAndSendTransaction` on an object
 * hanging off `window`.
 *
 * Note `window.solana` is NOT reliably Phantom — several wallets claim it, and
 * whichever loaded last wins. The namespaced `window.phantom.solana` /
 * `window.solflare` handles are checked first so a user with two extensions
 * installed gets a predictable one rather than a race.
 */
import type { Transaction } from '@solana/web3.js'
import { detectStandardSolanaProvider } from './walletStandard'

export interface SolanaProvider {
    isPhantom?: boolean
    isSolflare?: boolean
    publicKey?: { toString(): string } | null
    isConnected?: boolean

    connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>
    disconnect(): Promise<void>

    /**
     * Signs raw bytes. Phantom's second argument selects how it decodes the
     * payload for display; 'utf8' makes a text message render as text in the
     * approval popup rather than as a hex blob.
     */
    signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>

    signAndSendTransaction(transaction: Transaction): Promise<{ signature: string }>

    on?(event: string, handler: (...args: any[]) => void): void
    removeListener?(event: string, handler: (...args: any[]) => void): void
}

export interface DetectedProvider {
    provider: SolanaProvider
    /** Best-effort display name for error messages and the connect button. */
    name: string
}

function looksLikeProvider(candidate: any): candidate is SolanaProvider {
    return (
        !!candidate &&
        typeof candidate.connect === 'function' &&
        typeof candidate.signAndSendTransaction === 'function'
    )
}

/**
 * The injected wallet to use, or null when none is installed.
 *
 * Two discovery mechanisms, tried in order. The namespaced `window.*` handles
 * first — the de-facto interface Phantom established, still what Phantom,
 * Solflare and Backpack claim, checked most-specific first so a user with two
 * such extensions installed gets a predictable one rather than a race. The
 * Wallet Standard second, for wallets that never touch those globals at all —
 * Core is the reason this exists: it registers its Solana wallet through that
 * protocol instead (see the note at the top of ./walletStandard.ts). Trying
 * the legacy handles first is deliberate, not arbitrary: they're a direct
 * property read, while the Wallet Standard path dispatches a DOM event to
 * every listener on the page, so there's no reason to pay that cost when the
 * cheap check already found something.
 */
export function detectSolanaProvider(): DetectedProvider | null {
    const w = window as any

    const candidates: { provider: any; name: string }[] = [
        { provider: w.phantom?.solana, name: 'Phantom' },
        { provider: w.solflare, name: 'Solflare' },
        { provider: w.backpack, name: 'Backpack' },
        { provider: w.solana, name: nameForGeneric(w.solana) },
    ]

    for (const { provider, name } of candidates) {
        if (looksLikeProvider(provider)) return { provider, name }
    }

    return detectStandardSolanaProvider()
}

function nameForGeneric(provider: any): string {
    if (provider?.isPhantom) return 'Phantom'
    if (provider?.isSolflare) return 'Solflare'
    return 'your Solana wallet'
}

/** Throws a message naming what to install, rather than a generic null deref. */
export function requireSolanaProvider(): DetectedProvider {
    const detected = detectSolanaProvider()
    if (!detected) {
        throw new Error(
            'No Solana wallet extension found. Install Phantom or Solflare, or import ' +
                'a recovery phrase / private key instead.'
        )
    }
    return detected
}
