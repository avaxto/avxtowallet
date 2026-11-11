/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `activeEvmSigner()` inside a `computed` must re-run when the wallet is
 * rebound (an EVM network switch), even though the platform reads its wallet
 * from a plain, untracked module variable.
 */
import { computed, ref } from 'vue'

const epoch = ref(0)
let mirror = { network: { evmChainId: 43114 } } // untracked, like peekActiveWallet()

jest.mock('@/platforms/store', () => ({
    useActivePlatformStore: () => ({
        get activeWallet() {
            void epoch.value
            return {}
        },
        activePlatform: { getEvmSigner: () => mirror },
    }),
}))

import { activeEvmSigner } from '@/platforms/evmSigner'

it('follows a network switch', () => {
    const chainId = computed(() => activeEvmSigner()?.network.evmChainId)
    expect(chainId.value).toBe(43114)
    mirror = { network: { evmChainId: 1 } }
    epoch.value++ // what setWallet → notifyWalletChanged does
    expect(chainId.value).toBe(1)
})
