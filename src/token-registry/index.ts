/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Token registry — the wallet's own allowlist of tokens it will ever display.
 *
 * This exists because every other source of "what token is this" in the app
 * is untrusted input: a remote token-list URL the user can add, live
 * `symbol()`/`name()` calls against an arbitrary contract (which return
 * whatever that contract's author wrote — nothing stops a malicious ERC20
 * from claiming its symbol is "AVAX"), and the Glacier/chainkit SDK's
 * auto-discovery of anything the connected address has ever touched. None of
 * that is a source of truth about what a token actually is.
 *
 * The registry is queried FIRST, everywhere a token would be displayed:
 *  - a contract address that has no matching entry (for the network in
 *    question) is not shown, full stop — not in the portfolio, not in the
 *    send/swap pickers, not addable via "Manually Add Token" or a custom
 *    token-list URL.
 *  - for an address that DOES match, the registry's own name/symbol/
 *    description win over whatever the token list or the live contract call
 *    reported — so a compromised or misconfigured contract can't relabel
 *    itself as something it isn't after being registered.
 *  - "AVAX" is reserved for the platform's actual native asset. Nothing else
 *    is allowed to use that symbol anywhere in the UI, registered or not —
 *    see `isReservedNativeSymbol`.
 *
 * See ./registry.json for the data and ./types.ts for the entry shape. AVXTO
 * (this app's own token) is merged in from `@/avxto/AVXTOConf` rather than
 * duplicated in the JSON, so its contract addresses can never drift out of
 * sync with the ones the rest of the app actually queries balances against.
 */
import type { RegistryToken } from './types'
import staticRegistry from './registry.json'
import {
    AVXTO_CONTRACT_ADDRESS,
    AVXTO_NAME,
    AVXTO_SYMBOL,
    TESTNET_AVXTO_CONTRACT_ADDRESS,
    TESTNET_AVXTO_NAME,
    TESTNET_AVXTO_SYMBOL,
} from '@/avxto/AVXTOConf'

export type { RegistryToken }

const AVALANCHE_MAINNET_CHAIN_ID = 43114
const AVALANCHE_FUJI_CHAIN_ID = 43113

const avxtoEntries: RegistryToken[] = [
    {
        contractAddress: AVXTO_CONTRACT_ADDRESS,
        chainId: AVALANCHE_MAINNET_CHAIN_ID,
        name: AVXTO_NAME,
        symbol: AVXTO_SYMBOL,
        description: "AVXTO Wallet's own utility token on the Avalanche C-Chain.",
        websiteUrl: `https://dexscreener.com/avalanche/${AVXTO_CONTRACT_ADDRESS}`,
    },
    {
        contractAddress: TESTNET_AVXTO_CONTRACT_ADDRESS,
        chainId: AVALANCHE_FUJI_CHAIN_ID,
        name: TESTNET_AVXTO_NAME,
        symbol: TESTNET_AVXTO_SYMBOL,
        description: "AVXTO Wallet's Fuji testnet counterpart to AVXTO, for development and testing.",
        websiteUrl: `https://dexscreener.com/avalanche-fuji/${TESTNET_AVXTO_CONTRACT_ADDRESS}`,
    },
]

const REGISTRY: RegistryToken[] = [...(staticRegistry as RegistryToken[]), ...avxtoEntries]

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

/** Whether a contract address is registered for the given chain. */
export function isRegisteredContract(contractAddress: string, chainId?: number): boolean {
    return findRegistryToken(contractAddress, chainId) !== undefined
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
