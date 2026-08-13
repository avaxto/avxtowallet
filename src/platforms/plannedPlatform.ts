/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import type { Platform, PlatformCapabilities, PlatformDescriptor } from './types'

/**
 * Builds a not-yet-implemented platform entry.
 *
 * These exist so the platform picker can show what is coming without pretending
 * it works: `status: 'planned'` plus an empty `accessMethods` list means the
 * registry reports them unavailable and the UI renders them disabled, so there
 * is no path to "logging in" to one. Replace the stub in the platform's folder
 * with a real implementation to turn it on — nothing else needs to change.
 *
 * `capabilities` are all false here on purpose: a planned platform must never
 * cause a capability-gated feature to render.
 */
const NO_CAPABILITIES: PlatformCapabilities = {
    send: false,
    receive: false,
    stake: false,
    swap: false,
    crossChain: false,
    signMessage: false,
    collectibles: false,
    offlineSigning: false,
}

export function createPlannedPlatform(
    descriptor: Omit<PlatformDescriptor, 'status'>
): Platform {
    return {
        descriptor: { ...descriptor, status: 'planned' },
        capabilities: { ...NO_CAPABILITIES },
        accessMethods: [],
        getActiveWallet: () => null,
        logout: async () => {
            /* nothing to disconnect */
        },
    }
}
