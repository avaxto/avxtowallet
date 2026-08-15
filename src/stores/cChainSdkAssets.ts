/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Avalanche } from '@avalanche-sdk/chainkit'
import { findRegistryToken, isSpoofedToken } from '@/token-registry'

export type CChainSdkAsset = {
    type: 'erc20' | 'erc721' | 'erc1155'
    address: string
    name: string
    symbol: string
    logoUri?: string
    balance: string
    decimals?: number
    tokenId?: string
}

/**
 * C-chain assets discovered via the Glacier/chainkit SDK ("All Assets" —
 * tokens the user holds that aren't in the app's own "Default Assets" list).
 *
 * A Pinia store, not a plain composable, because it used to be one: every call
 * site (`Fungibles.vue`, `useHeldErc20Tokens` — itself used by Swap and the
 * transfer/EVM token pickers) created its OWN local `ref` state, so a refresh
 * triggered from one (e.g. Swap.vue after a swap) never reached any of the
 * others. Worse, several of those call sites live behind `<keep-alive>`
 * (Portfolio and Swap both are — see Wallet.vue), so they don't even remount
 * and refetch on their own when navigated back to. A single shared store
 * means one `refresh()` call updates every screen showing this data,
 * regardless of which one triggered it or whether the others are currently
 * mounted.
 */
export const useCChainSdkAssetsStore = defineStore('cChainSdkAssets', () => {
    const assets = ref<CChainSdkAsset[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    // Remembered so refresh() (called from send/swap success handlers and the
    // C-chain poller, none of which know the address/chainId a view is
    // currently watching) can re-run the same fetch without them passing it.
    let lastAddress: string | null = null
    let lastChainId: number | null = null

    const fetch = async (address: string | null, chainId: number | null): Promise<void> => {
        lastAddress = address
        lastChainId = chainId

        if (!address || !chainId) {
            assets.value = []
            return
        }

        loading.value = true
        error.value = null

        try {
            const sdk = new Avalanche({ chainId: String(chainId), enableTelemetry: false })
            const result: CChainSdkAsset[] = []

            // ERC-20 — checked against the token registry (see
            // token-registry/index.ts): this SDK auto-discovers every
            // contract the address has ever interacted with, so a discovered
            // token claiming a symbol the registry knows (AVXTO, AVAX, …) at
            // an address that isn't the real one is dropped as a spoof.
            // Anything else discovered is shown as before — the registry
            // doesn't restrict discovery, only catches impostors of known
            // symbols. For a token that IS a registry-known address, its
            // name/symbol are used instead of whatever the SDK reported,
            // same as the "Default Assets" path in stores/assets.ts.
            const erc20Pages = await sdk.data.evm.address.balances.listErc20({ address })
            for await (const page of erc20Pages) {
                for (const token of page.result.erc20TokenBalances) {
                    if (isSpoofedToken(token.symbol, token.address, chainId)) continue
                    const registryEntry = findRegistryToken(token.address, chainId)

                    const decimals = token.decimals ?? 18
                    const raw = BigInt(token.balance)
                    const divisor = BigInt(10 ** decimals)
                    const whole = raw / divisor
                    const frac = raw % divisor
                    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
                    const humanBal = fracStr ? `${whole}.${fracStr}` : `${whole}`
                    result.push({
                        type: 'erc20',
                        address: token.address,
                        name: registryEntry?.name ?? token.name,
                        symbol: registryEntry?.symbol ?? token.symbol,
                        logoUri: token.logoUri,
                        balance: humanBal,
                        decimals,
                    })
                }
            }

            // ERC-721
            const erc721Pages = await sdk.data.evm.address.balances.listErc721({ address })
            for await (const page of erc721Pages) {
                for (const token of page.result.erc721TokenBalances) {
                    result.push({
                        type: 'erc721',
                        address: token.address,
                        name: token.metadata?.name ?? token.name,
                        symbol: token.symbol,
                        logoUri: token.metadata?.imageUri,
                        balance: '1',
                        tokenId: token.tokenId,
                    })
                }
            }

            // ERC-1155
            const erc1155Pages = await sdk.data.evm.address.balances.listErc1155({ address })
            for await (const page of erc1155Pages) {
                for (const token of page.result.erc1155TokenBalances) {
                    result.push({
                        type: 'erc1155',
                        address: token.address,
                        name: token.metadata?.name ?? `Token #${token.tokenId}`,
                        symbol: `#${token.tokenId}`,
                        logoUri: token.metadata?.imageUri,
                        balance: token.balance,
                        tokenId: token.tokenId,
                    })
                }
            }

            assets.value = result
        } catch (e: any) {
            error.value = e?.message ?? 'Failed to fetch C-chain balances'
            console.error('useCChainSdkAssetsStore fetch error:', e)
        } finally {
            loading.value = false
        }
    }

    /** Re-runs the last `fetch()` — a no-op (clears to empty) if none has happened yet. */
    const refresh = async (): Promise<void> => {
        await fetch(lastAddress, lastChainId)
    }

    return { assets, loading, error, fetch, refresh }
})
