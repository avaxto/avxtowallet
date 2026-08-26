/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Decodes a Solana address into its raw ed25519 public key bytes.
 *
 * A Solana address IS a base58 encoding of a raw 32-byte ed25519 public key —
 * there is no separate hashing step the way there is for, say, an EVM address
 * from a secp256k1 key. So "decoding" is just base58 decode plus a length
 * check; this module exists to give that check a proper user-facing error
 * rather than leaving it inline in a view.
 *
 * Deliberately does NOT derive anything from the decoded bytes — earlier code
 * here fed them into a keccak256-and-truncate step to produce something
 * EVM-address-shaped, which was removed: ed25519 and secp256k1 are unrelated
 * curves, so that value was never a real, signable EVM address, only
 * something that looked like one. See git history for the removed
 * `toEvmAddress.ts` if that context is ever needed again.
 */
import bs58 from 'bs58'

export interface SolanaPublicKeyDecode {
    /** The input, trimmed. */
    solanaAddress: string
    /** The decoded 32-byte ed25519 public key, as 0x-prefixed hex. */
    publicKeyHex: string
}

/**
 * Decodes a base58 Solana address to its raw public key bytes.
 *
 * Throws with a specific, user-facing message when the input isn't valid
 * base58, or doesn't decode to 32 bytes — the exact length every real Solana
 * address has.
 */
export function decodeSolanaPublicKey(address: string): SolanaPublicKeyDecode {
    const trimmed = address.trim()
    if (!trimmed) {
        throw new Error('Enter a Solana address.')
    }

    let raw: Uint8Array
    try {
        raw = bs58.decode(trimmed)
    } catch {
        throw new Error('That is not valid base58.')
    }

    if (raw.length !== 32) {
        throw new Error(
            `A Solana address decodes to 32 bytes; this decoded to ${raw.length}. ` +
                'Check that the whole address was pasted.'
        )
    }

    return {
        solanaAddress: trimmed,
        publicKeyHex: '0x' + Buffer.from(raw).toString('hex'),
    }
}
