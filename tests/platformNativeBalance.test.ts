/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `usePlatformNativeBalance` — a stale-response race that shipped as a real
 * bug: switch from a Bitcoin tab to a Solana tab, and `BalanceCard` would show
 * Bitcoin's balance under the Solana tab.
 *
 * The mechanism is not exotic — it is the standard "two in-flight requests,
 * last one to resolve wins" race, just with an unusually reliable trigger:
 * `BitcoinWallet.getBalances()` runs a full Esplora scan across several
 * candidate address types on first call, so it routinely outlives a Solana or
 * EVM tab's single quick RPC round trip. A user does not need to be fast for
 * this to happen — Bitcoin's own fetch is slow enough on its own.
 *
 * Fakes rather than real platform wallets, for the same reason
 * multiPlatformUnlock and platformSwitching use them: this is a race in how
 * the composable applies a response, not in what any one platform's
 * `getBalances()` computes.
 */
import { nextTick, ref } from 'vue'
import Big from 'big.js'

import { usePlatformNativeBalance } from '@/composables/usePlatformNativeBalance'
import type { PlatformBalance, PlatformWallet } from '@/platforms/types'

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

function nativeBalance(amount: string): PlatformBalance[] {
    return [
        {
            assetId: 'native',
            symbol: 'TEST',
            name: 'Test',
            decimals: 8,
            amount: Big(amount),
            chain: 'TEST',
        },
    ]
}

/** A wallet whose `getBalances()` resolves whenever the test tells it to. */
function fakeWallet(platformId: string, getBalances: () => Promise<PlatformBalance[]>): PlatformWallet {
    return {
        platformId: platformId as any,
        id: `${platformId}-wallet`,
        accessMethodId: 'watch',
        isReadonly: true,
        getAddresses: () => [],
        getPrimaryAddress: () => `${platformId}-address`,
        getBalances,
        native: null,
    }
}

describe('usePlatformNativeBalance', () => {
    it('shows the balance for the wallet it is handed', async () => {
        const wallet = ref<PlatformWallet | null>(
            fakeWallet('solana', async () => nativeBalance('4.5'))
        )
        const { amount, refresh } = usePlatformNativeBalance(wallet)
        await refresh()

        expect(amount.value.toString()).toBe('4.5')
    })

    it('zeroes the amount when there is no wallet', async () => {
        const wallet = ref<PlatformWallet | null>(null)
        const { amount } = usePlatformNativeBalance(wallet)
        await nextTick() // the immediate watcher's initial run

        expect(amount.value.toString()).toBe('0')
    })

    /**
     * The exact regression. A slow Bitcoin fetch is still in flight when the
     * tab switches to Solana; Solana's fast fetch resolves first, then the
     * stale Bitcoin response arrives — and must be discarded rather than
     * overwriting the correct, current balance.
     */
    it('discards a slow response from a wallet that is no longer current', async () => {
        const btcCall = deferred<PlatformBalance[]>()
        const btcWallet = fakeWallet('bitcoin', () => btcCall.promise)
        const solWallet = fakeWallet('solana', async () => nativeBalance('4.5'))

        const wallet = ref<PlatformWallet | null>(btcWallet)
        const { amount } = usePlatformNativeBalance(wallet)
        await nextTick() // the immediate watcher starts the Bitcoin fetch

        // Switch tabs before Bitcoin's scan resolves — the watcher starts a
        // second, independent fetch for Solana.
        wallet.value = solWallet
        await nextTick()

        // Solana's fetch is fast and lands first.
        await flushPromises()
        expect(amount.value.toString()).toBe('4.5')

        // Bitcoin's slow scan finally resolves. Without the guard this
        // overwrites the figure the user is looking at with the wrong chain's
        // balance, on a tab that has nothing to do with Bitcoin.
        btcCall.resolve(nativeBalance('0.002'))
        await flushPromises()

        expect(amount.value.toString()).toBe('4.5')
    })

    /**
     * The same race, the other way round: if the OLDER (Bitcoin) response
     * happens to land first and the user is still on Bitcoin, that update is
     * legitimate — the guard must not suppress a response that is still
     * current just because a request for it happened earlier.
     */
    it('still applies a response that matches the current wallet', async () => {
        const btcCall = deferred<PlatformBalance[]>()
        const wallet = ref<PlatformWallet | null>(fakeWallet('bitcoin', () => btcCall.promise))
        const { amount } = usePlatformNativeBalance(wallet)
        await nextTick()

        btcCall.resolve(nativeBalance('0.002'))
        await flushPromises()

        expect(amount.value.toString()).toBe('0.002')
    })

    it('clears the loading flag only for the response that matches the current wallet', async () => {
        const btcCall = deferred<PlatformBalance[]>()
        const btcWallet = fakeWallet('bitcoin', () => btcCall.promise)
        const solWallet = fakeWallet('solana', async () => nativeBalance('4.5'))

        const wallet = ref<PlatformWallet | null>(btcWallet)
        const { loading } = usePlatformNativeBalance(wallet)
        await nextTick()
        expect(loading.value).toBe(true)

        wallet.value = solWallet
        await nextTick()
        await flushPromises()
        // Solana's own fetch finished — nothing left in flight for it.
        expect(loading.value).toBe(false)

        // The stale Bitcoin call finishing must not flip this back on, or
        // leave it on, for a wallet that is no longer being watched.
        btcCall.resolve(nativeBalance('0.002'))
        await flushPromises()
        expect(loading.value).toBe(false)
    })
})

/** Lets every already-settled microtask (including chained `.then`s) run. */
function flushPromises(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}
