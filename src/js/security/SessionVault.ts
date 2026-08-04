import { wipe } from '@/js/security/memory'

/**
 * Encrypted in-memory store for a wallet's secrets.
 *
 * Secrets are held as AES-GCM ciphertext under a key derived from the user's
 * session password. Plaintext exists only inside a `withSecret` callback and is
 * zeroed when it returns — on the error path as well as the success path.
 *
 * What this does NOT do, and cannot:
 *   - Protect the key during the signing instant. Signing needs the plaintext
 *     key in memory; the window is one operation rather than one session.
 *   - Guarantee erasure. See wipe() in ./memory.
 *   - Stop an attacker who can run code while an operation is authorized.
 */

export type SecretName = 'mnemonic' | 'seed' | 'pk'

interface VaultBlob {
    iv: Uint8Array
    /** Ciphertext with the 128-bit GCM tag appended. */
    ct: Uint8Array
}

/**
 * Supplies the AES key for a vault operation. Implemented by AuthHandle, which
 * throws once disposed — so an expired authorization cannot decrypt anything.
 * Declared structurally here to keep the vault free of a dependency on the
 * session layer.
 */
export interface KeyProvider {
    getKey(): CryptoKey
}

const IV_BYTES = 12
const SALT_BYTES = 16
const AAD_BYTES = 16
const TAG_BITS = 128

/**
 * PBKDF2 rounds for the session password. Matches the keystore file format's
 * existing cost (see js/Crypto.ts) — high enough to make guessing expensive,
 * low enough that the ~200-400ms lands once per authorized operation rather
 * than once per signature.
 */
export const PBKDF2_ITERATIONS = 200000

export class SessionVault {
    private readonly blobs = new Map<SecretName, VaultBlob>()

    /** Public, non-secret. Fixed for the vault's life so the same password
     *  always derives the same key. */
    private readonly salt: Uint8Array

    /** Binds blobs to this vault, so ciphertext cannot be swapped between two
     *  wallets unlocked under the same password. */
    private readonly aad: Uint8Array

    constructor() {
        this.salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
        this.aad = crypto.getRandomValues(new Uint8Array(AAD_BYTES))
    }

    /**
     * Derives the session key from a password. Non-extractable: its bytes live
     * in the browser's crypto implementation and cannot be read back out by
     * JS, so even a full script compromise can use it only while it is alive.
     *
     * The password string itself is unwipeable — call this as close to the
     * input as possible and drop the string immediately after.
     */
    async deriveKey(password: string): Promise<CryptoKey> {
        const material = await crypto.subtle.importKey(
            'raw',
            new TextEncoder().encode(password),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        )

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: this.salt,
                iterations: PBKDF2_ITERATIONS,
                hash: 'SHA-256',
            },
            material,
            { name: 'AES-GCM', length: 256 },
            false, // non-extractable
            ['encrypt', 'decrypt']
        )
    }

    /**
     * Encrypts and stores a secret, wiping `plaintext` before returning. The
     * caller must not retain a reference to it.
     */
    async put(auth: KeyProvider, name: SecretName, plaintext: Uint8Array): Promise<void> {
        // Fresh IV every time. Reusing a nonce under one AES-GCM key leaks the
        // authentication subkey and, with it, the ability to forge.
        const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

        try {
            const ct = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv, additionalData: this.aad, tagLength: TAG_BITS },
                auth.getKey(),
                plaintext
            )
            this.blobs.set(name, { iv, ct: new Uint8Array(ct) })
        } finally {
            wipe(plaintext)
        }
    }

    /**
     * Decrypts a secret, hands it to `fn`, and wipes it once `fn` settles —
     * whether it resolved or threw.
     *
     * Throws if the secret is absent, or if the key is wrong: AES-GCM's auth
     * tag fails closed with an OperationError, which is what makes a wrong
     * password unable to produce a signature. No password hash is stored
     * anywhere; the ciphertext is the only verifier.
     *
     * `fn` must not let the buffer escape — it is zeroed the moment fn settles.
     */
    async withSecret<T>(
        auth: KeyProvider,
        name: SecretName,
        fn: (plaintext: Uint8Array) => Promise<T> | T
    ): Promise<T> {
        const blob = this.blobs.get(name)
        if (!blob) throw new Error(`Secret "${name}" is not in this vault.`)

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: blob.iv, additionalData: this.aad, tagLength: TAG_BITS },
            auth.getKey(),
            blob.ct
        )

        const plaintext = new Uint8Array(decrypted)
        try {
            const result = await fn(plaintext)
            if (result === (plaintext as unknown)) {
                throw new Error('withSecret callback leaked the plaintext buffer.')
            }
            return result
        } finally {
            wipe(plaintext)
        }
    }

    /** Decrypts a secret purely to check the key is right. Used to fail a wrong
     *  password at the prompt rather than midway through an operation. */
    async verify(auth: KeyProvider, name: SecretName): Promise<void> {
        await this.withSecret(auth, name, () => undefined)
    }

    has(name: SecretName): boolean {
        return this.blobs.has(name)
    }

    /** Drops all ciphertext. The wallet becomes permanently watch-only until
     *  it is re-created from the mnemonic. */
    clear(): void {
        for (const blob of this.blobs.values()) {
            wipe(blob.iv)
            wipe(blob.ct)
        }
        this.blobs.clear()
    }
}
