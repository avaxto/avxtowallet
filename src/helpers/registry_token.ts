/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * "Is this contract one of the registry's pinned tokens?" — the positive
 * counterpart to `isSpoofedToken`, backing the green checkmark shown next to
 * registered tokens across the UI (see RegistryCheck.vue).
 *
 * Takes a raw address so every call site can use it regardless of which
 * token shape it holds. Hex addresses are checked against Avalanche's
 * registry (whose entries are chain-scoped) and the EVM registry for
 * `chainId`; base58 addresses are Solana mints, checked against Solana's.
 */
import type { PlatformTokenRegistryEntry } from '@/platforms/types'
import { findRegistryToken } from '@/platforms/avalanche/tokenRegistry'
import { tokenRegistryFor } from '@/evm/tokenRegistry'
import { getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { solanaTokenRegistry } from '@/solana/tokenRegistry'

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export function findRegistryEntry(
    address: string | null | undefined,
    chainId?: number
): PlatformTokenRegistryEntry | undefined {
    if (!address) return undefined
    const addr = address.trim()

    if (HEX_ADDRESS_RE.test(addr)) {
        const avalanche = findRegistryToken(addr, chainId)
        if (avalanche) return avalanche
        if (chainId === undefined) return undefined
        const network = getEvmNetworkByChainId(chainId)
        return network ? tokenRegistryFor(network).findToken(addr, chainId) : undefined
    }

    return solanaTokenRegistry.findToken(addr)
}

export function isRegistryToken(address: string | null | undefined, chainId?: number): boolean {
    return !!findRegistryEntry(address, chainId)
}

/**
 * `list` split into what `isVerified` accepts, then everything else. Stable:
 * each group keeps its incoming order (e.g. by balance), so this only lifts
 * verified tokens above the rest, never reshuffles either group.
 */
export function partitionVerified<T>(list: T[], isVerified: (item: T) => boolean): [T[], T[]] {
    const verified: T[] = []
    const rest: T[] = []
    for (const item of list) (isVerified(item) ? verified : rest).push(item)
    return [verified, rest]
}

/** `list` with verified items first — see `partitionVerified`. */
export function verifiedFirst<T>(list: T[], isVerified: (item: T) => boolean): T[] {
    const [verified, rest] = partitionVerified(list, isVerified)
    return [...verified, ...rest]
}
