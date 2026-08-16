/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Token registry — the wallet's pinned addresses for a handful of known
 * token symbols, used to catch impostors WITHOUT restricting what the wallet
 * can otherwise show.
 *
 * Tokens still come from wherever they always did — the remote default
 * token list, a custom token-list URL, the Glacier/chainkit SDK's
 * auto-discovery, a manually-added contract, a Swap/Iceberg free-text
 * target. The registry does not gate any of that; a token with no entry
 * here is simply not something the registry has an opinion on, and is shown
 * exactly as before.
 *
 * What it DOES do: for the symbols it knows about, it records the one
 * correct contract address. If something claiming that same symbol turns up
 * at a DIFFERENT address — a live `symbol()` call is just whatever that
 * contract's author wrote, so nothing stops a malicious ERC20 from claiming
 * "AVXTO" or "AVAX" — that candidate is rejected as a spoof rather than
 * shown next to (or instead of) the real one. See `isSpoofedToken`.
 *
 * "AVAX" specifically can never be satisfied by any contract at all — the
 * native asset's registry entry has `contractAddress: null` — so any
 * contract-based token claiming that symbol is always treated as a spoof.
 * X-chain assets ("ANTs") have no contract address to check in the first
 * place; those are guarded separately by `isReservedNativeSymbol`, a plain
 * symbol-text check.
 *
 * See ./registry.json for the data and ./types.ts for the entry shape,
 * including AVXTO (this app's own token, mainnet and Fuji testnet) — it
 * lives directly in the JSON alongside everything else rather than being
 * injected separately, so there is exactly one place entries come from.
 * Keep its contractAddress entries there in sync with `@/avxto/AVXTOConf` by
 * hand if that ever changes; nothing enforces it automatically.
 */
import type { RegistryToken } from './types'
import staticRegistry from './registry.json'

export type { RegistryToken }

const REGISTRY: RegistryToken[] = staticRegistry as RegistryToken[]

/** Every entry in the registry, native asset included. */
export function getRegistry(): RegistryToken[] {
    return REGISTRY
}

/** The registry's entry for the chain's native asset (AVAX). */
export function getNativeRegistryEntry(): RegistryToken {
    // Present unconditionally — it's the first entry in registry.json — so
    // this is a real invariant, not a soft lookup that can come back empty.
    const entry = REGISTRY.find((t) => t.contractAddress === null)
    if (!entry) throw new Error('Token registry is missing its native AVAX entry.')
    return entry
}

function normalizeAddress(address: string): string {
    return address.trim().toLowerCase()
}

/**
 * Cyrillic and Greek letters that are visually indistinguishable from a
 * Latin one in most fonts — mapped back to that Latin letter. This is the
 * standard trick behind a token whose symbol *looks* like "AVAX" but is a
 * different string byte-for-byte, so a plain case-fold compare (what this
 * module used to do) never catches it: e.g. Cyrillic А (U+0410) reads
 * identically to Latin A but is a wholly different character.
 *
 * Not an exhaustive confusables table — this is a targeted list covering the
 * letters that actually appear in this registry's symbols (A, B, C, E, H, K,
 * M, N, O, P, S, T, X, Y, Z and lowercase equivalents), which is what a
 * lookalike-token deployer is working with anyway: they need the result to
 * still resemble a real symbol.
 */
const CONFUSABLE_TO_LATIN: Record<string, string> = {
    // All written as \u escapes rather than the literal characters, for the
    // same auditability reason as INVISIBLE_CHARS_RE above.
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



/**
 * Normalizes a reported token symbol/name before it's ever compared against
 * the registry: strips zero-width/invisible characters (the other classic
 * trick — "AVAX" plus an invisible code point still *renders* as "AVAX" but
 * fails a naive exact-match filter the opposite way, by never matching a
 * legitimate lookup either), then maps look-alike Cyrillic/Greek letters back
 * to Latin. Every symbol comparison in this module goes through this, not
 * just a `.toUpperCase()` — that was the actual gap: it made the check
 * case-insensitive but not script-insensitive.
 */
// Zero-width space/non-joiner/joiner, LTR/RTL marks, the bidi
// embedding/override range, word joiner, soft hyphen, and the
// zero-width no-break space (BOM) \u200b-\u200f \u202a-\u202e \u2060 \u00ad
// \ufeff. Written as \u escape sequences (verified below to be plain
// ASCII in this source file, not the literal characters) rather than
// pasting the invisible characters themselves, which would be
// impossible to verify by looking at them.
const INVISIBLE_CHARS_RE = /[\u200b-\u200f\u202a-\u202e\u2060\u00ad\ufeff]/g

function normalizeSymbol(s: string): string {
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
 * The registry entry for a contract address, or undefined if it isn't
 * registered. `chainId` should almost always be passed — omitting it matches
 * against any chain's entry, which is only correct for lookups that are
 * already known to be chain-scoped some other way.
 */
export function findRegistryToken(
    contractAddress: string,
    chainId?: number
): RegistryToken | undefined {
    if (!contractAddress) return undefined
    const target = normalizeAddress(contractAddress)
    return REGISTRY.find((t) => {
        if (!t.contractAddress) return false
        if (normalizeAddress(t.contractAddress) !== target) return false
        if (chainId !== undefined && t.chainId !== undefined && t.chainId !== chainId) return false
        return true
    })
}

/**
 * True when `symbol` matches a registry entry but `contractAddress` does not
 * match ANY registered contract for that symbol (on `chainId`, when given) —
 * i.e. this looks like a known token but isn't deployed where the real one
 * is. False whenever `symbol` isn't one the registry has an entry for at
 * all: an unrecognized token is not this function's concern, only a
 * misrepresented one is.
 *
 * This is the actual gate everywhere it's called — it deliberately does NOT
 * mean "not in the registry" (that would block every token the registry
 * happens not to list yet, which is not the intent; see the module doc
 * comment above).
 */
export function isSpoofedToken(symbol: string, contractAddress: string, chainId?: number): boolean {
    if (!contractAddress) return false
    const target = normalizeAddress(contractAddress)
    const normalizedSymbol = normalizeSymbol(symbol)
    const sameSymbol = REGISTRY.filter((t) => normalizeSymbol(t.symbol) === normalizedSymbol)
    if (sameSymbol.length === 0) return false

    const matchesAKnownAddress = sameSymbol.some((t) => {
        if (!t.contractAddress) return false // the native entry — never satisfied by a contract
        if (chainId !== undefined && t.chainId !== undefined && t.chainId !== chainId) return false
        return normalizeAddress(t.contractAddress) === target
    })
    return !matchesAKnownAddress
}

/**
 * True for any symbol that reads as "AVAX" regardless of case/whitespace —
 * used to reject tokens (X-chain ANTs, ERC20s, SDK-discovered assets — any of
 * them, registered or not) that aren't the actual native asset but are named
 * to look like it. Comparing name/symbol text is deliberately allowed to be
 * cheap and over-eager here: the cost of a false positive is an unrelated
 * token called "avax" failing to display, which is not a real product this
 * wallet needs to support; the cost of a false negative is a spoofed balance
 * next to the real one.
 */
export function isReservedNativeSymbol(symbolOrName: string): boolean {
    return normalizeSymbol(symbolOrName) === 'AVAX'
}
