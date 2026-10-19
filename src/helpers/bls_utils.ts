/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * BLS keys for Primary Network validators (ACP-62).
 *
 * A validator registers its node's BLS public key and a proof of possession
 * (PoP) — a BLS signature over that key, made with the node's own BLS secret
 * key (its `signer.key`). Both come from the node itself, via
 * `info.getNodeID` (`nodePOP.publicKey`, `nodePOP.proofOfPossession`). The
 * wallet never makes BLS keys: a key the node doesn't hold is useless to the
 * validator (an earlier version of this file generated fake ones).
 *
 * What the wallet can do is check the pair before spending a stake on it:
 * `verifyProofOfPossession` runs the same check avalanchego runs (min-pk BLS12-381,
 * the PoP ciphersuite) — verified against real mainnet validators' registered
 * keys in tests/blsUtils.test.ts.
 */
import { bls12_381 as bls } from '@noble/curves/bls12-381'

export const PRIMARY_NETWORK_ID = '11111111111111111111111111111111LpoYY'

/** avalanchego's proof-of-possession domain separation tag (utils/crypto/bls). */
const POP_DST = 'BLS_POP_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_'

export const BLS_ERRORS = {
    INVALID_PUBLIC_KEY: 'Invalid BLS public key. It must be 48 bytes (96 hex characters).',
    INVALID_SIGNATURE: 'Invalid proof of possession. It must be 96 bytes (192 hex characters).',
    MISSING_BLS_DATA: 'The node’s BLS public key and proof of possession are required to register a validator (ACP-62).',
    POP_MISMATCH:
        'The proof of possession does not match the BLS public key. Copy both from the same info.getNodeID response of your node.',
}

const strip = (h: string) => h.trim().replace(/^0x/i, '')
const isHex = (h: string, bytes: number) => new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(strip(h))

/** A 48-byte hex BLS public key (with or without 0x). */
export function validateBlsPublicKey(publicKey: string): boolean {
    return isHex(publicKey, 48)
}

/** A 96-byte hex BLS signature / proof of possession (with or without 0x). */
export function validateBlsSignature(signature: string): boolean {
    return isHex(signature, 96)
}

/** Normalises to 0x-prefixed lowercase hex. */
export function toHex0x(h: string): string {
    return '0x' + strip(h).toLowerCase()
}

const bytes = (h: string) => Uint8Array.from(strip(h).match(/../g)!.map((b) => parseInt(b, 16)))

/**
 * Whether `proofOfPossession` is a valid PoP for `publicKey` — the check the
 * P-Chain makes before accepting an AddPermissionlessValidatorTx. False for
 * malformed input, never throws.
 */
export function verifyProofOfPossession(publicKey: string, proofOfPossession: string): boolean {
    if (!validateBlsPublicKey(publicKey) || !validateBlsSignature(proofOfPossession)) return false
    try {
        const pk = bytes(publicKey)
        return bls.verify(bytes(proofOfPossession), pk, pk, { DST: POP_DST })
    } catch {
        return false
    }
}

export interface NodeInfo {
    nodeID: string
    publicKey: string
    proofOfPossession: string
}

/**
 * Reads what a validator needs out of a pasted `info.getNodeID` response: the
 * full JSON-RPC reply, just its `result`, or the `nodePOP` object. Returns null
 * when it isn't one.
 */
export function parseNodeInfo(text: string): NodeInfo | null {
    let j: any
    try {
        j = JSON.parse(text.trim())
    } catch {
        return null
    }
    const r = j?.result ?? j
    const pop = r?.nodePOP ?? r
    const nodeID = typeof r?.nodeID === 'string' ? r.nodeID : ''
    const publicKey = pop?.publicKey
    const proofOfPossession = pop?.proofOfPossession
    if (typeof publicKey !== 'string' || typeof proofOfPossession !== 'string') return null
    return { nodeID, publicKey: toHex0x(publicKey), proofOfPossession: toHex0x(proofOfPossession) }
}
