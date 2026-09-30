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

/** "14 days", "24 hours" — for messages that state the minimum. */
export function durationLabel(ms: number): string {
    if (ms % DAY_MS === 0 && ms >= 2 * DAY_MS) return `${ms / DAY_MS} days`
    const hours = Math.round(ms / HOUR_MS)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export type ChainIdType = 'X' | 'P' | 'C'
