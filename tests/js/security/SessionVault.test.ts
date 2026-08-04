import { SessionVault, KeyProvider } from '@/js/security/SessionVault'
import { wipe, secretFromString, secretToString } from '@/js/security/memory'

// jsdom has no WebCrypto; use Node's, which implements the same standard API.
import { webcrypto } from 'crypto'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
})

/** Minimal stand-in for AuthHandle. */
function provider(key: CryptoKey): KeyProvider {
    return { getKey: () => key }
}

/** A provider that has been disposed — must never yield a key. */
function deadProvider(): KeyProvider {
    return {
        getKey: () => {
            throw new Error('Authorization has been disposed.')
        },
    }
}

const PASSWORD = 'correct horse battery staple'
const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('memory helpers', () => {
    it('wipe zeroes a buffer in place', () => {
        const buf = new Uint8Array([1, 2, 3, 4, 5])
        wipe(buf)
        expect(Array.from(buf)).toEqual([0, 0, 0, 0, 0])
    })

    it('wipe tolerates null, undefined and empty buffers', () => {
        expect(() => wipe(null)).not.toThrow()
        expect(() => wipe(undefined)).not.toThrow()
        expect(() => wipe(new Uint8Array(0))).not.toThrow()
    })

    it('round-trips a string through bytes', () => {
        expect(secretToString(secretFromString(MNEMONIC))).toBe(MNEMONIC)
    })
})

describe('SessionVault', () => {
    it('round-trips a secret with the correct key', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)

        await vault.put(provider(key), 'mnemonic', secretFromString(MNEMONIC))

        const got = await vault.withSecret(provider(key), 'mnemonic', (pt) => secretToString(pt))
        expect(got).toBe(MNEMONIC)
    })

    it('wipes the caller-supplied plaintext on put', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)

        const plaintext = secretFromString(MNEMONIC)
        await vault.put(provider(key), 'mnemonic', plaintext)

        expect(Array.from(plaintext).every((b) => b === 0)).toBe(true)
    })

    it('rejects a wrong password via the GCM auth tag', async () => {
        const vault = new SessionVault()
        const right = await vault.deriveKey(PASSWORD)
        const wrong = await vault.deriveKey('not the password')

        await vault.put(provider(right), 'seed', secretFromString('seed material'))

        await expect(
            vault.withSecret(provider(wrong), 'seed', (pt) => secretToString(pt))
        ).rejects.toThrow()
    })

    it('never yields plaintext to a disposed authorization', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        await vault.put(provider(key), 'seed', secretFromString('seed material'))

        await expect(vault.withSecret(deadProvider(), 'seed', () => 'reached')).rejects.toThrow(
            /disposed/i
        )
    })

    it('wipes the plaintext when the callback throws', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        await vault.put(provider(key), 'seed', secretFromString('seed material'))

        let captured: Uint8Array | null = null
        await expect(
            vault.withSecret(provider(key), 'seed', (pt) => {
                captured = pt
                throw new Error('boom')
            })
        ).rejects.toThrow('boom')

        expect(captured).not.toBeNull()
        expect(Array.from(captured!).every((b) => b === 0)).toBe(true)
    })

    it('wipes the plaintext after a successful callback', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        await vault.put(provider(key), 'seed', secretFromString('seed material'))

        let captured: Uint8Array | null = null
        await vault.withSecret(provider(key), 'seed', (pt) => {
            captured = pt
            return secretToString(pt)
        })

        expect(Array.from(captured!).every((b) => b === 0)).toBe(true)
    })

    it('refuses to let the callback return the plaintext buffer itself', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        await vault.put(provider(key), 'seed', secretFromString('seed material'))

        await expect(
            vault.withSecret(provider(key), 'seed', (pt) => pt as unknown as string)
        ).rejects.toThrow(/leaked/i)
    })

    it('uses a fresh IV for every put, so no nonce is reused', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)

        const ivs = new Set<string>()
        for (let i = 0; i < 25; i++) {
            await vault.put(provider(key), 'seed', secretFromString('same plaintext'))
            // Reach in deliberately: IV uniqueness is a correctness property
            // worth asserting even though it is private.
            const blob = (vault as any).blobs.get('seed')
            ivs.add(Buffer.from(blob.iv).toString('hex'))
        }
        expect(ivs.size).toBe(25)
    })

    it('does not accept ciphertext from another vault (AAD binding)', async () => {
        const a = new SessionVault()
        const b = new SessionVault()

        // Same password, but each vault has its own salt and AAD.
        const keyA = await a.deriveKey(PASSWORD)
        await a.put(provider(keyA), 'seed', secretFromString('seed material'))

        const blob = (a as any).blobs.get('seed')
        ;(b as any).blobs.set('seed', blob)

        const keyB = await b.deriveKey(PASSWORD)
        await expect(vaultRead(b, keyB)).rejects.toThrow()
    })

    it('throws for a secret that was never stored', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        await expect(vault.withSecret(provider(key), 'pk', () => 'x')).rejects.toThrow(
            /not in this vault/i
        )
    })

    it('reports what it holds and clears on demand', async () => {
        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)

        expect(vault.has('mnemonic')).toBe(false)
        await vault.put(provider(key), 'mnemonic', secretFromString(MNEMONIC))
        expect(vault.has('mnemonic')).toBe(true)

        vault.clear()
        expect(vault.has('mnemonic')).toBe(false)
    })

    it('verify() passes with the right key and fails with the wrong one', async () => {
        const vault = new SessionVault()
        const right = await vault.deriveKey(PASSWORD)
        const wrong = await vault.deriveKey('nope')
        await vault.put(provider(right), 'seed', secretFromString('seed material'))

        await expect(vault.verify(provider(right), 'seed')).resolves.toBeUndefined()
        await expect(vault.verify(provider(wrong), 'seed')).rejects.toThrow()
    })
})

function vaultRead(v: SessionVault, key: CryptoKey) {
    return v.withSecret(provider(key), 'seed', (pt) => secretToString(pt))
}
