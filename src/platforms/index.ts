/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Platform registration.
 *
 * Importing this module registers every platform the build ships with. It is
 * imported once from main.ts, before the app mounts, so the registry is
 * populated by the time any store or view reads from it.
 *
 * To add a platform: create `platforms/<id>/index.ts` exporting a `Platform`,
 * then add it to the list below. See ./README.md.
 */
import { registerPlatform } from './registry'

import { avalanchePlatform } from './avalanche'
import { bitcoinPlatform } from './bitcoin'
import { evmPlatform } from './evm'
import { solanaPlatform } from './solana'

registerPlatform(avalanchePlatform)
// One platform for every EVM chain — it differentiates by network, not by
// platform, so a new chain is a row in src/evm/networks.json rather than a new
// folder here. This supersedes the former per-chain `ethereum` and
// `robinhood` platforms; both of those chains are entries in that registry now.
registerPlatform(evmPlatform)
registerPlatform(solanaPlatform)
registerPlatform(bitcoinPlatform)

export * from './types'
export * from './registry'
export { useActivePlatformStore } from './store'
export type { MnemonicUnlockResult } from './store'
