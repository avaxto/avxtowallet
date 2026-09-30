/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Restores who signs each input of a C-Chain ExportTx after a bytes round trip.
 *
 * AbstractWallet.exportFromCChain builds the export with the new Avalanche SDK,
 * then re-parses its bytes into an AvalancheJS `EVMUnsignedTx` so the wallets'
 * existing `signC` can sign it. The catch: an `EVMInput`'s signature indices —
 * which key signs it — are not part of the serialized transaction, so
 * `EVMInput.fromBuffer` leaves them empty. `ExportTx.sign` then emits a
 * credential with no signatures and the node rejects the export with
 * "credential verification: incorrect number of signatures (0): want 1, got 0".
 *
 * Only inputs spent from `evmHexAddress` (the wallet's own EVM address) with no
 * signer yet are touched; each gets the wallet's C-Chain key as its signer,
 * which is what `signC`'s keychain holds. Anything else is left alone, so a
 * foreign input still fails loudly instead of being signed for.
 */
import { bintools } from '@/AVA'
import { ExportTx as EVMExportTx } from '@/avalanche/apis/evm/exporttx'
import { UnsignedTx as EVMUnsignedTx } from '@/avalanche/apis/evm/tx'
import { EVMInput } from '@/avalanche/apis/evm/inputs'

/**
 * @param evmHexAddress the wallet's EVM address, with or without 0x
 * @param signerBech32 the same key's C-Chain bech32 address, e.g. "C-avax1…"
 * @returns how many inputs were given a signer
 */
export function restoreEvmExportSigners(
    unsignedTx: EVMUnsignedTx,
    evmHexAddress: string,
    signerBech32: string
): number {
    const tx = unsignedTx.getTransaction() as EVMExportTx
    if (typeof (tx as any).getInputs !== 'function') return 0

    const own = evmHexAddress.toLowerCase().replace(/^0x/, '')
    const signer = bintools.stringToAddress(signerBech32)
    let restored = 0
    for (const input of tx.getInputs() as EVMInput[]) {
        if (input.getSigIdxs().length > 0) continue
        if (input.getAddressString().toLowerCase() !== own) continue
        input.addSignatureIdx(0, signer)
        restored++
    }
    return restored
}
