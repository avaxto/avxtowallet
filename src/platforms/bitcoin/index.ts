/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { createPlannedPlatform } from '../plannedPlatform'

/**
 * Not yet implemented. Bitcoin's UTXO model is the closest conceptual match to
 * what the X-Chain code already understands, but it still needs its own address
 * derivation, UTXO selection, fee estimation and signing.
 */
export const bitcoinPlatform = createPlannedPlatform({
    id: 'bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    description: 'Native BTC.',
})

export default bitcoinPlatform
