/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * EVM key derivation from a BIP-39 seed.
 *
 * Unlike Solana (ed25519/SLIP-0010, which needed an implementation of its own —
 * see solana/keys.ts), an EVM key is ordinary secp256k1 BIP-32, which the app
 * already derives with `hdkey`. So this module is thin on purpose: it exists to
 * give the *path* and the seed-to-address step one definition, not to
 * re-implement derivation.
 *
 * ## The path, and why it is not a choice
 *
 * `m/44'/60'/0'/0/0` — what MetaMask, Rabby, Trust and Ledger Live all open
 * first. Solana genuinely has two competing conventions and therefore probes
 * both (see `discoverAccounts` there); EVM does not, so probing here would be
 * inventing an ambiguity that does not exist.
 *
 * It is also *the same path Avalanche's own `MnemonicWallet` derives its
 * C-Chain key at* — `ETH_ACCOUNT_PATH + '/0/0'`, imported below rather than
 * re-spelled so the two cannot drift apart. That is a property worth stating,
 * because the tabbed wallet makes it visible: one recovery phrase opened on
 * both the Avalanche and EVM tabs shows the *same* 0x address on both, which is
 * correct and is what a user moving between them expects.
 *
 * ## Handling of key material
 *
 * Every function that materialises a private key hands it back as a
 * `Uint8Array` the caller must `wipe()`, and wipes every intermediate HD node
 * itself. The one exception is `evmAddressFromPrivateKey`, which reads a key it
 * does not own and leaves it alone.
 */
import { privateToAddress, toChecksumAddress } from 'ethereumjs-util'
import { Buffer as BufferNative } from 'buffer'
import HDKey from 'hdkey'

import { hd, wipeNode } from '@/js/hdkeyExtras'
import { ETH_ACCOUNT_PATH } from '@/js/wallets/constants'
import { wipe } from '@/js/security/memory'

/**
 * The account level, `m/44'/60'/0'`. Change and index are appended per key.
 *
 * Re-exported rather than redefined — see the module note on why this file and
 * Avalanche's C-Chain wallet must resolve to the same path.
 */
export { ETH_ACCOUNT_PATH }

/** The first account of the standard EVM path: `m/44'/60'/0'/0/0`. */
export const DEFAULT_EVM_PATH = `${ETH_ACCOUNT_PATH}/0/0`

/** The path for account `index` on the standard EVM chain: `m/44'/60'/0'/0/N`. */
export function evmAccountPath(index: number): string {
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`EVM account index must be a non-negative integer, got ${index}`)
    }
    return `${ETH_ACCOUNT_PATH}/0/${index}`
}

/**
 * Derives the secp256k1 private key at `path` from a BIP-39 seed.
 *
 * The master node and every intermediate are wiped before returning; the
 * returned key is a copy the **caller must wipe**. `hdkey` hands back a node
 * whose `privateKey` buffer it owns and reuses, so returning that buffer
 * directly would hand out a reference that `wipeNode` is about to zero.
 */
export function deriveEvmPrivateKey(seed: Uint8Array, path: string): Uint8Array {
    // `fromMasterSeed` takes a Node Buffer, so the seed has to be copied into
    // one. That copy is secret too and nothing else will clear it — the vault
    // wipes the buffer it handed out, not the duplicate made here.
    const seedBuffer = BufferNative.from(seed) as globalThis.Buffer
    try {
        const master = HDKey.fromMasterSeed(seedBuffer)
        try {
            const node = hd(master.derive(path))
            try {
                if (!node.privateKey) {
                    throw new Error(`No private key at derivation path "${path}".`)
                }
                return Uint8Array.from(node.privateKey)
            } finally {
                wipeNode(node)
            }
        } finally {
            wipeNode(master)
        }
    } finally {
        wipe(seedBuffer)
    }
}

/**
 * The checksummed 0x address for a private key.
 *
 * EIP-55 checksummed, not lowercase: this address is displayed, pasted into
 * explorers and compared against what an extension shows for the same phrase,
 * and every one of those shows the checksummed form.
 */
export function evmAddressFromPrivateKey(privateKey: Uint8Array): string {
    const address = privateToAddress(BufferNative.from(privateKey) as globalThis.Buffer)
    return toChecksumAddress('0x' + address.toString('hex'))
}

/**
 * The 0x address at `path`, without leaving a key behind.
 *
 * This is what opening a session needs — the address is public, the key is not,
 * and the key stays in the vault until something actually signs.
 */
export function deriveEvmAddress(seed: Uint8Array, path: string = DEFAULT_EVM_PATH): string {
    const privateKey = deriveEvmPrivateKey(seed, path)
    try {
        return evmAddressFromPrivateKey(privateKey)
    } finally {
        wipe(privateKey)
    }
}

/** True if `address` is a well-formed 0x-prefixed 20-byte address. */
export function isValidEvmAddress(address: string): boolean {
    return /^0x[0-9a-fA-F]{40}$/.test(address.trim())
}
