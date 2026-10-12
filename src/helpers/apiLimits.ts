/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * How many addresses each Avalanche API accepts in ONE call — measured
 * against the live endpoints (2026-10-12), not guessed — so address scans
 * can ask for as many as possible per request instead of flooding the
 * endpoint with small ones and getting the IP rate-limited.
 *
 *  - Node `avm.getUTXOs` / `platform.getUTXOs`: 1024 ("number of addresses
 *    given, 1025, exceeds maximum, 1024").
 *  - Node `platform.getStake`: 256 (AvalancheGo's maxGetStakeAddrs).
 *  - Glacier (address-list endpoints): 64 — 65+ is refused ("The number of
 *    addresses must be less than 64", though 64 itself is accepted), and
 *    long lists also hit its URL-size limit (HTTP 431).
 *
 * Glacier batches are additionally run at most GLACIER_CONCURRENCY at a time:
 * the per-call cap is fixed, so what trips its rate limit is a burst of many
 * parallel calls.
 */
export const NODE_MAX_UTXO_ADDRESSES = 1024
export const NODE_MAX_STAKE_ADDRESSES = 256
export const GLACIER_MAX_ADDRESSES = 64
export const GLACIER_CONCURRENCY = 2
