/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Every X-chain asset (native AVAX + any ANT) the active wallet holds a
 * positive balance of, for the transfer page's token picker.
 *
 * Unlike the C-Chain/EVM side (`useHeldErc20Tokens`), the wallet's own UTXO
 * set is already the authoritative source here — an X-chain balance IS its
 * UTXOs, there is no separate contract state an explorer alone could reveal.
 * So `tokens` reads straight from `assetsStore.walletAssetsArray`, the same
 * data every other X-chain balance figure in the app already comes from.
 *
 * `refresh()` still calls out to the Glacier/chainkit indexer (the same
 * source `stores/cChainSdkAssets.ts` uses for C-Chain) after re-fetching
 * UTXOs — not to build a second, parallel list, but as a freshness
 * cross-check: an asset the indexer reports that the local UTXO walk hasn't
 * caught up to yet surfaces as a console warning instead of just silently
 * being missing from the picker with no indication why.
 */
import { computed, ref, type ComputedRef } from 'vue'
import Big from 'big.js'
import { Avalanche } from '@avalanche-sdk/chainkit'
import { useAssetsStore, useMainStore, useNetworkStore } from '@/stores'

export interface XChainHeldToken {
    /** AVA asset id — X-chain's equivalent of a contract address. */
    address: string
    symbol: string
    name: string
    decimals: number
    balance: Big
    isNative: boolean
}

export function useHeldXChainAssets(): {
    tokens: ComputedRef<XChainHeldToken[]>
    loading: ComputedRef<boolean>
    refresh: () => Promise<void>
} {
    const assetsStore = useAssetsStore()
    const mainStore = useMainStore()
    const networkStore = useNetworkStore()
    const loading = ref(false)

    const tokens = computed((): XChainHeldToken[] => {
        const avaxId = assetsStore.AssetAVA?.id
        return assetsStore.walletAssetsArray
            // Native AVAX always shows, even at 0 — a near-empty gas balance
            // is exactly what a user needs to see before trying to send.
            .filter((a) => a.id === avaxId || a.getAmount().gt(0))
            .map((a) => ({
                address: a.id,
                symbol: a.symbol,
                name: a.name,
                decimals: a.denomination,
                balance: a.getAmount(),
                isNative: a.id === avaxId,
            }))
    })

    /**
     * Cross-checks the freshly-refetched local UTXO set against the indexer.
     * Never throws and never mutates `tokens` — see the module doc above for
     * why this is a warning, not a second data source.
     */
    const checkIndexerCoverage = async (): Promise<void> => {
        const wallet = mainStore.activeWallet
        const addresses = wallet?.getAllAddressesX() ?? []
        if (!addresses.length) return

        try {
            const network = networkStore.selectedNetwork?.networkId === 5 ? 'fuji' : 'mainnet'
            const sdk = new Avalanche({ network, enableTelemetry: false })
            const res = await sdk.data.primaryNetwork.balances.listByAddresses({
                blockchainId: 'x-chain',
                addresses: addresses.join(','),
                network,
            })

            // The response type is shared across P/X/C-chain calls, but only
            // the X-chain shape carries `unlocked` — narrows safely instead
            // of casting.
            if (!('unlocked' in res.balances)) return

            const known = new Set(tokens.value.map((t) => t.address))
            for (const a of res.balances.unlocked) {
                if (!known.has(a.assetId) && Big(a.amount || 0).gt(0)) {
                    console.warn(
                        `[useHeldXChainAssets] Indexer reports ${a.symbol} (${a.assetId}) held, ` +
                            'but it is not yet in the locally-parsed UTXO set.'
                    )
                }
            }
        } catch (e) {
            // Supplementary only — the UTXO refresh in refresh() is what the
            // picker actually shows and sends from.
            console.warn('[useHeldXChainAssets] Indexer cross-check failed:', e)
        }
    }

    /** Re-fetches UTXOs (the sendable source) and cross-checks the indexer. */
    const refresh = async (): Promise<void> => {
        loading.value = true
        try {
            await assetsStore.updateUTXOs()
            await checkIndexerCoverage()
        } finally {
            loading.value = false
        }
    }

    return { tokens, loading, refresh }
}
