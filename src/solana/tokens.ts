/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Reading SOL and SPL token balances.
 *
 * Two token programs are queried, not one. The original SPL Token program and
 * Token-2022 are separate on-chain programs with separate account owners, and
 * `getParsedTokenAccountsByOwner` filters by exactly one of them — so querying
 * only the classic program silently omits every Token-2022 holding. That is not
 * a hypothetical: PYUSD, among others, is a Token-2022 mint.
 *
 * ## Why no token symbols are read from the chain
 *
 * A token account carries only `mint`, `owner` and `tokenAmount` — the symbol
 * and name live in separate Metaplex metadata, which this deliberately does
 * not fetch. That is a security property, not a gap:
 *
 * Minting an SPL token is permissionless and costs a fraction of a cent, and
 * its metadata symbol is entirely attacker-chosen. Airdropping a worthless
 * mint whose symbol reads "USDC" into thousands of wallets is a standard scam,
 * and it works precisely because wallets render that string. **This one never
 * does.** A symbol shown here comes from the pinned registry (see
 * ./tokenRegistry.ts) or is derived from the mint address itself — so an
 * impostor cannot present itself as a known token no matter what metadata it
 * publishes. Nothing needs to *detect* spoofing because nothing trusts the
 * attacker-controlled field in the first place.
 *
 * The cost is that a legitimate unregistered token shows as a shortened mint
 * rather than its name. That is the right trade for a wallet: an unrecognised
 * real token is a minor inconvenience, a convincingly-labelled fake is a loss.
 */
import Big from 'big.js'
import { PublicKey, type Connection } from '@solana/web3.js'

import { SOL_DECIMALS, type SolanaNetwork } from './networks'
import { connectionFor, withRpcErrors } from './rpc'
import { findSolanaToken } from './tokenRegistry'

/** The classic SPL Token program. */
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
/** Token-2022 ("Token Extensions"). A distinct program with its own accounts. */
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

export interface SolanaTokenBalance {
    /** The mint address — the token's unique id on Solana. */
    mint: string
    /** Symbol from the pinned registry, or a shortened mint when unregistered. */
    symbol: string
    name: string
    /** Decimals as reported by the chain for this mint — never from the registry. */
    decimals: number
    /** Scaled, human-readable amount. */
    amount: Big
    /** Raw integer amount, as a string (may exceed Number.MAX_SAFE_INTEGER). */
    rawAmount: string
    /** True when this mint sits behind the Token-2022 program. */
    isToken2022: boolean
    /**
     * True when the mint is NOT in the pinned registry, in which case `symbol`
     * is derived from the mint address rather than being a real ticker.
     *
     * Not an accusation — most legitimate tokens are unregistered — but the UI
     * says so plainly rather than presenting an unknown mint with the same
     * authority as USDC.
     */
    isUnverified: boolean
}

/** Native SOL balance, scaled. */
export async function readSolBalance(
    address: string,
    network: SolanaNetwork
): Promise<Big> {
    const connection = connectionFor(network)
    const lamports = await withRpcErrors('Reading SOL balance', () =>
        connection.getBalance(new PublicKey(address))
    )
    return Big(lamports).div(Big(10).pow(SOL_DECIMALS))
}

/**
 * Every SPL holding for an address, across both token programs.
 *
 * Zero-balance accounts are filtered out: a wallet that has ever interacted
 * with a token keeps its (rent-paying) token account forever, so including
 * them would fill the portfolio with dust entries for tokens long since sold.
 */
export async function readSplBalances(
    address: string,
    network: SolanaNetwork
): Promise<SolanaTokenBalance[]> {
    const connection = connectionFor(network)
    const owner = new PublicKey(address)

    const [classic, token2022] = await Promise.all([
        readForProgram(connection, owner, TOKEN_PROGRAM_ID, false),
        readForProgram(connection, owner, TOKEN_2022_PROGRAM_ID, true),
    ])

    return [...classic, ...token2022].sort((a, b) => {
        // Registered tokens first, then by descending balance — an airdropped
        // scam token should never outrank a real holding in the list.
        if (a.isUnverified !== b.isUnverified) return a.isUnverified ? 1 : -1
        return b.amount.cmp(a.amount)
    })
}

async function readForProgram(
    connection: Connection,
    owner: PublicKey,
    programId: PublicKey,
    isToken2022: boolean
): Promise<SolanaTokenBalance[]> {
    const label = isToken2022 ? 'Reading Token-2022 balances' : 'Reading SPL token balances'
    const res = await withRpcErrors(label, () =>
        connection.getParsedTokenAccountsByOwner(owner, { programId })
    )

    const out: SolanaTokenBalance[] = []
    for (const { account } of res.value) {
        // `parsed` is absent if the RPC could not decode the account — skip
        // rather than guessing at a layout.
        const info = (account.data as any)?.parsed?.info
        if (!info?.mint || !info?.tokenAmount) continue

        const rawAmount: string = String(info.tokenAmount.amount ?? '0')
        if (rawAmount === '0') continue

        // Decimals come from the chain's own view of the mint, never from the
        // pinned registry — a stale registry entry must not misscale a balance.
        const decimals: number = Number(info.tokenAmount.decimals ?? 0)
        const mint: string = String(info.mint)

        // Symbol and name come from the pinned registry or from the mint
        // address — never from chain metadata. See the module note.
        const entry = findSolanaToken(mint)

        out.push({
            mint,
            symbol: entry?.symbol ?? shortenMint(mint),
            name: entry?.name ?? 'Unrecognised token',
            decimals,
            amount: Big(rawAmount).div(Big(10).pow(decimals)),
            rawAmount,
            isToken2022,
            isUnverified: !entry,
        })
    }
    return out
}

/** `EPjFWdd5…yTDt1v` — enough to recognise, short enough to fit a table cell. */
export function shortenMint(mint: string): string {
    return mint.length <= 12 ? mint : `${mint.slice(0, 6)}…${mint.slice(-4)}`
}
