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
        // In a production build a duplicate id is a genuine authoring mistake
        // (two platform folders declaring the same id within one execution of
        // ./index.ts) and must fail loudly — a duplicate would make
        // `getPlatform` ambiguous and silently shadow one implementation.
        //
        // Outside one it can ALSO mean something harmless: `./index.ts` has
        // top-level side effects (these `registerPlatform` calls), and this
        // module — the one actually holding `registry`, the singleton these
        // calls mutate — is not itself what changed, so it is not always part
        // of the invalidated subgraph. Editing any file that imports
        // `@/platforms` for the first time (adding the import itself is
        // enough) can make Vite re-run `./index.ts` against this SAME,
        // still-populated `registry`. Re-registering the identical platform
        // object there is not a mistake, just Vite catching up — overwrite
        // instead of throwing.
        //
        // Tested against `process.env.NODE_ENV` rather than `import.meta.hot`,
        // which is what this used to read. Both are statically replaced by
        // Vite and both leave production throwing, but `import.meta` is a
        // syntax error once compiled to CommonJS — so its mere presence made
        // this module, and therefore every module reaching the platform
        // registry (all of platforms/store.ts included), impossible to load
        // under Jest. The widened condition only ever loosens a
        // developer-build assertion.
        if (process.env.NODE_ENV !== 'production') {
            registry.set(id, platform)
            return
        }
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
