/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Bridge page (/wallet/xbridge) and the run layer under it: routes are
 * quoted for everyone, sending and claiming go through the premium gate, the
 * send is re-quoted fresh and authorized for the source wallet, and pairs no
 * provider serves explain why.
 */
import { flushPromises, mount } from '@vue/test-utils'

import { NATIVE, type BridgeQuote, type BridgeQuoteRequest } from '@/bridge/types'

const ME = '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537'

// ── wallet surroundings ──
const offline = { isActive: false }
jest.mock('@/stores', () => ({ useOfflineSigningStore: () => offline }))
jest.mock('@/platforms/evm/store', () => ({ useEvmStore: () => ({ network: {}, wallet: {}, setNetwork: jest.fn() }) }))
jest.mock('@/platforms', () => ({ getPlatform: () => undefined }))

const authorizeBatch = jest.fn((_w: unknown, _r: string, fn: () => Promise<unknown>) => fn())
jest.mock('@/js/security/authorize', () => ({
    authorizeBatch: (w: unknown, r: string, fn: () => Promise<unknown>) => authorizeBatch(w, r, fn),
    SessionAuthCancelled: class extends Error {},
}))

const signer = { authSubject: { who: 'evm' } }
jest.mock('@/bridge/signers', () => ({
    walletSigners: { evm: () => signer, solana: () => null, bitcoin: () => null },
    canSignOn: (c: any) => c.kind === 'evm',
    ownAddressOn: (c: any) => (c.kind === 'evm' ? '0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537' : ''),
}))
jest.mock('@/bridge/assets', () => ({
    ...jest.requireActual('@/bridge/assets'),
    readBalance: jest.fn(async () => BigInt('10000000000000000000')),
}))

const USDC_AVAX = { chainId: 'evm:43114', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', name: 'USD Coin', decimals: 6 }
const USDC_ETH = { chainId: 'evm:1', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 }
const suggest = jest.fn()
jest.mock('@/bridge/tokens', () => ({
    ...jest.requireActual('@/bridge/tokens'),
    portfolioTokens: async (chain: any) =>
        chain.id === 'evm:43114'
            ? [
                  { chainId: chain.id, address: 'native', symbol: 'AVAX', name: 'Avalanche', decimals: 18, balance: BigInt('10000000000000000000'), verified: true },
                  Object.assign({}, USDC_AVAX, { balance: BigInt(250_000_000), verified: true }),
                  { chainId: chain.id, address: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', symbol: 'WETH.e', name: 'Wrapped Ether', decimals: 18, balance: BigInt('131700000000000000'), verified: true },
              ]
            : [{ chainId: chain.id, address: 'native', symbol: chain.native.symbol, name: chain.native.name, decimals: chain.native.decimals, balance: BigInt(0), verified: true }],
    suggestReceiveTokens: (...a: any[]) => suggest(...a),
    resolveToken: async (_c: any, t: any) => (t.address === 'native' ? { chainId: t.chainId, address: 'native', symbol: t.symbol, decimals: 18 } : USDC_ETH),
}))

// The premium gate (Moats AVXTO burn). `open` = requirement met.
const gate = { open: true, blocked: false, checks: 0 }
jest.mock('@/composables/useBaseAssetGate', () => ({
    useBaseAssetGate: () => ({
        isBlocked: gate.blocked,
        gatedAction: async (fn: () => unknown) => {
            gate.checks++
            if (!gate.open) return false
            await fn()
            return true
        },
    }),
}))

import { wormholeProvider } from '@/bridge/wormhole/provider'
import { thorchainProvider } from '@/bridge/thorchain/provider'
import { avalancheBridgeProvider } from '@/bridge/avalancheBridge/provider'
import { bridgeTransfers, removeTransfer } from '@/bridge/history'
import { runTransfer } from '@/bridge/run'
import UniversalBridge from '@/views/wallet/UniversalBridge.vue'

function quoteFor(req: BridgeQuoteRequest, providerId = 'wormhole'): BridgeQuote {
    return {
        providerId,
        routeId: `${providerId}:route`,
        routeName: providerId === 'wormhole' ? 'Wormhole Token Bridge' : 'THORChain swap',
        request: req,
        receive: { asset: { chainId: req.toChain.id, address: '0xwavax', symbol: 'WAVAX', decimals: 18 }, amount: req.amount, kind: 'wrapped' },
        fees: [{ label: 'Wormhole message fee', amount: BigInt(0), symbol: 'AVAX', decimals: 18, paidAs: 'source' }],
        etaSeconds: 65,
        needsClaim: true,
        warnings: ['Arrives as Wormhole-wrapped AVAX.'],
        data: null,
    }
}

const stubs = {
    fa: true,
    'router-link': { template: '<a><slot /></a>' },
    RegistryCheck: true,
    'v-btn': {
        props: ['disabled', 'loading'],
        emits: ['click'],
        template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}

const settle = async () => {
    await flushPromises()
    await new Promise((r) => setTimeout(r, 700)) // the quote debounce
    await flushPromises()
}

const bridgeButton = (w: any) => w.findAll('button.v_btn').find((b: any) => /^(Bridge|Insufficient)/.test(b.text()))

let whQuote: jest.SpyInstance
let whExecute: jest.SpyInstance
let tcQuote: jest.SpyInstance

beforeEach(() => {
    offline.isActive = false
    gate.open = true
    gate.blocked = false
    gate.checks = 0
    authorizeBatch.mockClear()
    whQuote = jest.spyOn(wormholeProvider, 'quote').mockImplementation(async (req) => quoteFor(req))
    tcQuote = jest.spyOn(thorchainProvider, 'quote').mockRejectedValue(new Error('THORChain minimum is 0.5 AVAX.'))
    whExecute = jest.spyOn(wormholeProvider, 'execute').mockImplementation(async (q) => ({
        id: 'wormhole:0xsent',
        providerId: 'wormhole',
        routeId: q.routeId,
        routeName: q.routeName,
        fromChainId: q.request.from.chainId,
        toChainId: q.request.toChain.id,
        fromSymbol: q.request.from.symbol,
        toSymbol: q.receive.asset.symbol,
        fromDecimals: 18,
        toDecimals: 18,
        amountIn: q.request.amount.toString(),
        expectedOut: q.receive.amount.toString(),
        sender: ME,
        recipient: ME,
        sourceTxHash: '0xsent',
        status: 'in_transit',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        data: {},
    }))
})
afterEach(() => {
    jest.restoreAllMocks()
    bridgeTransfers.value.slice().forEach((t) => removeTransfer(t.id))
})

describe('the Bridge page', () => {
    it('defaults to Avalanche → Ethereum with my own address, and shows routes from every provider', async () => {
        suggest.mockReset()
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        const sel = (id: string) => (w.find(id).element as HTMLSelectElement).value
        expect([sel('#bridge-from-chain'), sel('#bridge-to-chain')]).toEqual(['evm:43114', 'evm:1'])
        expect((w.find('#bridge-recipient').element as HTMLInputElement).value).toBe(ME)
        expect(w.text()).toContain('Balance: 10 AVAX')

        await w.find('.amount_input').setValue('1.5')
        await settle()
        expect(whQuote).toHaveBeenCalledTimes(1)
        const req = whQuote.mock.calls[0][0] as BridgeQuoteRequest
        expect(req).toMatchObject({ amount: BigInt('1500000000000000000'), recipient: ME, sender: ME })
        expect(req.from.address).toBe(NATIVE)
        expect(w.text()).toContain('You receive 1.5 WAVAX')
        expect(w.text()).toContain('Wormhole-wrapped')
        expect(w.text()).toContain('Finish with a claim on Ethereum')
        // A provider that could not quote says why rather than vanishing.
        expect(w.text()).toContain('THORChain: THORChain minimum is 0.5 AVAX.')
        w.unmount()
    })

    it('sends a fresh quote of the chosen route through the gate, and records it', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('.amount_input').setValue('1.5')
        await settle()
        await bridgeButton(w).trigger('click')
        await flushPromises()

        expect(gate.checks).toBe(1)
        expect(whQuote).toHaveBeenCalledTimes(2) // the shown quote, then a fresh one to send
        expect(whExecute).toHaveBeenCalledTimes(1)
        expect(authorizeBatch.mock.calls[0][0]).toBe(signer.authSubject)
        expect(bridgeTransfers.value.map((t) => t.id)).toEqual(['wormhole:0xsent'])
        expect(w.text()).toContain('Sent. In transit')
        expect(w.text()).toContain('Your transfers')
        w.unmount()
    })

    it('sends nothing when the premium requirement is not met', async () => {
        gate.open = false
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('.amount_input').setValue('1')
        await settle()
        await bridgeButton(w).trigger('click')
        await flushPromises()
        expect(gate.checks).toBe(1)
        expect(whExecute).not.toHaveBeenCalled()
        w.unmount()
    })

    it('disables Bridge while the gate is known to be unmet, but still quotes', async () => {
        gate.blocked = true
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('.amount_input').setValue('1')
        await settle()
        expect(w.text()).toContain('You receive 1 WAVAX')
        expect(bridgeButton(w).attributes('disabled')).toBeDefined()
        w.unmount()
    })

    it('refuses to bridge with offline signing on', async () => {
        offline.isActive = true
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('.amount_input').setValue('1')
        await settle()
        expect(w.text()).toContain('Offline signing is on')
        expect(bridgeButton(w).attributes('disabled')).toBeDefined()
        w.unmount()
    })

    it('lists the tokens in my portfolio to send, and quotes the one I pick', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        const options = w.findAll('#bridge-from-token option').map((o) => o.text())
        expect(options[0]).toMatch(/^AVAX — 10/)
        expect(options[1]).toMatch(/^USDC — 250 · 0xB97E…8a6E ✓/)
        await w.find('#bridge-from-token').setValue(USDC_AVAX.address)
        await w.find('.amount_input').setValue('100')
        await settle()
        const req = whQuote.mock.calls[0][0] as BridgeQuoteRequest
        expect(req.from).toMatchObject({ address: USDC_AVAX.address, symbol: 'USDC', decimals: 6 })
        expect(req.amount).toBe(BigInt(100_000_000))
        w.unmount()
    })

    it('suggests receive tokens as I type, and asks routes for the one I pick', async () => {
        suggest.mockResolvedValue({
            suggestions: [{ chainId: 'evm:1', address: USDC_ETH.address, symbol: 'USDC', name: 'USD Coin', decimals: 6, source: 'tokenlist', verified: false }],
            searchedWeb: true,
        })
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        const input = w.find('#bridge-receive-token')
        await input.trigger('focus')
        await input.setValue('usd')
        await new Promise((r) => setTimeout(r, 450))
        await flushPromises()
        expect(suggest.mock.calls[0][0].id).toBe('evm:1')
        expect(suggest.mock.calls[0][1]).toBe('usd')
        expect(w.text()).toContain('Not in the local registry')
        const item = w.findAll('.suggestion')
        expect(item).toHaveLength(1)
        expect(item[0].text()).toContain('Uniswap list')
        await item[0].trigger('mousedown')
        await flushPromises()
        expect(w.text()).toContain(`Receive USDC ${USDC_ETH.address}`)
        expect(w.text()).toContain('not in the registry')

        await w.find('.amount_input').setValue('1')
        await settle()
        const req = whQuote.mock.calls[whQuote.mock.calls.length - 1][0] as BridgeQuoteRequest
        expect(req.receiveToken).toMatchObject({ address: USDC_ETH.address, symbol: 'USDC' })
        // Wormhole would deliver wrapped AVAX: the card says so.
        expect(w.text()).toContain('Delivers WAVAX, not USDC')
        expect(w.text()).toContain('No route delivers USDC for this pair')
        w.unmount()
    })

    it('puts the route that delivers the chosen token first and selects it', async () => {
        suggest.mockResolvedValue({
            suggestions: [{ chainId: 'evm:1', address: USDC_ETH.address, symbol: 'USDC', name: 'USD Coin', decimals: 6, source: 'registry', verified: true }],
            searchedWeb: false,
        })
        tcQuote.mockImplementation(async (req: BridgeQuoteRequest) =>
            Object.assign(quoteFor(req, 'thorchain'), {
                receive: { asset: Object.assign({}, USDC_ETH), amount: BigInt(30_000_000), kind: 'canonical' },
            })
        )
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        const input = w.find('#bridge-receive-token')
        await input.trigger('focus')
        await input.setValue('USDC')
        await new Promise((r) => setTimeout(r, 450))
        await flushPromises()
        await w.findAll('.suggestion')[0].trigger('mousedown')
        await flushPromises()
        await w.find('.amount_input').setValue('1')
        await settle()
        const cards = w.findAll('.route')
        expect(cards[0].text()).toContain('✓ Delivers USDC')
        expect(cards[0].classes()).toContain('selected')
        expect(cards[1].text()).toContain('Delivers WAVAX, not USDC')
        w.unmount()
    })

    it('uses the Avalanche Bridge, not Wormhole, for WETH.e to Ethereum — and says so', async () => {
        const abQuote = jest.spyOn(avalancheBridgeProvider, 'quote').mockImplementation(async (req) =>
            Object.assign(quoteFor(req, 'avalanche-bridge'), {
                routeName: 'Avalanche Bridge',
                receive: { asset: { chainId: 'evm:1', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 }, amount: BigInt('123547636279832587'), kind: 'canonical' },
                needsClaim: false,
            })
        )
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        expect(w.text()).not.toContain('Using the Avalanche Bridge')
        await w.find('#bridge-from-token').setValue('0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB')
        await flushPromises()
        expect(w.find('.notice').text()).toContain('Using the Avalanche Bridge')
        expect(w.find('.notice').text()).toContain('You receive WETH on Ethereum at your own address')
        expect(w.find('.notice').text()).toContain('Unwrapping WETH to ETH is an optional extra step')
        await w.find('.amount_input').setValue('0.1317')
        await settle()
        expect(abQuote).toHaveBeenCalledTimes(1)
        expect(whQuote).not.toHaveBeenCalled()
        expect(w.text()).toContain('You receive 0.123547 WETH')
        expect(w.find('.using').text()).toContain('Bridge in use: Avalanche Bridge')
        expect(bridgeButton(w).text()).toBe('Bridge WETH.e to Ethereum with Avalanche Bridge')
        // Another destination goes back to Wormhole, and the notice goes away.
        await w.find('#bridge-to-chain').setValue('evm:8453')
        await flushPromises()
        expect(w.find('.notice').exists()).toBe(false)
        w.unmount()
    })

    it('warns on Wormhole routes to check the destination token, and shows its contract', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('.amount_input').setValue('1')
        await settle()
        const card = w.findAll('.route').find((c) => c.text().includes('Wormhole Token Bridge'))!
        expect(card.find('.dest_token').text()).toContain('WAVAX on Ethereum: 0xwavax')
        expect(card.find('.wormhole_warn').text()).toMatch(/only works when AVAX has an equivalent on Ethereum/)
        expect(card.find('.wormhole_warn').text()).toMatch(/bridging them back again/)
        expect(w.find('.using').text()).toContain('Bridge in use: Wormhole')
        // Not an Avalanche Bridge token between Avalanche and Ethereum: said so.
        expect(w.text()).toContain('it does not carry AVAX')
        w.unmount()
    })

    it('uses the Avalanche Bridge for Bitcoin for BTC → BTC.b, and points AVAX ↔ BTC to Quick swap', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('#bridge-from-chain').setValue('bitcoin:mainnet')
        await flushPromises()
        await w.find('#bridge-to-chain').setValue('evm:43114')
        await flushPromises()
        expect(w.text()).toContain('Using the Avalanche Bridge for Bitcoin')
        // AVAX → Bitcoin is not a bridge pair: the page says where to go instead.
        await w.find('#bridge-from-chain').setValue('evm:43114')
        await flushPromises()
        await w.find('#bridge-to-chain').setValue('bitcoin:mainnet')
        await flushPromises()
        expect(w.text()).toContain('carries BTC ↔ BTC.b only')
        expect(w.text()).toContain('Bitcoin Swaps → Quick swap')
        w.unmount()
    })

    it('explains that Bitcoin ↔ Solana has no provider', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.find('#bridge-from-chain').setValue('bitcoin:mainnet')
        await flushPromises()
        await w.find('#bridge-to-chain').setValue('solana:mainnet-beta')
        await flushPromises()
        expect(w.text()).toContain('No provider moves Bitcoin to or from Solana directly')
        expect(w.findAll('#bridge-from-token option').map((o) => o.text())).toEqual(['BTC — 0'])
        w.unmount()
    })

    it('switches to testnets with a testnet default pair', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.findAll('.net_toggle button')[1].trigger('click')
        await flushPromises()
        const sel = (id: string) => (w.find(id).element as HTMLSelectElement).value
        expect([sel('#bridge-from-chain'), sel('#bridge-to-chain')]).toEqual(['evm:43113', 'evm:11155111'])
        w.unmount()
    })
})

describe('runTransfer', () => {
    it('refuses while offline signing is on', async () => {
        offline.isActive = true
        const req = { from: { chainId: 'evm:43114', address: NATIVE, symbol: 'AVAX', decimals: 18 }, toChain: {} as any, amount: BigInt(1), sender: ME, recipient: ME }
        await expect(runTransfer(quoteFor(req))).rejects.toThrow(/offline signing/)
        expect(whExecute).not.toHaveBeenCalled()
    })
})
