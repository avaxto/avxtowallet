/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { computed, watch, type ComputedRef } from 'vue'
import { useActivePlatformStore } from '@/platforms'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { useEvmPortfolioStore } from '@/stores/evmPortfolio'
import { NATIVE_TOKEN_ADDRESS } from '@/js/ArenaSwap'
import { useHeldErc20Tokens, type HeldToken } from './useHeldErc20Tokens'

/**
 * What the active wallet holds on the chain its EVM signer is on: the tokens a
 * same-chain swap can spend.
 *
 * On the Avalanche tab this is `useHeldErc20Tokens` (C-Chain). On the EVM tab
 * it is the multi-network portfolio — the same store and scan the portfolio
 * page renders — narrowed to the signer's network, with the native coin keyed
 * by `NATIVE_TOKEN_ADDRESS` as the swap code expects.
 */
export function useSwapSourceTokens(): {
    tokens: ComputedRef<HeldToken[]>
    loading: ComputedRef<boolean>
    refresh: () => Promise<void>
} {
    const platformStore = useActivePlatformStore()
    const portfolio = useEvmPortfolioStore()
    const avalanche = useHeldErc20Tokens()

    const isEvmTab = computed(() => platformStore.activePlatform?.descriptor.id === 'evm')
    const signer = computed(() => activeEvmSigner())

    const evmTokens = computed((): HeldToken[] => {
        const s = signer.value
        if (!s) return []
        return portfolio.tokens
            .filter((t) => t.network.evmChainId === s.network.evmChainId && t.balance.gt(0))
            .map((t) => ({
                address: t.isNative ? NATIVE_TOKEN_ADDRESS : t.address,
                symbol: t.symbol,
                name: t.name,
                decimals: t.decimals,
                logoUri: t.logoUri,
                balance: t.balance,
                isNative: t.isNative,
                network: t.network,
            }))
    })

    // The EVM portfolio is scanned on demand; share the portfolio page's scan.
    watch(
        () => (isEvmTab.value && signer.value ? [signer.value.address, signer.value.network.isTestnet] : null),
        (key) => {
            if (!key) return
            portfolio.ensureLoaded(key[0] as string, key[1] as boolean).catch((e) => {
                console.warn('[useSwapSourceTokens] portfolio scan failed:', e)
            })
        },
        { immediate: true }
    )

    const tokens = computed(() => (isEvmTab.value ? evmTokens.value : avalanche.tokens.value))
    const loading = computed(() => (isEvmTab.value ? portfolio.loading : avalanche.loading.value))

    const refresh = async (): Promise<void> => {
        if (!isEvmTab.value) return avalanche.refresh()
        const s = signer.value
        if (s) await portfolio.fetch(s.address, s.network.isTestnet)
    }

    return { tokens, loading, refresh }
}
