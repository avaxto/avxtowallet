/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Electrum's own seed format — the phrase Electrum generates for a new wallet.
 *
 * It is NOT BIP-39, though it uses the same English word list:
 *
 *   - Validity is not a checksum word. A phrase is an Electrum seed when
 *     HMAC-SHA512(key "Seed version", normalized phrase) starts with a version
 *     prefix: "01" standard (legacy P2PKH), "100" segwit (native P2WPKH),
 *     "101" / "102" two-factor (TrustedCoin 2-of-3 multisig).
 *   - The seed is PBKDF2-HMAC-SHA512(normalized phrase, "electrum" +
 *     passphrase, 2048 rounds, 64 bytes) — BIP-39's salt is "mnemonic", so the
 *     same words give a completely different seed.
 *   - Addresses: standard seeds derive at m/0/i (receive) and m/1/i (change)
 *     as P2PKH; segwit seeds at m/0'/0/i and m/0'/1/i as P2WPKH.
 *
 * Because validity is a 1-in-256 (standard) or 1-in-4096 (segwit) property
 * of a hash, and BIP-39's checksum passes 1 in 16 random 12-word phrases, a
 * phrase can be both — the store handles that case by scanning both.
 *
 * All of this follows Electrum's own source (electrum/mnemonic.py,
 * keystore.py) and is checked against Electrum's published test vectors in
 * tests/bitcoinElectrum.test.ts. Not supported: two-factor seeds (multisig
 * with TrustedCoin's key — cannot be spent from one phrase) and pre-2.0
 * "old" Electrum seeds (a different word list).
 */
import { hmac } from '@noble/hashes/hmac'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha512 } from '@noble/hashes/sha512'

import type { BtcAddressType } from './networks'

export type ElectrumSeedType = 'standard' | 'segwit' | '2fa' | '2fa_segwit'

const PREFIXES: [ElectrumSeedType, string][] = [
    ['standard', '01'],
    ['segwit', '100'],
    ['2fa', '101'],
    ['2fa_segwit', '102'],
]

/** Electrum's account layout for the seed types this wallet can spend. */
export interface ElectrumAccountSpec {
    seedType: 'standard' | 'segwit'
    /** Where receive (/0/i) and change (/1/i) addresses hang from. */
    accountPath: string
    addressType: BtcAddressType
    label: string
}

export const ELECTRUM_ACCOUNTS: Record<'standard' | 'segwit', ElectrumAccountSpec> = {
    standard: { seedType: 'standard', accountPath: 'm', addressType: 'p2pkh', label: 'Electrum seed — Legacy' },
    segwit: { seedType: 'segwit', accountPath: "m/0'", addressType: 'p2wpkh', label: 'Electrum seed — Native SegWit' },
}

// CJK ranges Electrum treats as "no spaces between these characters".
const CJK = /[一-鿿㐀-䶿豈-﫿぀-ヿㇰ-ㇿ가-힯ᄀ-ᇿ㄰-㆏]/

/** Electrum's `normalize_text`: NFKD, lower case, accents removed, whitespace collapsed, no spaces between CJK. */
export function normalizeElectrumText(text: string): string {
    let s = text.normalize('NFKD').toLowerCase()
    s = s.replace(/[̀-ͯ]/g, '')
    s = s.split(/\s+/).filter(Boolean).join(' ')
    // Drop a space only when it sits between two CJK characters.
    let out = ''
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (c === ' ' && i > 0 && i < s.length - 1 && CJK.test(s[i - 1]) && CJK.test(s[i + 1])) continue
        out += c
    }
    return out
}

function toHex(bytes: Uint8Array): string {
    let h = ''
    for (const b of bytes) h += b.toString(16).padStart(2, '0')
    return h
}

/** The Electrum seed type of `phrase`, or null when it is not an Electrum (2.0+) seed. */
export function electrumSeedType(phrase: string): ElectrumSeedType | null {
    const normalized = normalizeElectrumText(phrase)
    if (!normalized) return null
    const enc = new TextEncoder()
    const digest = toHex(hmac(sha512, enc.encode('Seed version'), enc.encode(normalized)))
    for (const [type, prefix] of PREFIXES) {
        if (digest.startsWith(prefix)) return type
    }
    return null
}

/** The 64-byte BIP-32 seed Electrum derives from `phrase`. The caller wipes it. */
export function electrumSeedFromPhrase(phrase: string, passphrase = ''): Uint8Array {
    const enc = new TextEncoder()
    return pbkdf2(sha512, enc.encode(normalizeElectrumText(phrase)), enc.encode('electrum' + normalizeElectrumText(passphrase)), {
        c: 2048,
        dkLen: 64,
    })
}

/** An Electrum address path: `chain` 0 = receive, 1 = change. */
export function electrumSeedPath(spec: ElectrumAccountSpec, chain: 0 | 1, index: number): string {
    return `${spec.accountPath}/${chain}/${index}`
}
