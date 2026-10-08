/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The universal bridge layer without the network: Wormhole's chain table,
 * amount handling, the AVXTO NTT gate, the provider registry and the
 * transfer history.
 */
import { nativeChainIds } from '@wormhole-foundation/sdk-base'

import { WORMHOLE_EVM_CHAINS, wormholeChainFor } from '@/bridge/wormhole/chains'
import { truncateTo8, convertAmount, wormholeProvider } from '@/bridge/wormhole/provider'
import { NTT_DEPLOYMENTS, isDeployed, nttDeploymentForToken } from '@/bridge/wormhole/nttConfig'
import { thorchainProvider } from '@/bridge/thorchain/provider'
import { getBridgeChain, listBridgeChains } from '@/bridge/chains'
import { recipientError } from '@/bridge/address'
import { amountInput, avxtoAssetFor, formatAmount, nativeAsset, parseAmount } from '@/bridge/assets'
import { isProviderEnabled, listProviders, providersFor, quoteAll, setProviderEnabled } from '@/bridge/registry'
import { bridgeTransfers, getTransfer, removeTransfer, saveTransfer } from '@/bridge/history'
import { newTransfer, NATIVE, type BridgeQuote } from '@/bridge/types'
import { AVXTO_CONTRACT_ADDRESS } from '@/avxto/AVXTOConf'

const chain = (id: string) => {
    const c = getBridgeChain(id)
    if (!c) throw new Error(`missing chain ${id}`)
    return c
}
const ME = '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537'

describe('chains', () => {
    it('maps every EVM chain id to the Wormhole chain the SDK gives that id', () => {
        for (const [id, ref] of Object.entries(WORMHOLE_EVM_CHAINS)) {
            const native = nativeChainIds.networkChainToNativeChainId.get(ref.network as any, ref.chain as any)
            expect([ref.chain, String(native)]).toEqual([ref.chain, id])
        }
    })

    it('offers every Wormhole EVM chain as a bridge chain, plus Solana and Bitcoin', () => {
        const ids = listBridgeChains().map((c) => c.id)
        for (const id of Object.keys(WORMHOLE_EVM_CHAINS)) expect(ids).toContain(`evm:${id}`)
        expect(ids).toEqual(expect.arrayContaining(['solana:mainnet-beta', 'solana:devnet', 'bitcoin:mainnet']))
        expect(ids).not.toContain('solana:testnet')
        expect(wormholeChainFor(chain('bitcoin:mainnet'))).toBeNull()
        expect(wormholeChainFor(chain('solana:devnet'))).toEqual({ network: 'Testnet', chain: 'Solana' })
    })

    it('validates recipients by destination kind', () => {
        expect(recipientError(chain('evm:1'), ME)).toBe('')
        expect(recipientError(chain('evm:1'), 'bc1qxyz')).toMatch(/valid/)
        expect(recipientError(chain('solana:mainnet-beta'), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')).toBe('')
        expect(recipientError(chain('solana:mainnet-beta'), ME)).toMatch(/Solana/)
        expect(recipientError(chain('bitcoin:mainnet'), ME)).toMatch(/valid/)
        expect(recipientError(chain('evm:1'), '')).toMatch(/Enter/)
    })
})

describe('amounts', () => {
    it('truncates to Wormhole’s 8 decimals and converts between decimals', () => {
        expect(truncateTo8(BigInt('1234567890123456789'), 18)).toBe(BigInt('1234567890000000000'))
        expect(truncateTo8(BigInt(123456), 6)).toBe(BigInt(123456))
        expect(convertAmount(BigInt('1500000000000000000'), 18, 8)).toBe(BigInt(150000000))
        expect(convertAmount(BigInt(150000000), 8, 18)).toBe(BigInt('1500000000000000000'))
    })

    it('parses and formats user amounts in base units', () => {
        expect(parseAmount('1.5', 18)).toBe(BigInt('1500000000000000000'))
        expect(parseAmount('0.00000001', 8)).toBe(BigInt(1))
        expect(parseAmount('0.000000001', 8)).toBeNull()
        expect(parseAmount('0', 8)).toBeNull()
        expect(parseAmount('abc', 8)).toBeNull()
        expect(formatAmount(BigInt('1234567891000000000000'), 18)).toBe('1,234.567891')
        expect(formatAmount(BigInt(5), 8)).toBe('0')
        expect(amountInput(BigInt('1500000000000000000'), 18)).toBe('1.5')
    })
})

describe('AVXTO', () => {
    it('lives on Avalanche (and Fuji) until its NTT spokes are filled in', () => {
        expect(avxtoAssetFor(chain('evm:43114'))?.address).toBe(AVXTO_CONTRACT_ADDRESS)
        expect(avxtoAssetFor(chain('evm:43113'))?.symbol).toBe('SMTK')
        expect(avxtoAssetFor(chain('evm:1'))).toBeNull()
        expect(avxtoAssetFor(chain('solana:mainnet-beta'))).toBeNull()
    })

    it('has an NTT entry that is not deployed yet', () => {
        const d = nttDeploymentForToken('Mainnet', 'Avalanche', AVXTO_CONTRACT_ADDRESS.toLowerCase())
        expect(d?.symbol).toBe('AVXTO')
        expect(isDeployed(d?.chains.Avalanche)).toBe(false)
        expect(isDeployed({ token: '0x1', manager: '0x2', transceiver: { wormhole: '0x3' } })).toBe(true)
        expect(NTT_DEPLOYMENTS.every((x) => x.hubChain === 'Avalanche')).toBe(true)
    })

    it('is never sent over the Token Bridge, which would mint an unofficial wrapped AVXTO', async () => {
        const from = avxtoAssetFor(chain('evm:43114'))
        if (!from) throw new Error('no AVXTO')
        await expect(
            wormholeProvider.quote({ from, toChain: chain('evm:1'), amount: BigInt(10), sender: ME, recipient: ME })
        ).rejects.toThrow(/NTT/)
    })
})

describe('registry', () => {
    afterEach(() => listProviders().forEach((p) => setProviderEnabled(p.id, true)))

    it('picks providers by pair: Wormhole between EVM/Solana, THORChain for native BTC', () => {
        const avax = nativeAsset(chain('evm:43114'))
        const btc = nativeAsset(chain('bitcoin:mainnet'))
        expect(providersFor(avax, chain('evm:1')).map((p) => p.id)).toEqual(['wormhole', 'thorchain'])
        expect(providersFor(avax, chain('solana:mainnet-beta')).map((p) => p.id)).toEqual(['wormhole'])
        // Bitcoin ↔ Avalanche always goes through the Avalanche Bridge for Bitcoin (Lombard), not THORChain.
        expect(providersFor(btc, chain('evm:43114')).map((p) => p.id)).toEqual(['avalanche-bridge-btc'])
        expect(providersFor(btc, chain('evm:1')).map((p) => p.id)).toEqual(['thorchain'])
        expect(providersFor(btc, chain('solana:mainnet-beta'))).toEqual([])
        expect(providersFor(avax, chain('evm:11155111'))).toEqual([]) // mainnet ↔ testnet
        expect(providersFor(avax, chain('evm:43114'))).toEqual([])
        // Tokens are Wormhole only.
        const usdc = { chainId: 'evm:43114', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 }
        expect(providersFor(usdc, chain('evm:1')).map((p) => p.id)).toEqual(['wormhole'])
    })

    it('can switch a provider off, and remembers it', () => {
        const avax = nativeAsset(chain('evm:43114'))
        setProviderEnabled('wormhole', false)
        expect(isProviderEnabled('wormhole')).toBe(false)
        expect(JSON.parse(localStorage.getItem('bridge_disabled_providers') ?? '[]')).toEqual(['wormhole'])
        expect(providersFor(avax, chain('evm:1')).map((p) => p.id)).toEqual(['thorchain'])
    })

    it('quotes every provider in parallel, best first, and reports the ones that fail', async () => {
        const req = { from: nativeAsset(chain('evm:43114')), toChain: chain('evm:1'), amount: BigInt(1), sender: ME, recipient: ME }
        const q = (providerId: string, amount: string, etaSeconds: number): BridgeQuote => ({
            providerId,
            routeId: providerId,
            routeName: providerId,
            request: req,
            receive: { asset: { chainId: 'evm:1', address: NATIVE, symbol: 'ETH', decimals: 18 }, amount: BigInt(amount), kind: 'native' },
            fees: [],
            etaSeconds,
            needsClaim: false,
            warnings: [],
            data: null,
        })
        const wh = jest.spyOn(wormholeProvider, 'quote').mockResolvedValue(q('wormhole', '5', 60))
        const tc = jest.spyOn(thorchainProvider, 'quote').mockResolvedValue(q('thorchain', '9', 600))
        let res = await quoteAll(req)
        expect(res.quotes.map((x) => x.providerId)).toEqual(['thorchain', 'wormhole'])

        tc.mockRejectedValue(new Error('THORChain is halted'))
        res = await quoteAll(req)
        expect(res.quotes.map((x) => x.providerId)).toEqual(['wormhole'])
        expect(res.errors).toEqual([{ providerId: 'thorchain', providerName: 'THORChain', message: 'THORChain is halted' }])
        wh.mockRestore()
        tc.mockRestore()
    })
})

describe('history', () => {
    it('saves transfers newest first, updates in place and persists', () => {
        const req = { from: nativeAsset(chain('evm:43114')), toChain: chain('evm:1'), amount: BigInt(7), sender: ME, recipient: ME }
        const quote: BridgeQuote = {
            providerId: 'wormhole',
            routeId: 'wormhole:token-bridge',
            routeName: 'Wormhole Token Bridge',
            request: req,
            receive: { asset: { chainId: 'evm:1', address: '0xabc', symbol: 'WAVAX', decimals: 18 }, amount: BigInt(7), kind: 'wrapped' },
            fees: [],
            etaSeconds: 65,
            needsClaim: true,
            warnings: [],
            data: null,
        }
        const a = newTransfer(quote, '0xaaa')
        const b = { ...newTransfer(quote, '0xbbb'), createdAt: a.createdAt + 1 }
        expect(a.id).toBe('wormhole:0xaaa')
        expect(a.amountIn).toBe('7')
        saveTransfer(a)
        saveTransfer(b)
        expect(bridgeTransfers.value.map((t) => t.id)).toEqual(['wormhole:0xbbb', 'wormhole:0xaaa'])
        saveTransfer({ ...a, status: 'ready_to_claim' })
        expect(getTransfer(a.id)?.status).toBe('ready_to_claim')
        expect(bridgeTransfers.value).toHaveLength(2)
        expect(JSON.parse(localStorage.getItem('bridge_transfers_v1') ?? '[]')).toHaveLength(2)
        removeTransfer(a.id)
        removeTransfer(b.id)
        expect(bridgeTransfers.value).toEqual([])
    })
})
