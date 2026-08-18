/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The EVM platform's token registry, for whichever network is currently
 * active.
 *
 * The per-network builder itself lives in `@/evm/tokenRegistry` — it is pure
 * data and must not depend on platform session state, or every data module
 * that wants a registry would transitively import this store and, through it,
 * the router. This file is only the thin "active network" wrapper.
 */
import type { PlatformTokenRegistry } from '../types'
import { tokenRegistryFor } from '@/evm/tokenRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'
import { peekActiveNetwork } from './store'

export { tokenRegistryFor }

/** The registry for the active network — what `evmPlatform.tokenRegistry` exposes. */
export function activeEvmTokenRegistry(): PlatformTokenRegistry {
    // peekActiveNetwork always resolves to a real network (it falls back to
    // the default), so there is no null case to handle here.
    return tokenRegistryFor(peekActiveNetwork() as EvmNetwork)
}
