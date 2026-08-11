/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { computed, type ComputedRef } from 'vue'
import Big from 'big.js'
import { useMainStore, useAssetsStore } from '@/stores'
import { useCChainSdkBalances } from '@/composables/useCChainSdkBalances'
import { bnToBig } from '@/helpers/helper'
import { BN } from '@/avalanche'
import { NATIVE_TOKEN_ADDRESS } from '@/js/ArenaSwap'

export interface HeldToken {
    address: string // NATIVE_TOKEN_ADDRESS for native AVAX
    symbol: string
    name: string
    decimals: number
    logoUri?: string
    balance: Big
    isNative: boolean
}

/**
 * Every C-chain asset (native AVAX + ERC20) the active wallet holds a
 * positive balance of — merges the "Default Assets" list
 * (assetsStore.erc20Tokens/erc20TokensCustom) with tokens auto-discovered
 * via the Glacier/chainkit SDK (the same source Fungibles.vue's "All Assets"
 * section uses). A token can show up on the portfolio page purely through
 * SDK discovery without ever being added to the assets store, so a picker
 * that only reads the store silently omits it — this is the single source
 * both Swap's "you pay" picker and the transfer page's token picker read
 * from, so neither omits what the other shows.
 */
export function useHeldErc20Tokens(): { tokens: ComputedRef<HeldToken[]>; loading: ComputedRef<boolean> } {
    const mainStore = useMainStore()
    const assetsStore = useAssetsStore()

    const cChainAddress = computed((): string | null => {
        const addr = mainStore.activeWallet?.ethAddress
        if (!addr) return null
        return addr.startsWith('0x') ? addr : `0x${addr}`
    })
    const evmChainId = computed((): number => assetsStore.evmChainId)
    const { assets: sdkAssets, loading } = useCChainSdkBalances(cChainAddress, evmChainId)

    const tokens = computed((): HeldToken[] => {
        const out: HeldToken[] = []
        const seen = new Set<string>()

        const ethBalance = mainStore.activeWallet?.ethBalance || new BN(0)
        if (ethBalance.gt(new BN(0))) {
            seen.add(NATIVE_TOKEN_ADDRESS)
            out.push({
                address: NATIVE_TOKEN_ADDRESS,
                symbol: 'AVAX',
                name: 'Avalanche',
                decimals: 18,
                balance: bnToBig(ethBalance, 18),
                isNative: true,
            })
        }

        const defaultAssets = [
            ...(assetsStore.erc20Tokens || []),
            ...(assetsStore.erc20TokensCustom || []),
        ]
        for (const t of defaultAssets) {
            const addr = t.data.address.toLowerCase()
            if (seen.has(addr)) continue
            if (!t.balanceBN || t.balanceBN.lten(0)) continue
            seen.add(addr)
            out.push({
                address: t.data.address,
                symbol: t.data.symbol,
                name: t.data.name,
                decimals: parseInt(t.data.decimals as string) || 18,
                logoUri: t.data.logoURI,
                balance: t.balanceBig,
                isNative: false,
            })
        }

        for (const a of sdkAssets.value) {
            if (a.type !== 'erc20') continue
            const addr = a.address.toLowerCase()
            if (seen.has(addr)) continue
            const balNum = parseFloat(a.balance)
            if (!(balNum > 0)) continue
            seen.add(addr)
            out.push({
                address: a.address,
                symbol: a.symbol,
                name: a.name,
                decimals: a.decimals ?? 18,
                logoUri: a.logoUri,
                balance: Big(a.balance),
                isNative: false,
            })
        }

        return out
    })

    return { tokens, loading }
}
