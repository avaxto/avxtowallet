/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import bs58 from 'bs58'

import { decodeSolanaPublicKey } from '@/solana/decodePublicKey'

// USDC's real Solana mint address — a fixed, well-known 32-byte public key,
// used purely as a stable input; nothing about the decode depends on the
// address being a real mint.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('decodeSolanaPublicKey', () => {
    it('is deterministic', () => {
        expect(decodeSolanaPublicKey(USDC_MINT)).toEqual(decodeSolanaPublicKey(USDC_MINT))
    })

    it('decodes to exactly 32 bytes, hex-encoded and 0x-prefixed', () => {
        const { publicKeyHex } = decodeSolanaPublicKey(USDC_MINT)
        expect(publicKeyHex).toMatch(/^0x[0-9a-f]{64}$/)
    })

    it('matches a direct base58 decode of the same address', () => {
        const { publicKeyHex } = decodeSolanaPublicKey(USDC_MINT)
        expect(publicKeyHex.slice(2)).toBe(Buffer.from(bs58.decode(USDC_MINT)).toString('hex'))
    })

    it('trims surrounding whitespace and echoes the trimmed address back', () => {
        const { solanaAddress } = decodeSolanaPublicKey(`  ${USDC_MINT}  `)
        expect(solanaAddress).toBe(USDC_MINT)
    })

    it('rejects empty input', () => {
        expect(() => decodeSolanaPublicKey('')).toThrow(/enter/i)
        expect(() => decodeSolanaPublicKey('   ')).toThrow(/enter/i)
    })

    it('rejects non-base58 input', () => {
        expect(() => decodeSolanaPublicKey('not-base-58-!!!')).toThrow(/base58/i)
    })

    it('rejects a decoded length other than 32 bytes, naming the actual length', () => {
        // An EVM address (20 bytes) re-encoded as base58 — a plausible paste
        // mistake, and wrong for a different reason than garbage input.
        const twentyBytes = bs58.encode(Buffer.alloc(20, 1))
        expect(() => decodeSolanaPublicKey(twentyBytes)).toThrow(/20/)
    })

    it('does not produce anything address-shaped for another chain', () => {
        // Pins the removal this module exists to document: the result has
        // exactly the public key, nothing derived from it.
        const result = decodeSolanaPublicKey(USDC_MINT)
        expect(Object.keys(result).sort()).toEqual(['publicKeyHex', 'solanaAddress'])
    })
})
