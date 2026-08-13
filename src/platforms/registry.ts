/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import type { Platform, PlatformId } from './types'

/**
 * Registry of platforms the build knows about.
 *
 * Registration is explicit (see ./index.ts) rather than glob-based so that
 * bundling stays static and a half-finished platform folder can't accidentally
 * appear in the UI.
 */
const registry = new Map<PlatformId, Platform>()

/** The platform selected when the user has never chosen one. */
export const DEFAULT_PLATFORM_ID: PlatformId = 'avalanche'

export function registerPlatform(platform: Platform): void {
    const id = platform.descriptor.id
    if (registry.has(id)) {
        // A duplicate id would make `getPlatform` ambiguous and silently shadow
        // one implementation, so fail loudly at startup instead.
        throw new Error(`[platforms] Duplicate platform id registered: ${id}`)
    }
    registry.set(id, platform)
}

export function getPlatform(id: PlatformId): Platform | undefined {
    return registry.get(id)
}

/** Every registered platform, including `planned` ones. */
export function listPlatforms(): Platform[] {
    return Array.from(registry.values())
}

/** Only platforms that can actually be logged into. */
export function listAvailablePlatforms(): Platform[] {
    return listPlatforms().filter(
        (p) => p.descriptor.status === 'available' && p.accessMethods.length > 0
    )
}

export function isPlatformAvailable(id: PlatformId): boolean {
    const p = registry.get(id)
    return !!p && p.descriptor.status === 'available' && p.accessMethods.length > 0
}
