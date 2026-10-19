export const MINUTE_MS = 60000
export const HOUR_MS = MINUTE_MS * 60
export const DAY_MS = HOUR_MS * 24

/**
 * Minimum P-Chain delegation period, by network.
 *
 * Measured from live data (2026-09-30) rather than assumed: across ~20,000
 * active mainnet delegations — ~18,000 of them started in the last 30 days —
 * the shortest period is 14.001 days, while mainnet validators run as short as
 * 2 days. So the Helicon upgrade lowered the minimum to 48 hours for
 * *validators* only; *delegators* still need 14 days, and anything shorter is
 * rejected as "staking period is too short". Fuji delegations run as short as
 * ~1 day. The period counts from when the network accepts the transaction.
 */
export const MIN_DELEGATION_DURATION_MAINNET_MS = DAY_MS * 14
export const MIN_DELEGATION_DURATION_TESTNET_MS = DAY_MS

const MAINNET_NETWORK_ID = 1

export function minDelegationDurationMs(networkId: number): number {
    return networkId === MAINNET_NETWORK_ID ? MIN_DELEGATION_DURATION_MAINNET_MS : MIN_DELEGATION_DURATION_TESTNET_MS
}

/**
 * Minimum Primary Network *validator* period since the Helicon upgrade
 * (mainnet, 2026-09-22): 48 hours on mainnet (2 weeks before), 12 hours on
 * Fuji (24 before). See build.avax.network → "How to Stake". A validator
 * staking under the delegation minimum can't receive delegations.
 */
export const MIN_VALIDATION_DURATION_MAINNET_MS = HOUR_MS * 48
export const MIN_VALIDATION_DURATION_TESTNET_MS = HOUR_MS * 12

export function minValidationDurationMs(networkId: number): number {
    return networkId === MAINNET_NETWORK_ID ? MIN_VALIDATION_DURATION_MAINNET_MS : MIN_VALIDATION_DURATION_TESTNET_MS
}

/** Longest stake, validator or delegator: one year, counted from acceptance. */
export const MAX_STAKE_DURATION_MS = DAY_MS * 365

/**
 * Room for the time between pressing Send and the P-Chain accepting the
 * transaction. Since Durango a stake's period counts from acceptance, so an
 * end date picked against "now" must leave this much slack at both limits.
 */
export const STAKE_ACCEPTANCE_MARGIN_MS = MINUTE_MS * 15

/** The latest end date the P-Chain will accept for a stake sent now. */
export function maxStakeEnd(now = Date.now()): number {
    return now + MAX_STAKE_DURATION_MS - STAKE_ACCEPTANCE_MARGIN_MS
}

/** The earliest end date that still meets `minDurationMs` once the stake is accepted. */
export function minStakeEnd(minDurationMs: number, now = Date.now()): number {
    return now + minDurationMs + STAKE_ACCEPTANCE_MARGIN_MS
}

/** "14 days", "24 hours" — for messages that state the minimum. */
export function durationLabel(ms: number): string {
    if (ms % DAY_MS === 0 && ms >= 2 * DAY_MS) return `${ms / DAY_MS} days`
    const hours = Math.round(ms / HOUR_MS)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export type ChainIdType = 'X' | 'P' | 'C'
