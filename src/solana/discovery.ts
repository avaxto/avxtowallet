/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Finding which account a recovery phrase actually holds funds on.
 *
 * Solana never settled on one derivation path (see ./keys.ts), so a wallet
 * that assumes Phantom's `m/44'/501'/N'/0'` shows an empty account to anyone
 * whose phrase was set up under Ledger's `m/44'/501'/N'` — and vice versa. The
 * user has no way to tell that from "your wallet is empty", which is the worst
 * possible failure for a wallet import: it looks like lost funds.
 *
 * So instead of guessing, probe. Both path styles across the first few
 * accounts is 2xN addresses, which `getMultipleAccounts` answers in a single
 * RPC round-trip.
 *
 * Only public addresses are handled here — `deriveSolanaAddress` wipes the
 * derived private key before returning, so nothing in this module ever holds
 * key material.
 */
import { PublicKey } from '@solana/web3.js'
import Big from 'big.js'

import { LEDGER_PATH, PHANTOM_PATH, deriveSolanaAddress } from './keys'
import { SOL_DECIMALS, type SolanaNetwork } from './networks'
import { connectionFor, withRpcErrors } from './rpc'

/** How many accounts of each path style to probe. */
const ACCOUNTS_TO_SCAN = 5

export interface DiscoveredAccount {
    path: string
    address: string
    /** Scaled SOL balance. */
    balance: Big
    /** Which convention this path follows, for display. */
    style: 'phantom' | 'ledger'
    /** True when the account exists on chain at all (funded, or ever used). */
    exists: boolean
}

/** Every path this wallet will probe, in the order it prefers them. */
export function candidatePaths(): { path: string; style: 'phantom' | 'ledger' }[] {
    const paths: { path: string; style: 'phantom' | 'ledger' }[] = []
    for (let i = 0; i < ACCOUNTS_TO_SCAN; i++) {
        paths.push({ path: PHANTOM_PATH(i), style: 'phantom' })
    }
    for (let i = 0; i < ACCOUNTS_TO_SCAN; i++) {
        paths.push({ path: LEDGER_PATH(i), style: 'ledger' })
    }
    return paths
}

/**
 * Derives every candidate address and reports which hold SOL.
 *
 * Never throws for RPC failure — a phrase must still be importable with the
 * network down. On failure every candidate comes back with a zero balance and
 * `exists: false`, and the caller falls back to the default path.
 */
export async function discoverAccounts(
    bip39Seed: Uint8Array,
    network: SolanaNetwork
): Promise<DiscoveredAccount[]> {
    const candidates = candidatePaths()

    const derived = await Promise.all(
        candidates.map(async ({ path, style }) => ({
            path,
            style,
            address: await deriveSolanaAddress(bip39Seed, path),
        }))
    )

    let lamportsByIndex: (number | null)[] = derived.map(() => null)
    try {
        const connection = connectionFor(network)
        const infos = await withRpcErrors('Scanning accounts', () =>
            connection.getMultipleAccountsInfo(derived.map((d) => new PublicKey(d.address)))
        )
        lamportsByIndex = infos.map((info) => info?.lamports ?? 0)
    } catch (e) {
        // Deliberately swallowed — see the doc comment. Importing a phrase
        // must not depend on the network being reachable.
        console.warn('[solana/discovery] balance scan failed, using default path:', e)
    }

    return derived.map((d, i) => {
        const lamports = lamportsByIndex[i]
        return {
            ...d,
            exists: lamports !== null && lamports > 0,
            balance:
                lamports === null ? Big(0) : Big(lamports).div(Big(10).pow(SOL_DECIMALS)),
        }
    })
}

/**
 * The account to open a freshly-imported phrase on.
 *
 * Prefers the funded account with the largest balance — if a phrase has funds
 * anywhere, that is overwhelmingly the account the user means. Falls back to
 * Phantom's first account, which is the right default for a brand-new phrase
 * with no history and matches what every other wallet would show.
 */
export function pickBestAccount(accounts: DiscoveredAccount[]): DiscoveredAccount {
    const funded = accounts.filter((a) => a.exists && a.balance.gt(0))
    if (funded.length > 0) {
        return funded.reduce((best, a) => (a.balance.gt(best.balance) ? a : best))
    }
    const fallback = accounts.find((a) => a.path === PHANTOM_PATH(0))
    if (!fallback) {
        // candidatePaths() always includes it; this is a guard against a future
        // edit silently changing that.
        throw new Error('Account scan returned no default path.')
    }
    return fallback
}
