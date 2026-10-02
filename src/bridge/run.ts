/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Running a bridge transfer from the UI: the provider's `execute` / `claim`
 * inside one authorization scope for the wallet that signs, with the result
 * saved to the transfer history so it can be tracked (and claimed) later —
 * even after a reload.
 */
import { authorizeBatch } from '@/js/security/authorize'
import { useOfflineSigningStore } from '@/stores'
import { getBridgeChain } from './chains'
import { saveTransfer } from './history'
import { getProvider } from './registry'
import { walletSigners } from './signers'
import type { BridgeChain, BridgeProgress, BridgeQuote, BridgeTransfer } from './types'

/** What the authorization prompt is about for the wallet signing on `chain`. */
function authSubjectFor(chain: BridgeChain): unknown {
    if (chain.kind === 'evm') {
        const s = walletSigners.evm(chain)
        if (!s) throw new Error(`Connect a wallet on ${chain.name} first.`)
        return s.authSubject
    }
    const w = chain.kind === 'solana' ? walletSigners.solana(chain) : walletSigners.bitcoin(chain)
    if (!w) throw new Error(`Connect a ${chain.name} wallet first.`)
    if (w.isReadonly) throw new Error(`This ${chain.name} wallet is watch-only and cannot sign.`)
    return w
}

/** Bridges need every step broadcast — a signed-only export cannot be resumed. */
function assertOnline(): void {
    if (useOfflineSigningStore().isActive) {
        throw new Error('Bridging needs each transaction broadcast. Turn off offline signing to bridge.')
    }
}

/** Sends `quote` and records it. */
export async function runTransfer(quote: BridgeQuote, onProgress?: BridgeProgress): Promise<BridgeTransfer> {
    assertOnline()
    const provider = getProvider(quote.providerId)
    const src = getBridgeChain(quote.request.from.chainId)
    if (!provider || !src) throw new Error('This route is no longer available.')
    const reason = `Bridge ${quote.request.from.symbol} from ${src.name} to ${quote.request.toChain.name}`
    const transfer = await authorizeBatch(authSubjectFor(src), reason, () =>
        provider.execute(quote, walletSigners, onProgress)
    )
    saveTransfer(transfer)
    return transfer
}

/** Claims a `ready_to_claim` transfer on its destination chain. */
export async function runClaim(transfer: BridgeTransfer, onProgress?: BridgeProgress): Promise<BridgeTransfer> {
    assertOnline()
    const provider = getProvider(transfer.providerId)
    const dst = getBridgeChain(transfer.toChainId)
    if (!provider?.claim || !dst) throw new Error('This transfer cannot be claimed from the wallet.')
    const updated = await authorizeBatch(authSubjectFor(dst), `Claim ${transfer.toSymbol} on ${dst.name}`, () =>
        provider.claim!(transfer, walletSigners, onProgress)
    )
    saveTransfer(updated)
    return updated
}

/** Re-reads a transfer's status and saves it. */
export async function refreshTransfer(transfer: BridgeTransfer): Promise<BridgeTransfer> {
    const provider = getProvider(transfer.providerId)
    if (!provider) return transfer
    const updated = await provider.refresh(transfer)
    saveTransfer(updated)
    return updated
}

/** Whether a transfer still has something to wait for. */
export function isPending(t: BridgeTransfer): boolean {
    return t.status === 'in_transit' || t.status === 'ready_to_claim'
}
