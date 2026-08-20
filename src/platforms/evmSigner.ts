/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * How an EVM feature gets a signer without knowing which platform is active.
 *
 * This is the whole point of `Platform.getEvmSigner`: the token launcher and
 * the swap ask here, get back something bound to the connected wallet and its
 * chain, and never mention Avalanche, Robinhood or Ethereum. A platform with no
 * EVM chain (Bitcoin, Solana) simply does not implement it, and those features
 * disable themselves — no feature component tests a platform id.
 *
 * Lives under `platforms/` rather than `evm/` on purpose: this is the one file
 * that knows both worlds exist, and putting it in `evm/` would make that folder
 * depend on the platform layer that already depends on it.
 */
import { useActivePlatformStore } from './store'
import type { EvmSigner } from '@/evm/signer'

/**
 * A signer for the active platform's connected wallet, or null.
 *
 * Null means one of three things the caller does not need to distinguish: no
 * platform selected, no wallet connected, or a platform with no EVM chain. All
 * three mean the same thing to a feature — there is nothing to sign with.
 *
 * **Call this once at the top of a flow and thread the result through.** It
 * resolves against live store state, so calling it again mid-flow can hand back
 * a signer for a different chain than the one a quote was priced against. See
 * the invariant in `@/evm/signer`.
 */
export function activeEvmSigner(): EvmSigner | null {
    return useActivePlatformStore().activePlatform?.getEvmSigner?.() ?? null
}

/** Same, but throws with a message worth showing when there is no signer. */
export function requireEvmSigner(): EvmSigner {
    const signer = activeEvmSigner()
    if (!signer) {
        throw new Error(
            'No EVM wallet is connected. Connect a wallet on a platform with an EVM chain and try again.'
        )
    }
    return signer
}
