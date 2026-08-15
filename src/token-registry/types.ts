/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * A single entry in the token registry — the wallet's own allowlist of tokens
 * it will show. See ./index.ts for what "will show" means in practice.
 */
export interface RegistryToken {
    /**
     * The chain's native asset (AVAX) is not a contract — it has no address to
     * register. Every other entry must have one; `null` is reserved for the
     * native entry specifically, not a placeholder for "unknown".
     */
    contractAddress: string | null
    name: string
    description: string
    symbol: string
    websiteUrl: string
    /**
     * EVM chain id the contract is deployed on. Omitted only for the native
     * entry (which has no contract to be deployed anywhere) — every ERC20
     * entry must specify one, since the same address can mean a different,
     * unrelated contract on a different chain.
     */
    chainId?: number
}
