/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The injected EVM wallet follows the extension's chain.
 *
 * Switching networks inside MetaMask or Core used to change nothing in the
 * app: the EVM tab kept its old network, balance and gas coin. The wallet now
 * mirrors the extension — ETH on Ethereum, AVAX on Avalanche C-Chain.
 */
import { createPinia, setActivePinia } from 'pinia'

import { useEvmStore } from '@/platforms/evm/store'
import { routeChainChange } from '@/platforms/injectedChainSync'
import { getEvmNetworkByChainId, loadCustomEvmNetworks } from '@/evm/networkRegistry'
import type { EvmNetwork } from '@/evm/networkRegistry'

loadCustomEvmNetworks()

/** An extension on `chainId` that records every method it is asked. */
function installProvider(chainId: number) {
    const calls: string[] = []
    ;(window as any).ethereum = {
        request: async ({ method }: { method: string }) => {
            calls.push(method)
            if (method === 'eth_requestAccounts') return ['0x' + '1'.repeat(40)]
            if (method === 'eth_chainId') return '0x' + chainId.toString(16)
            return null
        },
    }
    return calls
}

afterEach(() => {
    delete (window as any).ethereum
})

/**
 * Following the extension after connect: switching networks inside MetaMask or
 * Core must move the wallet too, and to the tab that owns the new chain.
 */
describe('routeChainChange', () => {
    const both = { avalancheInjected: true, evmInjected: true }

    it('moves the EVM wallet to C-Chain, and Avalanche to mainnet', () => {
        const r = routeChainChange(43114, { ...both, activePlatformId: 'evm' })
        expect(r.evmNetwork?.evmChainId).toBe(43114)
        expect(r.avalancheNetworkId).toBe(1)
        expect(r.activate).toBeUndefined()
    })

    it('moves the EVM wallet to Ethereum without touching Avalanche', () => {
        const r = routeChainChange(1, { ...both, activePlatformId: 'evm' })
        expect(r.evmNetwork?.evmChainId).toBe(1)
        expect(r.avalancheNetworkId).toBeUndefined()
        expect(r.activate).toBeUndefined()
    })

    it('moves Avalanche to Fuji when the extension moves to Fuji', () => {
        const r = routeChainChange(43113, { ...both, activePlatformId: 'avalanche' })
        expect(r.avalancheNetworkId).toBe(5)
        expect(r.activate).toBeUndefined()
    })

    it('brings the EVM tab forward when the extension leaves Avalanche', () => {
        const r = routeChainChange(137, { ...both, activePlatformId: 'avalanche' })
        expect(r.evmNetwork?.evmChainId).toBe(137)
        expect(r.activate).toBe('evm')
    })

    it('follows in the background without stealing focus from a non-extension tab', () => {
        const r = routeChainChange(137, { ...both, activePlatformId: 'solana' })
        expect(r.evmNetwork?.evmChainId).toBe(137)
        expect(r.activate).toBeUndefined()
    })

    it('does nothing for a chain the registry does not know', () => {
        expect(routeChainChange(999999, { ...both, activePlatformId: 'evm' })).toEqual({})
    })

    it('does nothing when no session came from the extension', () => {
        const r = routeChainChange(137, {
            avalancheInjected: false,
            evmInjected: false,
            activePlatformId: 'evm',
        })
        expect(r).toEqual({})
    })
})

describe('evm store followExtensionChain', () => {
    it('rebinds the injected wallet to the new chain as a new object', async () => {
        setActivePinia(createPinia())
        installProvider(1)
        const store = useEvmStore()
        await store.connectInjected({ navigate: false })
        const before = store.wallet!
        expect(before.network.evmChainId).toBe(1)

        store.followExtensionChain(getEvmNetworkByChainId(137) as EvmNetwork)

        expect(store.wallet).not.toBe(before)
        expect(store.wallet!.network.evmChainId).toBe(137)
        expect(store.network.evmChainId).toBe(137)
        expect(store.wallet!.getPrimaryAddress()).toBe(before.getPrimaryAddress())
    })
})

/**
 * The gas coin on BalanceCard. `getActiveNetwork()` reads a module-scope
 * mirror Vue cannot track, so the label used to stay on whatever it first
 * showed when the extension moved chains.
 */
describe('BalanceCard gas coin', () => {
    it('reads ETH on Ethereum and AVAX again on Avalanche', async () => {
        const { mount } = await import('@vue/test-utils')
        const { useActivePlatformStore } = await import('@/platforms/store')
        const BalanceCard = (await import('@/components/wallet/TopCards/BalanceCard/BalanceCard.vue'))
            .default

        const pinia = createPinia()
        setActivePinia(pinia)
        installProvider(43114)
        const evmStore = useEvmStore()
        await evmStore.connectInjected({ navigate: false })
        await useActivePlatformStore().setActivePlatform('evm')

        const wrapper = mount(BalanceCard, {
            global: {
                plugins: [pinia],
                mocks: { $t: (k: string) => k },
                stubs: { fa: true, UtxosBreakdownModal: true, Spinner: true },
            },
        })
        const symbol = () => wrapper.vm.nativeSymbolText

        expect(symbol()).toBe('AVAX')

        evmStore.followExtensionChain(getEvmNetworkByChainId(1) as EvmNetwork)
        await wrapper.vm.$nextTick()
        expect(symbol()).toBe('ETH')

        evmStore.followExtensionChain(getEvmNetworkByChainId(43114) as EvmNetwork)
        await wrapper.vm.$nextTick()
        expect(symbol()).toBe('AVAX')

        wrapper.unmount()
    })
})
