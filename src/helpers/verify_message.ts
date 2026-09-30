/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Message-signature verification for the Advanced page.
 *
 * Avalanche message signatures are recoverable: from the message and the
 * signature alone you get back the public key, hence the address, that signed.
 * That is also the trap — ANY well-formed signature recovers SOME address, even
 * one made over a different message or by someone else. So "a signature
 * recovered" is not "this person signed it". Only comparing the recovered
 * address to the one you expected proves who signed; `signerMatches` does that.
 */
import { KeyPair } from '@/avalanche/apis/avm'
import { bintools } from '@/AVA'
import { Buffer } from '@/avalanche'
import { getPreferredHRP } from '@/avalanche/utils'
import { digestMessage } from '@/helpers/helper'

export interface RecoveredSigner {
    addressX: string
    addressP: string
    /** The bech32 part both share, e.g. "avax1…". */
    bare: string
}

/** The address that produced `signature` (cb58) over `message`. Throws on a malformed signature. */
export function recoverSigner(message: string, signature: string, networkId: number): RecoveredSigner {
    const digest = digestMessage(message)
    const digestBuff = Buffer.from(digest.toString('hex'), 'hex')
    const hrp = getPreferredHRP(networkId)
    const keypair = new KeyPair(hrp, 'X')

    const signedBuff = bintools.cb58Decode(signature.trim())
    const pubKey = keypair.recover(digestBuff, signedBuff)
    const addressBuff = KeyPair.addressFromPublicKey(pubKey)

    const addressX = bintools.addressToString(hrp, 'X', addressBuff)
    return {
        addressX,
        addressP: bintools.addressToString(hrp, 'P', addressBuff),
        bare: addressX.slice(2),
    }
}

const bare = (address: string) => {
    const a = address.trim().toLowerCase()
    return /^[xpc]-/.test(a) ? a.slice(2) : a
}

/**
 * Whether `expected` is the signer. X- and P- forms of one key are the same
 * signer, so the chain prefix is ignored; so is case (bech32 is case-insensitive).
 */
export function signerMatches(expected: string, signer: RecoveredSigner): boolean {
    return !!expected.trim() && bare(expected) === signer.bare.toLowerCase()
}
