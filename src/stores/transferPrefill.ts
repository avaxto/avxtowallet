/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Typed parameters the /wallet/transfer view (and its FormC/TxList children)
 * pre-fill themselves from. Portfolio "send" icons call `set()` before
 * navigating instead of encoding these into the URL's query string.
 */
export interface TransferPrefillParams {
    chain?: 'X' | 'C'
    asset?: string
    token?: string
    tokenId?: string
    nft?: string
    name?: string
    symbol?: string
    decimals?: number
    logoUri?: string
}

export const useTransferPrefillStore = defineStore('transferPrefill', () => {
    const chain = ref<'X' | 'C' | undefined>(undefined)
    const asset = ref<string | undefined>(undefined)
    const token = ref<string | undefined>(undefined)
    const tokenId = ref<string | undefined>(undefined)
    const nft = ref<string | undefined>(undefined)
    const name = ref<string | undefined>(undefined)
    const symbol = ref<string | undefined>(undefined)
    const decimals = ref<number | undefined>(undefined)
    const logoUri = ref<string | undefined>(undefined)

    /**
     * Replaces the whole prefill snapshot (not a merge) so a link that only
     * cares about `asset`/`chain` doesn't leak a `token` left over from a
     * previous, unrelated "send" click.
     */
    const set = (params: TransferPrefillParams = {}) => {
        chain.value = params.chain
        asset.value = params.asset
        token.value = params.token
        tokenId.value = params.tokenId
        nft.value = params.nft
        name.value = params.name
        symbol.value = params.symbol
        decimals.value = params.decimals
        logoUri.value = params.logoUri
    }

    /** Resets every field. Called when leaving /wallet/transfer so a plain, un-prefilled visit next time starts clean. */
    const clear = () => set({})

    return {
        chain,
        asset,
        token,
        tokenId,
        nft,
        name,
        symbol,
        decimals,
        logoUri,
        set,
        clear,
    }
})
