/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { ChainIdType } from '@/constants'

/**
 * Offline signing: sign a transaction but hold it instead of broadcasting.
 *
 * The signed bytes are exported as base64 for the user to copy and later submit
 * from /wallet/broadcast (or anywhere else). Interception happens at the four
 * broadcast primitives — issueX/issueP/issueC in helpers/issueTx.ts and
 * broadcastEvm in helpers/broadcastEvm.ts — so every operation that ends in a
 * broadcast is covered without touching each of the ~20 sign-then-issue sites.
 *
 * Note /wallet/broadcast calls the chain APIs directly rather than through
 * those helpers, so it is never intercepted by its own feature.
 */

/** Two incompatible signed-transaction families exist in this app. */
export type SignedTxFamily =
    /** X/P/C atomic txs — submitted with avm|pChain|cChain.issueTx. */
    | 'avalanche'
    /** C-chain EVM txs — submitted with web3.eth.sendSignedTransaction. */
    | 'evm'

export interface SignedTxRecord {
    id: string
    /** Human description of what was signed, e.g. "Send 1.5 AVAX on X-Chain". */
    label: string
    family: SignedTxFamily
    /** Destination chain. Always 'C' for the evm family. */
    chain: ChainIdType
    /** The signed transaction, base64 encoded. */
    base64: string
    createdAt: number
}

/**
 * Returned in place of a transaction ID when a broadcast was intercepted.
 * Callers that display or poll a returned id should check isOfflineTxId first.
 */
export const OFFLINE_TX_ID = 'offline-signed'

export function isOfflineTxId(txId: string | null | undefined): boolean {
    return typeof txId === 'string' && txId.startsWith(OFFLINE_TX_ID)
}

const STORAGE_KEY = 'offlineSigningEnabled'

export const useOfflineSigningStore = defineStore('offlineSigning', () => {
    /** Persistent global switch, set from Settings. */
    const isEnabled = ref(localStorage.getItem(STORAGE_KEY) === 'true')

    /**
     * Per-operation override, set by a page's "sign only" checkbox. Cleared
     * once the operation finishes so it can't silently affect the next one.
     */
    const oneShot = ref(false)

    /** True when the next broadcast should be captured rather than sent. */
    const isActive = computed(() => isEnabled.value || oneShot.value)

    /** Signed transactions captured during the current operation. */
    const records = ref<SignedTxRecord[]>([])

    const hasRecords = computed(() => records.value.length > 0)

    let counter = 0

    const setEnabled = (val: boolean) => {
        isEnabled.value = val
        localStorage.setItem(STORAGE_KEY, val ? 'true' : 'false')
    }

    const setOneShot = (val: boolean) => {
        oneShot.value = val
    }

    /**
     * Records a signed transaction instead of broadcasting it, and returns the
     * sentinel that stands in for a transaction id.
     */
    const capture = (input: Omit<SignedTxRecord, 'id' | 'createdAt'>): string => {
        counter += 1
        const id = `${OFFLINE_TX_ID}-${counter}`
        records.value = [
            ...records.value,
            { ...input, id, createdAt: Date.now() },
        ]
        return id
    }

    /** Drops captured transactions. Call before starting a new operation. */
    const clearRecords = () => {
        records.value = []
    }

    /**
     * Ends a one-shot capture. The records are left in place for the page to
     * render; only the trigger is reset.
     */
    const endOperation = () => {
        oneShot.value = false
    }

    return {
        isEnabled,
        oneShot,
        isActive,
        records,
        hasRecords,
        setEnabled,
        setOneShot,
        capture,
        clearRecords,
        endOperation,
    }
})
