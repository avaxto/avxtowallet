/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import type { PlatformTokenRegistryEntry } from '@/platforms/types'

/**
 * A single entry in Avalanche's token registry.
 *
 * A plain alias of the platform-level `PlatformTokenRegistryEntry` shape
 * (contractAddress/name/description/symbol/websiteUrl/chainId — see there
 * for field-by-field docs) rather than its own separate-but-identical
 * interface: this registry IS that interface's Avalanche implementation, so
 * the type relationship is explicit instead of two shapes just happening to
 * line up structurally.
 */
export type RegistryToken = PlatformTokenRegistryEntry
