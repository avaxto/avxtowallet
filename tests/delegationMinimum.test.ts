/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The minimum delegation period the wallet enforces must be the network's own:
 * enforcing less let users build delegations the network then rejected with
 * "staking period is too short". Mainnet delegators need 14 days (validators
 * can go to 48 hours — that is what the old constant wrongly applied); Fuji
 * allows 24 hours. See constants.ts for how those were measured.
 */
import {
    DAY_MS,
    durationLabel,
    minDelegationDurationMs,
    MIN_DELEGATION_DURATION_MAINNET_MS,
    MIN_DELEGATION_DURATION_TESTNET_MS,
} from '@/constants'

it('is 14 days on mainnet and 24 hours on Fuji', () => {
    expect(minDelegationDurationMs(1)).toBe(14 * DAY_MS)
    expect(minDelegationDurationMs(5)).toBe(DAY_MS)
    expect(MIN_DELEGATION_DURATION_MAINNET_MS).toBe(14 * DAY_MS)
    expect(MIN_DELEGATION_DURATION_TESTNET_MS).toBe(DAY_MS)
})

it('never lets a mainnet delegation under 14 days through', () => {
    // The periods that failed before the fix: anything from 48 hours up to 14 days.
    for (const days of [2, 7, 13.99]) {
        expect(days * DAY_MS < minDelegationDurationMs(1)).toBe(true)
    }
})

it('labels the minimum for messages', () => {
    expect(durationLabel(14 * DAY_MS)).toBe('14 days')
    expect(durationLabel(DAY_MS)).toBe('24 hours')
    expect(durationLabel(48 * 3_600_000)).toBe('2 days')
})
