/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * What a script's tx.send / tx.crossChain arguments become: validated
 * recipients per chain, string-only amounts within precision, lookalike
 * addresses refused, token details read from the chain rather than trusted
 * from the script.
 */
const state = {
    avalancheTestnet: false,
    evmNetwork: { id: 'ethereum', name: 'Ethereum', isTestnet: false, evmChainId: 1, rpcUrl: '' } as any,
    solanaNetwork: { id: 'mainnet-beta', name: 'Mainnet', isTestnet: false, rpcUrl: '' } as any,
    bitcoinNetwork: { id: 'mainnet', name: 'Mainnet', isTestnet: false, rpcUrl: '' } as any,
}
const SOL_ME = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'
const SOL_OTHER = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

jest.mock('@/scripting/platforms', () => {
    const actual = jest.requireActual('@/scripting/platforms')
    return {
        ...actual,
        avalancheIsTestnet: () => state.avalancheTestnet,
        avalancheChainLabel: (c: string) => `Avalanche ${c}-Chain`,
        networkOn: (p: string) => (p === 'evm' ? state.evmNetwork : p === 'solana' ? state.solanaNetwork : state.bitcoinNetwork),
        requireWallet: (p: string) => ({ getPrimaryAddress: () => (p === 'solana' ? SOL_ME : '0xme') }),
    }
})
jest.mock('@/scripting/reads', () => ({
    readAddress: (_p: string, chain: string) => (chain === 'X' ? 'X-avax1myownaddress' : chain === 'P' ? 'P-avax1myownaddress' : '0xMyOwnC'),
    readBalances: async () => [{ chain: 'SOL', asset: MINT, symbol: 'USDC', decimals: 6, amount: '50' }],
}))
const tokenReads: string[] = []
jest.mock('@/bridge/assets', () => ({
    readTokenAsset: async (chain: any, address: string) => {
        tokenReads.push(`${chain.id}:${address}`)
        if (address.toLowerCase() === '0x000000000000000000000000000000000000dead') throw new Error('not a token')
        return { chainId: chain.id, address, symbol: 'USDC', decimals: 6 }
    },
}))
jest.mock('@/AVA', () => ({
    isValidAddress: (a: string) => /^[XPC]-(avax|fuji)1[0-9a-z]{6,}$/.test(a),
    ava: { getHRP: () => 'avax' },
}))

import { normalizeCrossChain, normalizeSend } from '@/scripting/intents'

const EVM_LOWER = '0x71c7656ec7ab88b098defb751b7401b5f6d8976f'
const EVM_CHECKSUM = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'

beforeEach(() => {
    state.avalancheTestnet = false
    tokenReads.length = 0
})

describe('amounts', () => {
    it('must be decimal strings within the asset’s precision', async () => {
        await expect(normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: 1.5 }, 1)).rejects.toThrow(/decimal string/)
        await expect(normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '1e18' }, 1)).rejects.toThrow(/plain decimal/)
        await expect(normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '0' }, 1)).rejects.toThrow(/greater than zero/)
        await expect(normalizeSend({ platform: 'avalanche', chain: 'X', to: 'X-avax1recipient', amount: '0.0000000001' }, 1)).rejects.toThrow(/9 decimal places/)
        const ok = await normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '001.50' }, 1)
        expect([ok.amount, ok.amountBase]).toEqual(['1.5', '1500000000000000000'])
    })
})

describe('recipients', () => {
    it('refuses lookalike (non-ASCII) addresses', async () => {
        // Cyrillic "а" in place of the Latin "a".
        await expect(normalizeSend({ platform: 'avalanche', to: '0x71c7656ec7аb88b098defb751b7401b5f6d8976f', amount: '1' }, 1)).rejects.toThrow(/not plain ASCII/)
        await expect(normalizeSend({ platform: 'avalanche', to: EVM_LOWER + '​', amount: '1' }, 1)).rejects.toThrow(/not plain ASCII/)
    })

    it('checks EVM checksums and shows the checksummed address', async () => {
        const i = await normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '1' }, 3)
        expect(i).toMatchObject({ to: EVM_CHECKSUM, chain: 'C', evmChainId: 43114, index: 3, asset: { id: 'native', symbol: 'AVAX', decimals: 18 } })
        const badSum = '0x71C7656EC7ab88b098defB751B7401B5f6d8976f'
        await expect(normalizeSend({ platform: 'avalanche', to: badSum, amount: '1' }, 1)).rejects.toThrow(/invalid checksum/)
        await expect(normalizeSend({ platform: 'avalanche', to: '0x123', amount: '1' }, 1)).rejects.toThrow(/not a valid C-Chain address/)
    })

    it('sends X-Chain AVAX only, to X addresses on the current network', async () => {
        const i = await normalizeSend({ platform: 'avalanche', chain: 'X', to: 'avax1recipient', amount: '2' }, 1)
        expect(i).toMatchObject({ to: 'X-avax1recipient', asset: { decimals: 9 }, amountBase: '2000000000' })
        await expect(normalizeSend({ platform: 'avalanche', chain: 'X', to: 'X-fuji1recipient', amount: '2' }, 1)).rejects.toThrow(/not a valid X-Chain address/)
        await expect(normalizeSend({ platform: 'avalanche', chain: 'X', to: 'X-avax1recipient', amount: '2', token: EVM_LOWER }, 1)).rejects.toThrow(/AVAX only/)
        await expect(normalizeSend({ platform: 'avalanche', chain: 'P', to: 'P-avax1recipient', amount: '2' }, 1)).rejects.toThrow(/"X" or "C"/)
    })

    it('pins EVM sends to the EVM wallet’s current network', async () => {
        const i = await normalizeSend({ platform: 'evm', to: EVM_LOWER, amount: '0.1' }, 1)
        expect(i).toMatchObject({ chain: 'evm:1', chainLabel: 'Ethereum', evmChainId: 1, asset: { symbol: 'ETH' } })
        await expect(normalizeSend({ platform: 'evm', chainId: 8453, to: EVM_LOWER, amount: '0.1' }, 1)).rejects.toThrow(/on Ethereum \(chain 1\), not chain 8453/)
    })

    it('validates Solana and Bitcoin recipients', async () => {
        await expect(normalizeSend({ platform: 'solana', to: EVM_LOWER, amount: '1' }, 1)).rejects.toThrow(/not a valid Solana address/)
        await expect(normalizeSend({ platform: 'solana', to: SOL_ME, amount: '1' }, 1)).rejects.toThrow(/own Solana address/)
        expect(await normalizeSend({ platform: 'solana', to: SOL_OTHER, amount: '1' }, 1)).toMatchObject({ asset: { symbol: 'SOL', decimals: 9 } })
        await expect(normalizeSend({ platform: 'bitcoin', to: SOL_OTHER, amount: '0.001' }, 1)).rejects.toThrow(/not a valid Mainnet address/)
        const btc = await normalizeSend({ platform: 'bitcoin', to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '0.001' }, 1)
        expect(btc).toMatchObject({ amountBase: '100000', asset: { symbol: 'BTC', decimals: 8 } })
        await expect(normalizeSend({ platform: 'bitcoin', to: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', amount: '1', token: 'x' }, 1)).rejects.toThrow(/no tokens/)
    })

    it('refuses unknown platforms', async () => {
        await expect(normalizeSend({ platform: 'dogecoin', to: 'x', amount: '1' }, 1)).rejects.toThrow(/Unknown platform/)
        await expect(normalizeSend('send 1 AVAX', 1)).rejects.toThrow(/one object argument/)
    })
})

describe('tokens', () => {
    it('reads ERC-20 symbol and decimals from the chain, ignoring anything the script claims', async () => {
        const i = await normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '2.5', token: EVM_LOWER, symbol: 'AVAX', decimals: 18 }, 1)
        expect(tokenReads).toEqual([`evm:43114:${EVM_LOWER}`])
        expect(i).toMatchObject({ asset: { id: EVM_CHECKSUM, symbol: 'USDC', decimals: 6 }, amountBase: '2500000' })
        await expect(normalizeSend({ platform: 'avalanche', to: EVM_LOWER, amount: '1', token: '0x000000000000000000000000000000000000dEaD' }, 1)).rejects.toThrow(/Could not read token/)
    })

    it('sends SPL tokens the wallet holds, with the mint’s decimals', async () => {
        const i = await normalizeSend({ platform: 'solana', to: SOL_OTHER, amount: '1.25', token: MINT }, 1)
        expect(i).toMatchObject({ asset: { id: MINT, symbol: 'USDC', decimals: 6 }, amountBase: '1250000' })
        await expect(normalizeSend({ platform: 'solana', to: SOL_OTHER, amount: '1', token: SOL_OTHER }, 1)).rejects.toThrow(/holds no token/)
    })
})

describe('crossChain', () => {
    it('moves AVAX between two different Avalanche chains, to the wallet’s own address', async () => {
        const i = await normalizeCrossChain({ from: 'x', to: 'C-Chain', amount: '3' }, 2)
        expect(i).toMatchObject({ kind: 'crossChain', chain: 'X', toChain: 'C', to: '0xMyOwnC', amountBase: '3000000000' })
        expect(i.summary).toBe('Move 3 AVAX from X-Chain to C-Chain')
        await expect(normalizeCrossChain({ from: 'C', to: 'C', amount: '1' }, 1)).rejects.toThrow(/two different chains/)
        await expect(normalizeCrossChain({ from: 'X', to: 'Q', amount: '1' }, 1)).rejects.toThrow(/Avalanche chain must be/)
    })
})
