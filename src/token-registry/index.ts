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
    const sameSymbol = REGISTRY.filter(
        (t) => t.symbol.trim().toUpperCase() === symbol.trim().toUpperCase()
    )
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
    return symbolOrName.trim().toUpperCase() === 'AVAX'
}
