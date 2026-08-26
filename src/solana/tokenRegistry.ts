/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana's pinned-mint allowlist.
 *
 * Why this matters more on Solana than elsewhere: creating an SPL mint is
 * permissionless and costs a fraction of a cent, and a token's on-chain
 * metadata symbol is entirely attacker-chosen. Airdropping a worthless mint
 * whose symbol reads "USDC" into thousands of wallets is a standard, cheap
 * scam, and the receiving wallet is the only thing positioned to notice. See
 * `PlatformTokenRegistry` in platforms/types.ts for the general contract.
 *
 * **Addresses are compared case-sensitively** (`base58`, not `hex`). Solana
 * addresses are base58 — case is significant, and folding it would let a
 * case-variant of a registered mint pass as the real one.
 *
 * This list is deliberately short and every entry was verified against
 * mainnet (account exists, is of type `mint`, and the decimals recorded here
 * are the ones the chain reports) rather than transcribed from memory or a
 * third-party list. An entry that is *wrong* is worse than an entry that is
 * absent: a bad address both fails to flag the impostor and flags the genuine
 * token as an impostor. Unregistered mints are simply not cross-checked —
 * they are not hidden or blocked.
 *
 * `decimals` is recorded for reference only. Balances always use the decimals
 * the RPC reports for the actual mint (see ./tokens.ts) — never a value from
 * this file — so a stale entry here can never misscale an amount.
 */
import type { PlatformTokenRegistry, PlatformTokenRegistryEntry } from '@/platforms/types'
import { createTokenRegistry } from '@/platforms/tokenRegistryHelpers'

export interface SolanaTokenEntry extends PlatformTokenRegistryEntry {
    /** Verified on-chain mint decimals. Reference only — see the module note. */
    decimals: number
}

/**
 * Verified 2026-08-26 against api.mainnet-beta.solana.com via
 * `getAccountInfo(..., jsonParsed)`: each is a live account whose parsed type
 * is `mint`, with the decimals shown.
 *
 * Mainnet only. The registry is not consulted on devnet/testnet, where these
 * mints do not exist and test tokens are expected to be unrecognised anyway.
 */
const SOLANA_TOKENS: SolanaTokenEntry[] = [
    {
        contractAddress: null, // native SOL is not a mint
        name: 'Solana',
        symbol: 'SOL',
        decimals: 9,
        description: 'The native asset of the Solana network.',
        websiteUrl: 'https://solana.com',
    },
    {
        contractAddress: 'So11111111111111111111111111111111111111112',
        name: 'Wrapped SOL',
        symbol: 'wSOL',
        decimals: 9,
        description: 'SOL wrapped as an SPL token, used by programs that require one.',
        websiteUrl: 'https://solana.com',
    },
    {
        contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        name: 'USD Coin',
        symbol: 'USDC',
        decimals: 6,
        description: 'Circle USD stablecoin on Solana.',
        websiteUrl: 'https://www.circle.com/usdc',
    },
    {
        contractAddress: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
        description: 'Tether USD stablecoin on Solana.',
        websiteUrl: 'https://tether.to',
    },
    {
        // Token-2022 program mint, not the classic SPL token program.
        contractAddress: '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo',
        name: 'PayPal USD',
        symbol: 'PYUSD',
        decimals: 6,
        description: 'PayPal USD stablecoin on Solana (Token-2022).',
        websiteUrl: 'https://www.paypal.com/pyusd',
    },
    {
        contractAddress: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        name: 'Bonk',
        symbol: 'BONK',
        decimals: 5,
        description: 'Community memecoin on Solana.',
        websiteUrl: 'https://bonkcoin.com',
    },
    {
        contractAddress: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
        name: 'Jupiter',
        symbol: 'JUP',
        decimals: 6,
        description: 'Governance token of the Jupiter aggregator.',
        websiteUrl: 'https://jup.ag',
    },
    {
        contractAddress: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',
        name: 'Jito',
        symbol: 'JTO',
        decimals: 9,
        description: 'Governance token of the Jito network.',
        websiteUrl: 'https://www.jito.network',
    },
    {
        contractAddress: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
        name: 'Jito Staked SOL',
        symbol: 'JitoSOL',
        decimals: 9,
        description: 'Liquid staking token representing staked SOL via Jito.',
        websiteUrl: 'https://www.jito.network',
    },
    {
        contractAddress: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
        name: 'Marinade Staked SOL',
        symbol: 'mSOL',
        decimals: 9,
        description: 'Liquid staking token representing staked SOL via Marinade.',
        websiteUrl: 'https://marinade.finance',
    },
    {
        contractAddress: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
        name: 'Raydium',
        symbol: 'RAY',
        decimals: 6,
        description: 'Governance token of the Raydium AMM.',
        websiteUrl: 'https://raydium.io',
    },
]

/** Base58 comparison — see the module note on why this must not case-fold. */
export const solanaTokenRegistry: PlatformTokenRegistry = createTokenRegistry(
    SOLANA_TOKENS,
    'base58'
)

/** Registry entry for a mint, or undefined when it isn't one we pin. */
export function findSolanaToken(mint: string): SolanaTokenEntry | undefined {
    return SOLANA_TOKENS.find((t) => t.contractAddress === mint)
}

export { SOLANA_TOKENS }
