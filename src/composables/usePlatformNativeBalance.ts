/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The native balance for whichever `PlatformWallet` is currently handed to it —
 * what `BalanceCard.vue` shows for every platform except Avalanche (which has
 * its own store-backed figures; see the component for why).
 *
 * Pulled out of the component specifically to fix a stale-response race: a
 * platform tab can be switched before its previous `getBalances()` call
 * resolves, and nothing about a plain `async` fetch stops that older response
 * from landing *after* the newer one and overwriting it. Bitcoin is the
 * platform this actually happened on — `BitcoinWallet.getBalances()` runs a
 * full Esplora scan across several candidate address types the first time it
 * is called, which routinely outlives a Solana or EVM tab's single quick RPC
 * round trip. Switching Bitcoin -> Solana while that scan was still in flight
 * let the stale Bitcoin balance land after the correct Solana one and silently
 * replace it, so the Solana tab displayed Bitcoin's balance until the next
 * manual refresh.
 *
 * The fix is the guard below: a response is only applied if the wallet it was
 * fetched FOR is still the one this composable was handed when the response
 * arrives. A `Ref` rather than a plain identity check because the caller needs
 * to change which wallet this is watching (switching platforms, or Avalanche
 * gating itself out — see the component) without re-creating the composable.
 */
import { ref, watch, type Ref } from 'vue'
import Big from 'big.js'

import type { PlatformWallet } from '@/platforms/types'

export function usePlatformNativeBalance(wallet: Ref<PlatformWallet | null>) {
    const amount = ref<Big>(Big(0))
    const loading = ref(false)

    const refresh = async (): Promise<void> => {
        const w = wallet.value
        if (!w) {
            amount.value = Big(0)
            return
        }

        loading.value = true
        try {
            const balances = await w.getBalances()

            // The wallet this call was FOR, not whatever is current now — see
            // the module doc. A mismatch means a newer call is either already
            // in flight or has already landed, and this response is stale.
            if (wallet.value !== w) return

            const native = balances.find((b) => b.assetId === 'native') ?? balances[0]
            amount.value = native ? Big(native.amount.toString()) : Big(0)
        } catch (e) {
            console.warn('[usePlatformNativeBalance] Could not fetch balance:', e)
        } finally {
            // Same guard: a stale call finishing must not clear the spinner
            // for a newer one that is still genuinely in flight.
            if (wallet.value === w) loading.value = false
        }
    }

    watch(wallet, refresh, { immediate: true })

    return { amount, loading, refresh }
}
