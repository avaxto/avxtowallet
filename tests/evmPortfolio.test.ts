/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Multi-network portfolio scanning.
 *
 * The properties under test are the ones that make fanning out across a dozen
 * third-party explorers safe: one failing network degrades itself and nothing
 * else, and no number reaching the UI is taken on an explorer's word.
 */
import Big from 'big.js'

import { scanNetwork, type ScanDeps } from '@/stores/evmPortfolio'
import { getEvmNetworkById, loadCustomEvmNetworks, type EvmNetwork } from '@/evm/networkRegistry'
import { MissingApiKeyError } from '@/evm/explorers'

loadCustomEvmNetworks()

const HOLDER = '0x' + 'ab'.repeat(20)
const ethereum = getEvmNetworkById('ethereum') as EvmNetwork
const base = getEvmNetworkById('base') as EvmNetwork
const bnb = getEvmNetworkById('bnb') as EvmNetwork

/** Explorer claims 6 decimals; the contract reports 18. The contract must win. */
const makeDeps = (over: Partial<ScanDeps> = {}): ScanDeps =>
    ({
        readNativeBalance: async () => Big('1.5'),
        readTokenState: async (address: string) => {
            if (address === '0xbad') throw new Error('execution reverted')
            if (address === '0xzero') return { raw: '0', balance: Big(0), decimals: 18 }
            return { raw: '2000000000000000000', balance: Big('2'), decimals: 18 }
        },
        explorerAdapterFor: () => ({
            family: 'test',
            discoverTokens: async () => [
                { address: '0xgood', symbol: 'GOOD', name: 'Good', decimals: 6 },
                { address: '0xbad', symbol: 'BAD', name: 'Bad' },
                { address: '0xzero', symbol: 'ZERO', name: 'Zero' },
            ],
        }),
        ...over,
    } as ScanDeps)

describe('scanNetwork', () => {
    it('lists holdings and attaches the network to every token', async () => {
        const result = await scanNetwork(HOLDER, ethereum, makeDeps())

        expect(result.status).toBe('ok')
        const good = result.tokens.find((t) => t.address === '0xgood')
        expect(good).toBeDefined()
        expect(good!.network.evmChainId).toBe(ethereum.evmChainId)
        expect(result.tokens.every((t) => t.network.evmChainId === ethereum.evmChainId)).toBe(true)
    })

    it('keys tokens by chain id, so the same address on two chains cannot collide', async () => {
        const onEthereum = await scanNetwork(HOLDER, ethereum, makeDeps())
        const onBase = await scanNetwork(HOLDER, base, makeDeps())

        const ethKey = onEthereum.tokens.find((t) => t.address === '0xgood')!.key
        const baseKey = onBase.tokens.find((t) => t.address === '0xgood')!.key

        expect(ethKey).toBe(`${ethereum.evmChainId}:0xgood`)
        expect(ethKey).not.toBe(baseKey)
    })

    it('trusts the contract over the explorer for decimals', async () => {
        const result = await scanNetwork(HOLDER, ethereum, makeDeps())
        // The explorer hinted 6 — using it would misplace the decimal point by
        // twelve orders of magnitude on both display and any send.
        expect(result.tokens.find((t) => t.address === '0xgood')!.decimals).toBe(18)
    })

    it('drops zero balances and contracts that revert', async () => {
        const result = await scanNetwork(HOLDER, ethereum, makeDeps())
        expect(result.tokens.some((t) => t.address === '0xzero')).toBe(false)
        expect(result.tokens.some((t) => t.address === '0xbad')).toBe(false)
        // ...without losing the healthy ones alongside them.
        expect(result.tokens.some((t) => t.address === '0xgood')).toBe(true)
    })

    it('includes the native balance', async () => {
        const result = await scanNetwork(HOLDER, ethereum, makeDeps())
        const native = result.tokens.find((t) => t.isNative)
        expect(native).toBeDefined()
        expect(native!.symbol).toBe(ethereum.native.symbol)
    })

    it('reports a failed explorer without throwing, and still shows the native balance', async () => {
        const result = await scanNetwork(
            HOLDER,
            base,
            makeDeps({
                explorerAdapterFor: () =>
                    ({
                        family: 'test',
                        discoverTokens: async () => {
                            throw new Error('HTTP 500')
                        },
                    } as any),
            })
        )

        expect(result.status).toBe('error')
        // The gas balance comes from the RPC, not the explorer, so it survives.
        expect(result.tokens.some((t) => t.isNative)).toBe(true)
    })

    it('treats a missing API key as skipped rather than an error', async () => {
        const result = await scanNetwork(
            HOLDER,
            bnb,
            makeDeps({
                explorerAdapterFor: () =>
                    ({
                        family: 'etherscan',
                        discoverTokens: async () => {
                            throw new MissingApiKeyError(bnb.name)
                        },
                    } as any),
            })
        )
        // Not configured is not the same as broken; the UI words them differently.
        expect(result.status).toBe('skipped')
    })

    it('returns a result rather than throwing when both RPC and explorer are down', async () => {
        const result = await scanNetwork(
            HOLDER,
            base,
            makeDeps({
                readNativeBalance: async () => {
                    throw new Error('RPC unreachable')
                },
                explorerAdapterFor: () =>
                    ({
                        family: 'test',
                        discoverTokens: async () => {
                            throw new Error('HTTP 500')
                        },
                    } as any),
            })
        )

        expect(result.status).toBe('error')
        expect(result.tokens).toHaveLength(0)
    })

    it('skips a network with no adapter for its explorer family', async () => {
        const result = await scanNetwork(
            HOLDER,
            ethereum,
            makeDeps({ explorerAdapterFor: () => undefined })
        )
        expect(result.status).toBe('skipped')
    })
})
