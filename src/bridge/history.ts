/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bridge transfers this browser started, so one can be tracked and — for
 * routes that need it — claimed on the destination later, even after a reload
 * or from a different session than the one that sent it. Kept per browser,
 * newest first, capped so it never grows without bound.
 */
import { ref } from 'vue'

import type { BridgeTransfer } from './types'

const STORAGE_KEY = 'bridge_transfers_v1'
const MAX_KEPT = 200

function read(): BridgeTransfer[] {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
        return Array.isArray(raw) ? raw.filter((t) => t && typeof t.id === 'string') : []
    } catch {
        return []
    }
}

/** Reactive list, newest first. */
export const bridgeTransfers = ref<BridgeTransfer[]>(read())

function persist(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(bridgeTransfers.value))
    } catch {
        /* storage full or unavailable — the in-memory list still works this session */
    }
}

/** Adds or replaces a transfer by id, keeping newest first. */
export function saveTransfer(t: BridgeTransfer): void {
    const rest = bridgeTransfers.value.filter((x) => x.id !== t.id)
    bridgeTransfers.value = [t, ...rest].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_KEPT)
    persist()
}

export function removeTransfer(id: string): void {
    bridgeTransfers.value = bridgeTransfers.value.filter((x) => x.id !== id)
    persist()
}

export function getTransfer(id: string): BridgeTransfer | undefined {
    return bridgeTransfers.value.find((x) => x.id === id)
}
