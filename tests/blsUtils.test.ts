/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Validator BLS keys: checking a node's proof of possession the way the
 * P-Chain does, and reading it from a pasted info.getNodeID response.
 *
 * The fixtures are real: the BLS keys and proofs two mainnet validators
 * registered (platform.getCurrentValidators → signer, 2026-10-19), which
 * avalanchego verified when it accepted them.
 */
import { parseNodeInfo, toHex0x, validateBlsPublicKey, validateBlsSignature, verifyProofOfPossession } from '@/helpers/bls_utils'

const A = {
    nodeID: 'NodeID-DwXjtHUrtuxdhekzCzHdEaoXHmFHRNLSF',
    publicKey: '0x844ed52036683dd7513a0577782d60c6719c75aa66793dcd6bd61b611b44369a911cb1cb04355da0e6547760396ea84e',
    proofOfPossession:
        '0xb5a9819936b4d55070cff2e600b86a2b2136e9b792986dde16314933483bbbdebe5f48572a9efc1c13ab2db67e4d29281657f01f9aafb2c5268c42f9381ff3235dbbc736c7fad89e41fcaf328e2876cfa80cc98029751817024629387b009a1f',
}
const B = {
    publicKey: '0xa0c2d86059089d48fc0d9de0acac5a718a370068a78ec6e95911ca3416f0024f01623cdbab1c226fe381cea49ecf8777',
    proofOfPossession:
        '0x86cdfddfaa6702f31a040fc975cbd4aa286375c6ed0dfee4142c6af92b5e1fc0c182994270b36cdc5ed9b8a2b0c90a6c03219cba3c5359d50103bf946ea929d09b99d0def68834834272c9ec0cf58b0c1fa4c34acf4782dc789eac0c327e4f7f',
}

describe('proof of possession', () => {
    it('accepts the keys and proofs mainnet validators registered', () => {
        expect(verifyProofOfPossession(A.publicKey, A.proofOfPossession)).toBe(true)
        expect(verifyProofOfPossession(B.publicKey, B.proofOfPossession)).toBe(true)
    })

    it('rejects a proof made for a different key', () => {
        expect(verifyProofOfPossession(A.publicKey, B.proofOfPossession)).toBe(false)
        expect(verifyProofOfPossession(B.publicKey, A.proofOfPossession)).toBe(false)
    })

    it('rejects a key or proof with one character changed', () => {
        const typoKey = A.publicKey.slice(0, -1) + (A.publicKey.endsWith('e') ? 'f' : 'e')
        const typoPop = A.proofOfPossession.slice(0, -1) + (A.proofOfPossession.endsWith('f') ? 'e' : 'f')
        expect(verifyProofOfPossession(typoKey, A.proofOfPossession)).toBe(false)
        expect(verifyProofOfPossession(A.publicKey, typoPop)).toBe(false)
    })

    it('rejects malformed input without throwing', () => {
        expect(verifyProofOfPossession('0x1234', A.proofOfPossession)).toBe(false)
        expect(verifyProofOfPossession(A.publicKey, 'not hex')).toBe(false)
        expect(verifyProofOfPossession('', '')).toBe(false)
    })

    it('checks lengths, with or without 0x', () => {
        expect(validateBlsPublicKey(A.publicKey)).toBe(true)
        expect(validateBlsPublicKey(A.publicKey.slice(2))).toBe(true)
        expect(validateBlsPublicKey(A.publicKey + '00')).toBe(false)
        expect(validateBlsSignature(A.proofOfPossession)).toBe(true)
        expect(validateBlsSignature(A.publicKey)).toBe(false)
        expect(toHex0x(' 0XABCD ')).toBe('0xabcd')
    })
})

describe('reading info.getNodeID', () => {
    const result = { nodeID: A.nodeID, nodePOP: { publicKey: A.publicKey, proofOfPossession: A.proofOfPossession } }

    it('takes the full JSON-RPC reply, its result, or just nodePOP', () => {
        expect(parseNodeInfo(JSON.stringify({ jsonrpc: '2.0', id: 1, result }))).toEqual(A)
        expect(parseNodeInfo(JSON.stringify(result))).toEqual(A)
        expect(parseNodeInfo(JSON.stringify(result.nodePOP))).toEqual({ ...A, nodeID: '' })
    })

    it('normalises the hex it reads', () => {
        const upper = { nodePOP: { publicKey: A.publicKey.slice(2).toUpperCase(), proofOfPossession: A.proofOfPossession } }
        expect(parseNodeInfo(JSON.stringify(upper))!.publicKey).toBe(A.publicKey)
    })

    it('returns null for anything else', () => {
        expect(parseNodeInfo('hello')).toBeNull()
        expect(parseNodeInfo(JSON.stringify({ result: { nodeID: A.nodeID } }))).toBeNull()
    })
})
