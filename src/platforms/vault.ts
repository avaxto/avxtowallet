/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Building a `SessionVault` around one secret, for every platform that holds
 * keys locally.
 *
 * Solana and Bitcoin each carried a byte-identical private copy of this, and
 * the EVM platform's mnemonic access would have been the third. It is collected
 * here for the same reason `commonFromWeb3` was (see evm/common.ts): the
 * duplication is not the problem, drift is. Every copy has to get the same two
 * subtleties right, and a copy that quietly stops doing so leaks a seed rather
 * than failing visibly.
 */
import { markRaw } from 'vue'

import { SessionVault } from '@/js/security/SessionVault'
import { AuthHandle, AuthScope } from '@/js/security/session'
import { wipe } from '@/js/security/memory'

/**
 * Builds a vault holding one secret, encrypted under the session password.
 *
 * Mirrors `MnemonicWallet.create` / `SingletonWallet.create`: derive the key,
 * store the secret inside a one-shot authorization, then dispose it. `markRaw`
 * keeps Vue's reactivity from proxying the vault — a proxied `CryptoKey` fails
 * WebCrypto's brand check.
 *
 * **`vault.put` consumes and wipes the plaintext it is given**, so callers must
 * not reuse the buffer afterwards. This is what makes a shared seed across two
 * platforms wrong: whichever ran second would derive from zeroes. See
 * `unlockWithMnemonic` in ./store.ts, which passes the phrase to each platform
 * rather than a seed.
 */
export async function vaultWith(
    secretName: 'seed' | 'pk',
    plaintext: Uint8Array,
    password: string
): Promise<SessionVault> {
    const vault = markRaw(new SessionVault())
    let stored = false
    try {
        // deriveKey runs PBKDF2 and can reject (a hostile or unavailable
        // WebCrypto). It happens BEFORE vault.put, whose own finally is what
        // normally wipes the plaintext — so without the catch below a failure
        // here would leave the seed sitting in memory unwiped.
        const key = await vault.deriveKey(password)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
        try {
            await vault.put(auth, secretName, plaintext)
            stored = true
            return vault
        } finally {
            auth.dispose()
        }
    } finally {
        // vault.put already wiped it on the success path; wiping twice is
        // harmless, but skipping it when put never ran is not.
        if (!stored) wipe(plaintext)
    }
}
