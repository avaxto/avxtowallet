/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Shared implementation behind every platform's `PlatformTokenRegistry`
 * (see types.ts) — the anti-spoofing matching algorithm, implemented once
 * here rather than copy-pasted into each platform's own registry module.
 *
 * That matters specifically because this is security-sensitive matching
 * logic: two copies drifting apart (one platform gets a homoglyph-normalization
 * fix, another doesn't) is a real, quiet way for this protection to have
 * gaps. A platform's own registry module (platforms/avalanche/tokenRegistry/,
 * platforms/robinhood/tokenRegistry.ts, …) is expected to be just DATA — a
 * list of `PlatformTokenRegistryEntry` — passed to `createTokenRegistry`
 * below to get a full, correctly-behaving `PlatformTokenRegistry` back.
 */
import type { PlatformTokenRegistry, PlatformTokenRegistryEntry } from './types'

function normalizeAddress(address: string): string {
    return address.trim().toLowerCase()
}

/**
 * Cyrillic and Greek letters that are visually indistinguishable from a
 * Latin one in most fonts — mapped back to that Latin letter. This is the
 * standard trick behind a token whose symbol *looks* like "AVAX" (or "ETH",
 * or any other native/registered symbol) but is a different string
 * byte-for-byte, so a plain case-fold compare never catches it: e.g.
 * Cyrillic \u0410 (U+0410) reads identically to Latin A but is a wholly
 * different character.
 *
 * Not an exhaustive confusables table — a targeted list covering the
 * letters that actually make up real-world token symbols (A, B, C, E, H, K,
 * M, N, O, P, S, T, X, Y, Z and lowercase equivalents), which is what a
 * lookalike-token deployer is working with anyway: they need the result to
 * still resemble a real symbol.
 *
 * All written as \u escapes rather than the literal characters — an
 * invisible or look-alike character pasted directly into source is exactly
 * the kind of thing that's impossible to verify by looking at it, which is
 * the same reason a spoofed token would use one in the first place.
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
    // Cyrillic uppercase.
    '\u0410': 'A',
    '\u0412': 'B',
    '\u0415': 'E',
    '\u041a': 'K',
    '\u041c': 'M',
    '\u041d': 'H',
    '\u041e': 'O',
    '\u0420': 'P',
    '\u0421': 'C',
    '\u0422': 'T',
    '\u0423': 'Y',
    '\u0425': 'X',
    '\u0405': 'S',
    '\u0406': 'I',
    '\u0408': 'J',
    // Cyrillic lowercase.
    '\u0430': 'a',
    '\u0435': 'e',
    '\u043e': 'o',
    '\u0440': 'p',
    '\u0441': 'c',
    '\u0443': 'y',
    '\u0445': 'x',
    '\u0456': 'i',
    '\u0458': 'j',
    '\u0455': 's',
    // Greek uppercase, plus lowercase omicron (the only Greek lowercase
    // letter that's a plain Latin look-alike on its own).
    '\u0391': 'A',
    '\u0392': 'B',
    '\u0395': 'E',
    '\u0396': 'Z',
    '\u0397': 'H',
    '\u0399': 'I',
    '\u039a': 'K',
    '\u039c': 'M',
    '\u039d': 'N',
    '\u039f': 'O',
    '\u03a1': 'P',
    '\u03a4': 'T',
    '\u03a5': 'Y',
    '\u03a7': 'X',
    '\u03bf': 'o',
}

// Zero-width space/non-joiner/joiner, LTR/RTL marks, the bidi
// embedding/override range, word joiner, soft hyphen, and the zero-width
// no-break space (BOM): \u200b-\u200f \u202a-\u202e \u2060 \u00ad \ufeff.
// Written as \u escapes for the same auditability reason as the confusables
// table above.
const INVISIBLE_CHARS_RE = /[\u200b-\u200f\u202a-\u202e\u2060\u00ad\ufeff]/g

/**
 * Normalizes a reported token symbol/name before it's ever compared: strips
 * zero-width/invisible characters (a symbol plus an invisible code point
 * still *renders* identically but fails a naive exact-match filter either
 * way — matching things it shouldn't, or failing to match things it
 * should), then maps look-alike Cyrillic/Greek letters back to Latin. Every
 * comparison in `createTokenRegistry` goes through this, not just a
 * `.toUpperCase()` — case-insensitivity alone isn't script-insensitivity.
 */
export function normalizeSymbol(s: string): string {
    return s
        .normalize('NFKC')
        .replace(INVISIBLE_CHARS_RE, '')
        .split('')
        .map((ch) => CONFUSABLE_TO_LATIN[ch] ?? ch)
        .join('')
        .trim()
        .toUpperCase()
}

/**
 * Builds a `PlatformTokenRegistry` from a flat list of entries — this is
 * what every platform's registry module calls with its own data. See the
 * module doc comment for why the matching logic lives here once instead of
 * per-platform.
 */
export function createTokenRegistry(entries: PlatformTokenRegistryEntry[]): PlatformTokenRegistry {
    const getAll = (): PlatformTokenRegistryEntry[] => entries

    const getNativeEntry = (): PlatformTokenRegistryEntry => {
        // Every platform registry is expected to declare its native asset —
        // this is a real invariant (fails loudly at first use if the data
        // is wrong), not a soft lookup that can come back empty.
        const entry = entries.find((t) => t.contractAddress === null)
        if (!entry) throw new Error('Token registry is missing its native asset entry.')
        return entry
    }

    const findToken = (
        contractAddress: string,
        chainId?: number
    ): PlatformTokenRegistryEntry | undefined => {
        if (!contractAddress) return undefined
        const target = normalizeAddress(contractAddress)
        return entries.find((t) => {
            if (!t.contractAddress) return false
            if (normalizeAddress(t.contractAddress) !== target) return false
            if (chainId !== undefined && t.chainId !== undefined && t.chainId !== chainId) return false
            return true
        })
    }

    const isSpoofedToken = (symbol: string, contractAddress: string, chainId?: number): boolean => {
        if (!contractAddress) return false
        const target = normalizeAddress(contractAddress)
        const normalizedSymbol = normalizeSymbol(symbol)
        const sameSymbol = entries.filter((t) => normalizeSymbol(t.symbol) === normalizedSymbol)
        if (sameSymbol.length === 0) return false

        const matchesAKnownAddress = sameSymbol.some((t) => {
            if (!t.contractAddress) return false // the native entry — never satisfied by a contract
            if (chainId !== undefined && t.chainId !== undefined && t.chainId !== chainId) return false
            return normalizeAddress(t.contractAddress) === target
        })
        return !matchesAKnownAddress
    }

    const isReservedNativeSymbol = (symbolOrName: string): boolean => {
        return normalizeSymbol(symbolOrName) === normalizeSymbol(getNativeEntry().symbol)
    }

    return { getAll, getNativeEntry, findToken, isSpoofedToken, isReservedNativeSymbol }
}
