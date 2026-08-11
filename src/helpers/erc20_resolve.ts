/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { useMainStore, useAssetsStore } from '@/stores'
import Erc20Token from '@/js/Erc20Token'

export interface Erc20MetadataHint {
    name?: string
    symbol?: string
    decimals?: number
    logoUri?: string
}

/**
 * Resolves a C-chain ERC20 address to an Erc20Token instance, for callers
 * that only have an address on hand — a token picked from the merged
 * useHeldErc20Tokens() list (which includes SDK-discovered tokens the
 * assets store has never heard of), or a token address carried through the
 * transferPrefill store from a portfolio "send" icon.
 *
 * Prefers the assets store's own instance when the address is already known
 * there (it already has a live, polled balance); otherwise builds a
 * throwaway instance from `hint` (or bare defaults) and fetches its balance
 * once before returning.
 */
export async function resolveErc20Token(
    address: string,
    hint?: Erc20MetadataHint
): Promise<Erc20Token> {
    const mainStore = useMainStore()
    const assetsStore = useAssetsStore()

    const addr = address.toLowerCase()
    const known = [...assetsStore.erc20Tokens, ...assetsStore.erc20TokensCustom].find(
        (t) => t.data.address.toLowerCase() === addr
    )
    if (known) return known

    const tempToken = new Erc20Token({
        address,
        chainId: assetsStore.evmChainId,
        name: hint?.name ?? address,
        symbol: hint?.symbol ?? '???',
        decimals: hint?.decimals ?? 18,
        logoURI: hint?.logoUri ?? '',
    })

    const ethAddress = (mainStore.activeWallet as any)?.ethAddress
    if (ethAddress) {
        const rawAddr = ethAddress.replace(/^0x/i, '')
        await tempToken.updateBalance(rawAddr)
    }
    return tempToken
}
