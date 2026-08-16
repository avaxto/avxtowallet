/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Avalanche's token registry — the platform's pinned addresses for a handful
 * of known token symbols, used to catch impostors WITHOUT restricting what
 * the wallet can otherwise show.
 *
 * Lives under platforms/avalanche/ (not a top-level, platform-agnostic
 * module) because the registry is inherently per-platform data: a contract
 * address only means something within one platform's chain(s), and a
 * different platform (Robinhood Chain, a future Ethereum/Solana/Bitcoin
 * platform) needs its own registry with its own entries — see
 * `PlatformTokenRegistry` in platforms/types.ts for the shape every
 * platform's registry implements, and `avalancheTokenRegistry` at the bottom
 * of this file for how this one is exposed as `avalanchePlatform.
 * tokenRegistry`. The Avalanche-specific call sites (stores/assets.ts,
 * stores/cChainSdkAssets.ts, js/ArenaSwap.ts, AddERC20TokenModal.vue) import
 * the named functions below directly instead of going through that, since
 * those files only ever run in an Avalanche context regardless.
 *
 * The actual matching algorithm (homoglyph-normalized symbol comparison,
 * address comparison, the spoof/reserved-symbol rules) lives in
 * `../../tokenRegistryHelpers` and is shared by every platform's registry —
 * see that module's doc comment for why. This file is just Avalanche's DATA
 * (./registry.json) plus this thin wrapper of named exports.
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
import { createTokenRegistry } from '@/platforms/tokenRegistryHelpers'
import staticRegistry from './registry.json'

export type { RegistryToken }

const REGISTRY: RegistryToken[] = staticRegistry as RegistryToken[]

/**
 * This registry as a `PlatformTokenRegistry` — what `platforms/avalanche/
 * index.ts` puts on `avalanchePlatform.tokenRegistry`, so it's reachable
 * generically (`activePlatform.tokenRegistry`) as well as through the named
 * functions below, which the existing Avalanche-specific call sites
 * (stores/assets.ts, stores/cChainSdkAssets.ts, js/ArenaSwap.ts,
 * AddERC20TokenModal.vue) import directly — those files only ever run in an
 * Avalanche context anyway, so there's no reason to route them through a
 * platform-store lookup at runtime.
 */
export const avalancheTokenRegistry = createTokenRegistry(REGISTRY)

/** Every entry in the registry, native asset included. */
export function getRegistry(): RegistryToken[] {
    return avalancheTokenRegistry.getAll()
}

/** The registry's entry for the chain's native asset (AVAX). */
export function getNativeRegistryEntry(): RegistryToken {
    return avalancheTokenRegistry.getNativeEntry()
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
    return avalancheTokenRegistry.findToken(contractAddress, chainId)
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
    return avalancheTokenRegistry.isSpoofedToken(symbol, contractAddress, chainId)
}

/**
 * True for any symbol that reads as "AVAX" regardless of case/whitespace/
 * homoglyph — used to reject tokens (X-chain ANTs, ERC20s, SDK-discovered
 * assets — any of them, registered or not) that aren't the actual native
 * asset but are named to look like it. Comparing name/symbol text is
 * deliberately allowed to be cheap and over-eager here: the cost of a false
 * positive is an unrelated token called "avax" failing to display, which is
 * not a real product this wallet needs to support; the cost of a false
 * negative is a spoofed balance next to the real one.
 */
export function isReservedNativeSymbol(symbolOrName: string): boolean {
    return avalancheTokenRegistry.isReservedNativeSymbol(symbolOrName)
}
