/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin key derivation and address encoding.
 *
 * Unlike Solana (ed25519 / SLIP-0010, hardened-only — see solana/keys.ts),
 * Bitcoin is plain BIP32 over secp256k1, so the existing `bip32` package does
 * the derivation and only the address *encoding* differs per type.
 *
 * Every function here is public-key-only where it can be: address derivation
 * needs no private key, so watch-only wallets and the discovery scan reuse the
 * same code paths as a signing wallet. Private keys appear only in
 * `derivePrivateKey` and `parseWif`, both of which return wipeable bytes.
 */
import * as bitcoin from 'bitcoinjs-lib'
import BIP32Factory, { type BIP32Interface } from 'bip32'
import ECPairFactory from 'ecpair'
import * as ecc from 'tiny-secp256k1'
import bs58 from 'bs58'
import createHash from 'create-hash'

import { wipe } from '@/js/security/memory'
import { LEDGER_ETH_ACCOUNT_PATH } from '@/js/wallets/constants'
import {
    ADDRESS_TYPE_INFO,
    type BitcoinNetwork,
    type BtcAddressType,
} from './networks'

/**
 * bitcoinjs-lib needs an ECC backend registered before it can do anything
 * Taproot-related (x-only tweaking). Registering at module load means any
 * import of this module is enough — no caller has to remember to initialise.
 * `bip32`/`ecpair` take theirs by factory instead.
 */
bitcoin.initEccLib(ecc)

export const bip32 = BIP32Factory(ecc)
export const ECPair = ECPairFactory(ecc)

/** Which chain of an account a key sits on. BIP44's `change` level. */
export type BtcChain = 'receive' | 'change'

const CHAIN_INDEX: Record<BtcChain, number> = { receive: 0, change: 1 }

/**
 * The BIP44-style account path for an address type.
 *
 * `m/{purpose}'/{coinType}'/{account}'` — the level a wallet's extended public
 * key is normally published at, and the deepest level that still needs the
 * private key to derive. Everything below is public-derivable, which is what
 * lets a watch-only xpub scan for funds.
 */
export function accountPath(
    type: BtcAddressType,
    network: BitcoinNetwork,
    account = 0
): string {
    return `m/${ADDRESS_TYPE_INFO[type].purpose}'/${network.coinType}'/${account}'`
}

/** The full path to one address. */
export function addressPath(
    type: BtcAddressType,
    network: BitcoinNetwork,
    account: number,
    chain: BtcChain,
    index: number
): string {
    return `${accountPath(type, network, account)}/${CHAIN_INDEX[chain]}/${index}`
}

/**
 * Encodes a public key as an address of the given type.
 *
 * The single place address encoding happens — every other module derives a
 * public key and calls this, so adding a type means touching one function.
 */
export function addressFromPublicKey(
    pubkey: Uint8Array,
    type: BtcAddressType,
    network: BitcoinNetwork
): string {
    const params = network.params
    let address: string | undefined

    switch (type) {
        case 'p2pkh':
            address = bitcoin.payments.p2pkh({ pubkey, network: params }).address
            break
        case 'p2sh-p2wpkh':
            address = bitcoin.payments.p2sh({
                redeem: bitcoin.payments.p2wpkh({ pubkey, network: params }),
                network: params,
            }).address
            break
        case 'p2wpkh':
            address = bitcoin.payments.p2wpkh({ pubkey, network: params }).address
            break
        case 'p2tr':
            // Taproot commits to an x-only (32-byte) key, not the 33-byte
            // compressed form every other type uses.
            address = bitcoin.payments.p2tr({
                internalPubkey: bitcoin.toXOnly(pubkey),
                network: params,
            }).address
            break
    }

    if (!address) {
        throw new Error(`Could not encode a ${type} address.`)
    }
    return address
}

/** The scriptPubKey an address pays to. Needed to build a PSBT input. */
export function scriptForAddress(address: string, network: BitcoinNetwork): Uint8Array {
    return bitcoin.address.toOutputScript(address, network.params)
}

/**
 * Whether `address` is well-formed **for this network**.
 *
 * Network-aware on purpose: a mainnet address is structurally valid but
 * unusable on testnet and vice versa, and letting one through would build a
 * transaction that can never confirm. bitcoinjs throws for both malformed and
 * wrong-network input, which is the behaviour wanted here.
 */
export function isValidBitcoinAddress(address: string, network: BitcoinNetwork): boolean {
    try {
        bitcoin.address.toOutputScript(address.trim(), network.params)
        return true
    } catch {
        return false
    }
}

/**
 * The address type an address string encodes, or null if unrecognised.
 *
 * Matches on the raw scriptPubKey template rather than on the address prefix:
 * prefixes differ between mainnet and testnet ('1…' vs 'm…', 'bc1' vs 'tb1')
 * while the script templates are identical on every network, so this needs no
 * per-network special-casing.
 *
 * Note a bare P2SH script is indistinguishable from a P2SH-wrapped SegWit one
 * — the wrapping lives in the *spending* witness, not in the output — so
 * `p2sh-p2wpkh` here means "some P2SH output", which is what a `3…` address
 * can tell you and no more.
 */
export function detectAddressType(
    address: string,
    network: BitcoinNetwork
): BtcAddressType | null {
    let script: Uint8Array
    try {
        script = bitcoin.address.toOutputScript(address.trim(), network.params)
    } catch {
        return null
    }

    const OP_0 = 0x00
    const OP_1 = 0x51
    const OP_DUP = 0x76
    const OP_HASH160 = 0xa9
    const OP_EQUAL = 0x87

    // P2PKH: OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG
    if (script.length === 25 && script[0] === OP_DUP && script[1] === OP_HASH160) return 'p2pkh'
    // P2SH: OP_HASH160 <20 bytes> OP_EQUAL
    if (script.length === 23 && script[0] === OP_HASH160 && script[22] === OP_EQUAL) {
        return 'p2sh-p2wpkh'
    }
    // P2WPKH: OP_0 <20 bytes>
    if (script.length === 22 && script[0] === OP_0 && script[1] === 0x14) return 'p2wpkh'
    // P2TR: OP_1 <32 bytes>
    if (script.length === 34 && script[0] === OP_1 && script[1] === 0x20) return 'p2tr'

    return null
}

/**
 * Derives the account-level node from a BIP-39 seed.
 *
 * The returned node still holds a private key; callers that only need
 * addresses should `.neutered()` it immediately, and callers that sign must
 * keep its lifetime inside one authorized scope.
 */
export function deriveAccountNode(
    seed: Uint8Array,
    type: BtcAddressType,
    network: BitcoinNetwork,
    account = 0
): BIP32Interface {
    return bip32.fromSeed(seed, network.params).derivePath(accountPath(type, network, account))
}

/**
 * The path Core Extension / Core App actually use for Bitcoin.
 *
 * Core does not give Bitcoin its own BIP-44/49/84/86 derivation at all — it
 * reuses the SAME secp256k1 key as the Avalanche C-Chain / EVM address
 * (`m/44'/60'/0'/0/0`, the identical `LEDGER_ETH_ACCOUNT_PATH` that
 * `MnemonicWallet` derives its EVM key from) and re-encodes that one key's
 * compressed public key as P2WPKH. See
 * `avalanche-wallet-sdk/Wallet/EVM/EvmWalletReadonly.ts#getAddressBTC` — the
 * vendored SDK this app already ships still documents and implements exactly
 * this, even though nothing currently calls it.
 *
 * That means a standards-compliant BIP-84 wallet (Electrum, Sparrow, a
 * hardware wallet, and this app's own independent `p2wpkh` derivation)
 * produces a DIFFERENT address than Core does for the same recovery phrase —
 * confirmed against Core's own real output, not assumed. There is no way to
 * reconcile the two derivations; they are simply different keys. This
 * constant exists so this wallet can offer the address Core actually shows,
 * as one candidate among the others, rather than silently disagreeing with
 * it.
 *
 * Deliberately imported from `js/wallets/constants.ts` rather than
 * redeclared: the whole point is that this MUST stay byte-identical to
 * whatever path the Avalanche C-Chain key is derived at, forever. Two copies
 * of the same magic string would be exactly the kind of thing that quietly
 * drifts apart.
 */
export const CORE_WALLET_PATH = LEDGER_ETH_ACCOUNT_PATH

/**
 * Derives the single fixed key Core's Bitcoin address comes from.
 *
 * Not an "account" node the way `deriveAccountNode` returns one — there is no
 * further /chain/index derivation beneath this. The key itself IS the address
 * key; encode its public key directly as P2WPKH (see ./networks.ts /
 * platforms/bitcoin/wallet.ts's `singleAddress` handling).
 */
export function deriveCoreCompatNode(seed: Uint8Array, network: BitcoinNetwork): BIP32Interface {
    return bip32.fromSeed(seed, network.params).derivePath(CORE_WALLET_PATH)
}

/** The account-level extended PUBLIC key — safe to persist, cannot sign. */
export function deriveAccountXpub(
    seed: Uint8Array,
    type: BtcAddressType,
    network: BitcoinNetwork,
    account = 0
): string {
    const node = deriveAccountNode(seed, type, network, account)
    try {
        return node.neutered().toBase58()
    } finally {
        // The node holds a private key; drop it rather than leaving it live
        // for the GC to collect whenever it feels like it.
        destroyNode(node)
    }
}

/**
 * Re-imports an account-level extended public key.
 *
 * Accepts any of the version-byte variants wallets publish (xpub/ypub/zpub on
 * mainnet, tpub/upub/vpub on testnet). Only `xpub`/`tpub` are canonical for
 * bip32; the others encode the *address type* in the version bytes, which is
 * information this codebase carries in `BtcAddressType` instead — so they are
 * rewritten to the canonical version before parsing rather than rejected.
 */
export function parseAccountXpub(xpub: string, network: BitcoinNetwork): BIP32Interface {
    const trimmed = xpub.trim()
    if (!trimmed) throw new Error('Enter an extended public key.')

    const canonical = toCanonicalXpub(trimmed, network)
    try {
        const node = bip32.fromBase58(canonical, network.params)
        if (node.privateKey) {
            // An xprv would work mechanically, but silently accepting one turns
            // a "watch-only" flow into key custody without the user asking.
            throw new Error(
                'That is an extended PRIVATE key. Paste the public one (xpub/ypub/zpub) instead.'
            )
        }
        return node
    } catch (e: any) {
        if (/extended PRIVATE/.test(String(e?.message))) throw e
        throw new Error(
            'Could not read that extended public key. Check it was copied in full ' +
                `and belongs to ${network.name}.`
        )
    }
}

/**
 * SLIP-132 version-byte prefixes. These encode the intended address type,
 * which bip32 itself has no notion of — it only knows the network's own
 * `bip32.public` version. Mapping them onto the canonical prefix lets a user
 * paste whatever their other wallet exported.
 */
const SLIP132_TO_CANONICAL: Record<string, number> = {
    // mainnet
    '0488b21e': 0x0488b21e, // xpub — already canonical
    '049d7cb2': 0x0488b21e, // ypub (BIP49)
    '04b24746': 0x0488b21e, // zpub (BIP84)
    // testnet
    '043587cf': 0x043587cf, // tpub — already canonical
    '044a5262': 0x043587cf, // upub (BIP49)
    '045f1cf6': 0x043587cf, // vpub (BIP84)
}

function toCanonicalXpub(xpub: string, network: BitcoinNetwork): string {
    let decoded: Uint8Array
    try {
        // bs58check is bundled with bitcoinjs; going through `address` would
        // apply the wrong checks, so decode via bip32's own base58 handling by
        // round-tripping through a Buffer here.
        decoded = base58CheckDecode(xpub)
    } catch {
        return xpub // let bip32.fromBase58 produce the error message
    }

    if (decoded.length !== 78) return xpub

    const version = Buffer.from(decoded.slice(0, 4)).toString('hex')
    const canonical = SLIP132_TO_CANONICAL[version]
    if (canonical === undefined) return xpub

    const expected = network.params.bip32.public
    if (canonical !== expected) {
        throw new Error(
            `That extended public key is for ${
                canonical === 0x0488b21e ? 'mainnet' : 'testnet'
            }, but ${network.name} is selected.`
        )
    }

    const out = Uint8Array.from(decoded)
    new DataView(out.buffer, out.byteOffset).setUint32(0, canonical, false)
    return base58CheckEncode(out)
}

/**
 * base58check, built from two direct dependencies rather than reaching for
 * `bs58check`.
 *
 * `bs58check` IS present in the tree, but only transitively and at two
 * different major versions (bitcoinjs-lib v7 wants ^4, the hoisted copy is
 * v2) — importing it would bind to whichever the resolver happens to pick,
 * which is exactly the kind of silent-breakage dependency this is not worth
 * being. `bs58` and `create-hash` are both declared dependencies of this
 * project, and base58check is only "base58 of payload plus the first four
 * bytes of a double SHA-256".
 */
function sha256(data: Uint8Array): Uint8Array {
    return Uint8Array.from(createHash('sha256').update(Buffer.from(data)).digest())
}

function base58CheckDecode(s: string): Uint8Array {
    const decoded = bs58.decode(s)
    if (decoded.length < 5) throw new Error('too short')
    const payload = decoded.slice(0, decoded.length - 4)
    const checksum = decoded.slice(decoded.length - 4)
    const expected = sha256(sha256(payload)).slice(0, 4)
    for (let i = 0; i < 4; i++) {
        if (checksum[i] !== expected[i]) throw new Error('bad checksum')
    }
    return payload
}

function base58CheckEncode(payload: Uint8Array): string {
    const checksum = sha256(sha256(payload)).slice(0, 4)
    const out = new Uint8Array(payload.length + 4)
    out.set(payload)
    out.set(checksum, payload.length)
    return bs58.encode(out)
}

/**
 * Parses a WIF (Wallet Import Format) private key.
 *
 * Returns the key pair plus the network it declares. WIF embeds its own
 * network byte, so a mainnet key pasted while testnet is selected is caught
 * here rather than producing an address on the wrong chain.
 */
export function parseWif(wif: string, network: BitcoinNetwork) {
    const trimmed = wif.trim()
    if (!trimmed) throw new Error('Enter a private key.')

    try {
        const pair = ECPair.fromWIF(trimmed, network.params)
        if (!pair.privateKey) throw new Error('no private key')
        return pair
    } catch {
        // Try the other network so the error can say WHICH mismatch it is,
        // rather than a generic "invalid key".
        const other = network.isTestnet ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
        try {
            ECPair.fromWIF(trimmed, other)
            throw new Error(
                `That private key is for ${
                    network.isTestnet ? 'mainnet' : 'testnet'
                }, but ${network.name} is selected.`
            )
        } catch (e: any) {
            if (/is for (mainnet|testnet)/.test(String(e?.message))) throw e
            throw new Error('That is not a valid WIF private key.')
        }
    }
}

/**
 * Parses a raw 32-byte private key given as `0x`-prefixed hex — the format
 * EVM wallets use, and the one a key reused from the C-Chain (see the "Core
 * Wallet" candidate elsewhere in this module) is actually in, rather than
 * WIF.
 *
 * Unlike WIF, raw hex carries no network byte or compression flag, so both
 * are assumed rather than read: the network is whichever is selected, and
 * the key is treated as compressed — three of the four address types
 * (P2WPKH, P2SH-P2WPKH, P2TR) require a compressed pubkey outright, and it's
 * what Core Wallet's own EVM-key-reuse path assumes too.
 */
function parseHexPrivateKey(hex: string, network: BitcoinNetwork) {
    const body = hex.slice(2)
    if (!/^[0-9a-fA-F]{64}$/.test(body)) {
        throw new Error('A 0x-prefixed private key must be 32 bytes (64 hex characters).')
    }
    const bytes = Uint8Array.from(Buffer.from(body, 'hex'))
    try {
        return ECPair.fromPrivateKey(bytes, { network: network.params, compressed: true })
    } catch {
        throw new Error('That is not a valid private key.')
    }
}

/**
 * Parses whatever the user pasted into a private-key field — either WIF
 * (`parseWif`) or `0x`-prefixed raw hex (`parseHexPrivateKey`). The two
 * formats are visually unambiguous (hex always starts `0x`; WIF never does),
 * so which one applies is decided from the prefix alone.
 */
export function parsePrivateKeyInput(input: string, network: BitcoinNetwork) {
    const trimmed = input.trim()
    if (!trimmed) throw new Error('Enter a private key.')
    if (/^0x/i.test(trimmed)) return parseHexPrivateKey(trimmed, network)
    return parseWif(trimmed, network)
}

/**
 * Best-effort erasure of a BIP32 node's private material.
 *
 * Same tradeoff as `destroyKeyPair` in js/security/memory.ts and
 * `destroySolanaKeypair` in solana/keys.ts: the library exposes `privateKey`
 * as a live `Uint8Array` we can zero, but any copy already handed out is
 * unreachable. Wipes the one copy we control.
 */
export function destroyNode(node: { privateKey?: Uint8Array | null } | null | undefined): void {
    const pk = node?.privateKey
    if (pk) wipe(pk)
}
