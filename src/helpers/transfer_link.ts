/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import type { Router } from 'vue-router'
import { useTransferPrefillStore } from '@/stores'
import type { TransferPrefillParams } from '@/stores'

export type { TransferPrefillParams }

/**
 * Navigates to /wallet/transfer with the given parameters passed through
 * the `transferPrefill` store instead of the URL's query string — the
 * plain path is pushed and Transfer.vue / FormC.vue / TxList.vue read the
 * store directly, so nothing about the pre-selected asset/token/chain is
 * encoded into the address bar.
 */
export function goToTransfer(router: Router, params: TransferPrefillParams = {}): void {
    useTransferPrefillStore().set(params)
    router.push('/wallet/transfer')
}
