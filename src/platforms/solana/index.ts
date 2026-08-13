/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { createPlannedPlatform } from '../plannedPlatform'

/**
 * Not yet implemented. Solana's account model differs substantially from both
 * Avalanche's UTXO chains and the EVM, so this needs its own address derivation,
 * transaction building and signing rather than reusing existing code.
 */
export const solanaPlatform = createPlannedPlatform({
    id: 'solana',
    name: 'Solana',
    symbol: 'SOL',
    description: 'SOL and SPL tokens.',
})

export default solanaPlatform
