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
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        const [from, to] = w.findAll('select').map((s) => (s.element as HTMLSelectElement).value)
        expect([from, to]).toEqual(['evm:43114', 'evm:1'])
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

    it('says AVXTO is not on a chain until its NTT spoke exists', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.findAll('select')[0].setValue('evm:1')
        await flushPromises()
        await w.findAll('.asset_tabs button').find((b) => b.text() === 'AVXTO')!.trigger('click')
        await flushPromises()
        expect(w.text()).toContain('AVXTO is not on Ethereum yet')
        w.unmount()
    })

    it('explains that Bitcoin ↔ Solana has no provider', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.findAll('select')[0].setValue('bitcoin:mainnet')
        await flushPromises()
        await w.findAll('select')[1].setValue('solana:mainnet-beta')
        await flushPromises()
        expect(w.text()).toContain('No provider moves Bitcoin to or from Solana directly')
        // Bitcoin is native-only.
        expect(w.findAll('.asset_tabs button').map((b) => b.text())).toEqual(['BTC'])
        w.unmount()
    })

    it('switches to testnets with a testnet default pair', async () => {
        const w = mount(UniversalBridge, { global: { stubs } })
        await flushPromises()
        await w.findAll('.net_toggle button')[1].trigger('click')
        await flushPromises()
        const [from, to] = w.findAll('select').map((s) => (s.element as HTMLSelectElement).value)
        expect([from, to]).toEqual(['evm:43113', 'evm:11155111'])
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
