/**
 * Helpers for handling secret bytes in memory.
 *
 * The rule this module exists to support: secret material must live in
 * `Uint8Array`, never in a JS string. Strings are immutable and interned by the
 * engine — assigning `s = ''` drops a reference but leaves the original bytes
 * on the heap until GC decides otherwise, so a secret that is ever a string can
 * never be reliably erased.
 */

/**
 * Overwrites a buffer in place. Random-fills first, then zeroes, so the result
 * is neither the secret nor a recognisably-blank page an allocator might
 * dedupe. Mirrors what hdkey's own wipePrivateData does.
 *
 * Best effort only: the JS engine may have relocated the backing store during
 * GC, leaving a stale copy at the old address that nothing can reach to erase.
 */
export function wipe(buf: Uint8Array | null | undefined): void {
    if (!buf || buf.length === 0) return
    try {
        crypto.getRandomValues(buf)
    } catch {
        // getRandomValues caps at 65536 bytes per call, and is unavailable in
        // some contexts. Zeroing alone is still worth doing.
    }
    buf.fill(0)
}

/** Wipes several buffers, tolerating nulls. Safe to call from a finally. */
export function wipeAll(...bufs: (Uint8Array | null | undefined)[]): void {
    for (const b of bufs) wipe(b)
}

/**
 * Encodes a string to bytes for storage as a secret.
 *
 * Note the caller's original string is unreachable for wiping — this is the
 * irreducible boundary of the no-strings rule. Use it as close to the point of
 * entry as possible and let the string go out of scope immediately.
 */
export function secretFromString(s: string): Uint8Array {
    return new TextEncoder().encode(s)
}

/**
 * Decodes secret bytes back to a string, for the APIs that only accept strings
 * (bip39, the Avalanche SDK). The returned string cannot be wiped, so keep its
 * lifetime to a single expression wherever possible.
 */
export function secretToString(b: Uint8Array): string {
    return new TextDecoder().decode(b)
}
