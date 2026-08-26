/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana key derivation and private-key parsing.
 *
 * The SLIP-0010 vectors below are the official ones from the spec, checked via
 * the derived PUBLIC key and chain code rather than the private key: those two
 * together pin the HMAC output exactly, and the public key is what an address
 * is actually built from, so a passing test proves the derived account is the
 * one other wallets would show.
 */
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

import {
    DEFAULT_SOLANA_PATH,
    LEDGER_PATH,
    PHANTOM_PATH,
    addressFromSeed,
    deriveEd25519Node,
    deriveSolanaAddress,
    destroySolanaKeypair,
    isValidSolanaAddress,
    parseDerivationPath,
    parseSolanaSecretKey,
} from '@/solana/keys'

const hex = (u8: Uint8Array): string => Buffer.from(u8).toString('hex')
const fromHex = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, 'hex'))

// SLIP-0010 test vector 1 (ed25519), seed 000102030405060708090a0b0c0d0e0f.
const VECTOR_1_SEED = fromHex('000102030405060708090a0b0c0d0e0f')
const VECTOR_1: { path: string; chainCode: string; publicKey: string }[] = [
    {
        path: 'm',
        chainCode: '90046a93de5380a72b5e45010748567d5ea02bbf6522f979e05c0d8d8ca9fffb',
        publicKey: 'a4b2856bfec510abab89753fac1ac0e1112364e7d250545963f135f2a33188ed',
    },
    {
        path: "m/0'",
        chainCode: '8b59aa11380b624e81507a27fedda59fea6d0b779a778918a2fd3590e16e9c69',
        publicKey: '8c8a13df77a28f3445213a0f432fde644acaa215fc72dcdf300d5efaa85d350c',
    },
    {
        path: "m/0'/1'",
        chainCode: 'a320425f77d1b5c2505a6b1b27382b37368ee640e3557c315416801243552f14',
        publicKey: '1932a5270f335bed617d5b935c80aedb1a35bd9fc1e31acafd5372c30f5c1187',
    },
    {
        path: "m/0'/1'/2'/2'",
        chainCode: '8f6d87f93d750e0efccda017d662a1b31a266e4a6f5993b15f5c1f07f74dd5cc',
        publicKey: '8abae2d66361c879b900d204ad2cc4984fa2aa344dd7ddc46007329ac76c429c',
    },
    {
        path: "m/0'/1'/2'/2'/1000000000'",
        chainCode: '68789923a0cac2cd5a29172a475fe9e0fb14cd6adb5ad98a3fa70333e7afa230',
        publicKey: '3c24da049451555d51a7014a37337aa4e12d41e485abccfa46b47dfb2af54b7a',
    },
]

describe('SLIP-0010 ed25519 derivation', () => {
    it.each(VECTOR_1)('matches the spec at $path', async ({ path, chainCode, publicKey }) => {
        const node = await deriveEd25519Node(VECTOR_1_SEED, path)
        expect(hex(node.chainCode)).toBe(chainCode)
        expect(hex(ed25519.getPublicKey(node.key))).toBe(publicKey)
    })

    it('derives a stable, valid address for a Solana path', async () => {
        const address = await deriveSolanaAddress(VECTOR_1_SEED, DEFAULT_SOLANA_PATH)
        expect(isValidSolanaAddress(address)).toBe(true)
        // Deterministic: the same seed and path always give the same account.
        await expect(deriveSolanaAddress(VECTOR_1_SEED, DEFAULT_SOLANA_PATH)).resolves.toBe(
            address
        )
    })

    it('gives different accounts for the two path conventions', async () => {
        // The whole reason discovery.ts probes both — if these collided there
        // would be nothing to disambiguate.
        const phantom = await deriveSolanaAddress(VECTOR_1_SEED, PHANTOM_PATH(0))
        const ledger = await deriveSolanaAddress(VECTOR_1_SEED, LEDGER_PATH(0))
        expect(phantom).not.toBe(ledger)
    })

    it('gives different accounts per account index', async () => {
        const a0 = await deriveSolanaAddress(VECTOR_1_SEED, PHANTOM_PATH(0))
        const a1 = await deriveSolanaAddress(VECTOR_1_SEED, PHANTOM_PATH(1))
        expect(a0).not.toBe(a1)
    })
})

describe('parseDerivationPath', () => {
    it('hardens every index', () => {
        expect(parseDerivationPath("m/44'/501'/0'/0'")).toEqual([
            44 + 0x80000000,
            501 + 0x80000000,
            0 + 0x80000000,
            0 + 0x80000000,
        ])
    })

    it('accepts a bare master path', () => {
        expect(parseDerivationPath('m')).toEqual([])
    })

    it('rejects an unhardened segment rather than silently hardening it', () => {
        // Silently hardening would derive a DIFFERENT account and show the
        // user an empty wallet with no explanation.
        expect(() => parseDerivationPath("m/44'/501'/0'/0")).toThrow(/unhardened/i)
    })

    it('rejects malformed paths', () => {
        expect(() => parseDerivationPath("44'/501'")).toThrow(/malformed/i)
        expect(() => parseDerivationPath("m/abc'")).toThrow(/malformed/i)
    })
})

describe('parseSolanaSecretKey', () => {
    // A deterministic 32-byte seed and the 64-byte secret key built from it.
    const seed = new Uint8Array(32).fill(7)
    const publicKey = ed25519.getPublicKey(seed)
    const secret64 = new Uint8Array(64)
    secret64.set(seed, 0)
    secret64.set(publicKey, 32)

    it('accepts a base58 64-byte secret key and returns the seed half', () => {
        const parsed = parseSolanaSecretKey(bs58.encode(secret64))
        expect(hex(parsed)).toBe(hex(seed))
        expect(addressFromSeed(parsed)).toBe(bs58.encode(publicKey))
    })

    it('accepts a bare 32-byte seed', () => {
        expect(hex(parseSolanaSecretKey(bs58.encode(seed)))).toBe(hex(seed))
    })

    it('accepts a solana-keygen JSON byte array', () => {
        const parsed = parseSolanaSecretKey(JSON.stringify(Array.from(secret64)))
        expect(hex(parsed)).toBe(hex(seed))
    })

    it('rejects a 64-byte key whose halves disagree', () => {
        // The public half is what tells us the key was copied intact. Trusting
        // the seed half regardless would open a wallet at an address the user
        // never expected.
        const tampered = new Uint8Array(secret64)
        tampered[40] ^= 0xff
        expect(() => parseSolanaSecretKey(bs58.encode(tampered))).toThrow(/inconsistent/i)
    })

    it('rejects a wrong-length key with a length-specific message', () => {
        expect(() => parseSolanaSecretKey(bs58.encode(new Uint8Array(48)))).toThrow(/48/)
    })

    it('rejects unparseable input', () => {
        expect(() => parseSolanaSecretKey('not base58 !!!')).toThrow()
        expect(() => parseSolanaSecretKey('[1,2,notanumber]')).toThrow()
    })
})

describe('destroySolanaKeypair', () => {
    it('erases the key material the public getter would keep handing out', () => {
        const kp = Keypair.fromSeed(new Uint8Array(32).fill(7))
        expect(Array.from(kp.secretKey).some((b) => b !== 0)).toBe(true)

        destroySolanaKeypair(kp)

        expect(Array.from(kp.secretKey).every((b) => b === 0)).toBe(true)
    })

    it('is not satisfied by wiping the public secretKey getter', () => {
        // Pins the reason destroySolanaKeypair exists: web3.js returns a FRESH
        // COPY from `secretKey` on every access, so the obvious
        // `wipe(kp.secretKey)` zeroes a throwaway and leaves the real key live.
        // If a future web3.js made the getter return the internal array, this
        // test would fail and the helper could be simplified.
        const kp = Keypair.fromSeed(new Uint8Array(32).fill(9))
        expect(kp.secretKey).not.toBe(kp.secretKey)

        kp.secretKey.fill(0)
        expect(Array.from(kp.secretKey).every((b) => b === 0)).toBe(false)
    })

    it('tolerates null and unrelated objects', () => {
        expect(() => destroySolanaKeypair(null)).not.toThrow()
        expect(() => destroySolanaKeypair({})).not.toThrow()
    })
})

describe('isValidSolanaAddress', () => {
    it('accepts a real 32-byte base58 address', () => {
        expect(isValidSolanaAddress('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe(true)
    })

    it('tolerates surrounding whitespace', () => {
        expect(isValidSolanaAddress('  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v ')).toBe(
            true
        )
    })

    it('rejects an EVM address, an empty string and a wrong-length key', () => {
        expect(isValidSolanaAddress('0x0000000000000000000000000000000000000000')).toBe(false)
        expect(isValidSolanaAddress('')).toBe(false)
        expect(isValidSolanaAddress(bs58.encode(new Uint8Array(31)))).toBe(false)
    })
})
