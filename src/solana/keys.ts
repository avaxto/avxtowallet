/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana key derivation.
 *
 * Solana uses ed25519, not secp256k1, so none of the existing BIP32 machinery
 * in `js/HdHelper.ts` / `hdkey` applies — those derive secp256k1 keys and
 * support unhardened derivation, neither of which is meaningful here. The
 * standard for ed25519 is SLIP-0010, implemented below.
 *
 * The one structural difference worth knowing: **every level of an ed25519
 * derivation path must be hardened.** Unhardened derivation needs public-key
 * arithmetic that ed25519's clamped scalars don't support, so SLIP-0010 simply
 * doesn't define it. `parseDerivationPath` rejects a non-hardened segment
 * rather than silently hardening it, which would otherwise derive a different
 * (and to the user, wrong and empty) account.
 *
 * HMAC-SHA512 comes from WebCrypto rather than a JS implementation — it is
 * available everywhere this app runs and keeps the secret inside the browser's
 * crypto implementation for the hashing step.
 */
import { ed25519 } from '@noble/curves/ed25519'
import bs58 from 'bs58'

import { wipe } from '@/js/security/memory'

const HARDENED_OFFSET = 0x80000000

/** SLIP-0010's fixed domain-separation key for the ed25519 master node. */
const ED25519_CURVE_KEY = new TextEncoder().encode('ed25519 seed')

/**
 * Derivation paths a Solana mnemonic might have funds on.
 *
 * Two conventions are both widespread, and a wallet that only knows one shows
 * an empty account to half the people who import a phrase:
 *
 *   `m/44'/501'/N'/0'`  Phantom, Solflare and most browser wallets. Account N.
 *   `m/44'/501'/N'`     Ledger's Solana app, sollet, and older tooling.
 *
 * Neither is "the" standard — BIP-44 says the fourth level is a change index,
 * but Solana has no change addresses, so wallets disagreed about whether to
 * include it at all. `discoverAccounts` in ./discovery.ts probes both.
 */
export const PHANTOM_PATH = (account: number) => `m/44'/501'/${account}'/0'`
export const LEDGER_PATH = (account: number) => `m/44'/501'/${account}'`

/** The path used when nothing else is known — matches Phantom's first account. */
export const DEFAULT_SOLANA_PATH = PHANTOM_PATH(0)

interface Slip10Node {
    /** 32-byte private key — the seed fed to `Keypair.fromSeed`. */
    key: Uint8Array
    chainCode: Uint8Array
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        key,
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
    return new Uint8Array(sig)
}

/**
 * Parses `m/44'/501'/0'/0'` into hardened index numbers.
 *
 * Throws on any segment that isn't hardened. See the module note: silently
 * hardening it would produce a valid-looking but different account, and the
 * user would see an empty wallet with no indication why.
 */
export function parseDerivationPath(path: string): number[] {
    const trimmed = path.trim()
    if (!/^m(\/\d+'?)*$/.test(trimmed)) {
        throw new Error(`Malformed derivation path: "${path}"`)
    }

    const segments = trimmed.split('/').slice(1)
    return segments.map((seg) => {
        const hardened = seg.endsWith("'")
        if (!hardened) {
            throw new Error(
                `Solana derivation path "${path}" has an unhardened segment ("${seg}"). ` +
                    "ed25519 (SLIP-0010) supports hardened derivation only — every level needs a '."
            )
        }
        const index = Number.parseInt(seg.slice(0, -1), 10)
        if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
            throw new Error(`Derivation index out of range in "${path}": ${seg}`)
        }
        return index + HARDENED_OFFSET
    })
}

/**
 * Derives the SLIP-0010 ed25519 node at `path` from a BIP-39 seed.
 *
 * Intermediate nodes are wiped as the walk descends — only the node actually
 * returned survives, and the caller is responsible for wiping that.
 */
export async function deriveEd25519Node(seed: Uint8Array, path: string): Promise<Slip10Node> {
    const indices = parseDerivationPath(path)

    const master = await hmacSha512(ED25519_CURVE_KEY, seed)
    let node: Slip10Node = {
        key: master.slice(0, 32),
        chainCode: master.slice(32, 64),
    }
    wipe(master)

    for (const index of indices) {
        // Hardened child: 0x00 || parent key || ser32(index)
        const data = new Uint8Array(1 + 32 + 4)
        data[0] = 0x00
        data.set(node.key, 1)
        new DataView(data.buffer).setUint32(33, index, false) // big-endian

        const I = await hmacSha512(node.chainCode, data)
        wipe(data)

        const next: Slip10Node = { key: I.slice(0, 32), chainCode: I.slice(32, 64) }
        wipe(I)
        // The parent is not needed once the child exists.
        wipe(node.key)
        wipe(node.chainCode)
        node = next
    }

    return node
}

/**
 * The 32-byte ed25519 seed for `path`. This is what `Keypair.fromSeed` takes.
 * Caller must wipe the result once the keypair is built.
 */
export async function deriveSolanaSeed(bip39Seed: Uint8Array, path: string): Promise<Uint8Array> {
    const node = await deriveEd25519Node(bip39Seed, path)
    wipe(node.chainCode)
    return node.key
}

/** The base58 address for a derived path, without materialising a keypair. */
export async function deriveSolanaAddress(bip39Seed: Uint8Array, path: string): Promise<string> {
    const key = await deriveSolanaSeed(bip39Seed, path)
    try {
        return bs58.encode(ed25519.getPublicKey(key))
    } finally {
        wipe(key)
    }
}

/**
 * Parses a private key as exported by Phantom/Solflare.
 *
 * Accepts the two formats those wallets actually produce:
 *   - base58 of the 64-byte secret key (Phantom's "Export Private Key")
 *   - a JSON byte array, `[12,34,...]` (solana-keygen's id.json)
 *
 * Returns the 32-byte *seed* half, which is what `Keypair.fromSeed` wants. A
 * 64-byte ed25519 secret key is seed(32) || publicKey(32), so the tail is
 * derivable and carrying it around is just a second copy of a secret. When the
 * full 64 bytes are supplied the embedded public key is verified against the
 * one the seed derives — a mismatch means a corrupted or hand-edited key, and
 * silently trusting the seed half would hand back a wallet at an address the
 * user did not expect.
 */
export function parseSolanaSecretKey(input: string): Uint8Array {
    const raw = decodeSecretKeyBytes(input.trim())

    if (raw.length === 32) return raw

    if (raw.length !== 64) {
        wipe(raw)
        throw new Error(
            `A Solana private key is 32 or 64 bytes; this decoded to ${raw.length}. ` +
                'Paste the base58 key from your wallet\'s "Export Private Key", or the ' +
                'contents of a solana-keygen id.json file.'
        )
    }

    const seed = raw.slice(0, 32)
    const claimedPublic = raw.slice(32, 64)
    wipe(raw)

    const derivedPublic = ed25519.getPublicKey(seed)
    if (!bytesEqual(claimedPublic, derivedPublic)) {
        wipe(seed)
        throw new Error(
            'This private key is inconsistent — the public key embedded in it does not ' +
                'match the private half. It may be corrupted or incorrectly copied.'
        )
    }

    return seed
}

function decodeSecretKeyBytes(input: string): Uint8Array {
    if (input.startsWith('[')) {
        let parsed: unknown
        try {
            parsed = JSON.parse(input)
        } catch {
            throw new Error('That looks like a JSON key file but could not be parsed.')
        }
        if (
            !Array.isArray(parsed) ||
            !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
        ) {
            throw new Error('A JSON private key must be an array of byte values (0-255).')
        }
        return Uint8Array.from(parsed as number[])
    }

    try {
        return bs58.decode(input)
    } catch {
        throw new Error('Could not decode that private key as base58.')
    }
}

/** The base58 address for a 32-byte seed. */
export function addressFromSeed(seed: Uint8Array): string {
    return bs58.encode(ed25519.getPublicKey(seed))
}

/**
 * Best-effort erasure of a web3.js `Keypair`'s private material.
 *
 * Reaches into `_keypair.secretKey` deliberately. The public `secretKey`
 * getter returns a **fresh copy on every access**, so the obvious
 * `wipe(kp.secretKey)` zeroes a throwaway array and leaves the real key
 * untouched — verified against @solana/web3.js 1.98. The internal array is the
 * only copy reachable from here, so it is the only one that can be erased.
 *
 * Partial by necessity, in the same way as `destroyKeyPair` in
 * js/security/memory.ts: every copy the getter already handed out is
 * unreachable, and the engine may have relocated the backing store during GC.
 * Call it anyway — it removes the copy we control.
 */
export function destroySolanaKeypair(keypair: unknown): void {
    const internal = (keypair as { _keypair?: { secretKey?: Uint8Array } } | null | undefined)
        ?._keypair?.secretKey
    if (internal) wipe(internal)
}

/** Constant-time-ish equality. Not secret-dependent here, but cheap to do right. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    return diff === 0
}

/** True if `address` is a well-formed base58 ed25519 public key. */
export function isValidSolanaAddress(address: string): boolean {
    try {
        return bs58.decode(address.trim()).length === 32
    } catch {
        return false
    }
}
