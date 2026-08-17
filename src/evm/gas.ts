/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Per-network gas pricing.
 *
 * There are two web3 singletons in this app, and gas is the reason that
 * matters. `GasHelper.getAdjustedGasPrice()` reads the *vendored SDK's*
 * instance (`avalanche-wallet-sdk/Network/network.ts`), not the one in
 * `@/evm` — so re-pointing only the latter would leave every gas quote in the
 * wallet still coming from Avalanche, on every chain. Roughly eight UI call
 * sites go through `GasHelper`.
 *
 * This façade is the single place new EVM code asks for a gas price. Avalanche
 * networks delegate to the existing `GasHelper` so their behaviour is
 * unchanged bit-for-bit; any other network is quoted from its own RPC using
 * the same +25% adjustment and the same ceiling.
 *
 * New multi-network code must not call `GasHelper` directly — that is what
 * silently pins a foreign chain's gas to Avalanche's.
 */
import { BN } from '@/avalanche'
import { getAdjustedGasPrice as getAvalancheAdjustedGasPrice } from '@/avalanche-wallet-sdk/helpers/gas_helper'

import type { EvmNetwork } from './networkRegistry'
import { web3For } from './providers'

/** Mirrors `MAX_GAS` in the SDK's gas_helper — 1000 gwei. */
const MAX_GAS = new BN('1000000000000')

/** Mirrors `adjustValue` in the SDK's gas_helper. */
function adjustValue(val: BN, perc: number): BN {
    const padAmt = val.div(new BN(100)).mul(new BN(perc))
    return val.add(padAmt)
}

const AVALANCHE_CHAIN_IDS = new Set([43114, 43113])

/**
 * Current gas price for `network`, in wei, already padded by 25% and capped —
 * the same shape `GasHelper.getAdjustedGasPrice()` returns, so this is a
 * drop-in for the value the existing send forms already pass around.
 */
export async function gasFor(network: EvmNetwork): Promise<BN> {
    // Avalanche keeps its existing path: the SDK instance is the one the rest
    // of the C-Chain flow (base fee, export/import gas) is already consistent
    // with, and diverging here would be a behaviour change on the working
    // wallet for no benefit.
    if (AVALANCHE_CHAIN_IDS.has(network.evmChainId)) {
        return await getAvalancheAdjustedGasPrice()
    }

    const raw = await web3For(network).eth.getGasPrice()
    const adjusted = adjustValue(new BN(raw.toString()), 25)
    return BN.min(adjusted, MAX_GAS)
}
