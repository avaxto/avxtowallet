/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Claiming Pharaoh AutoVault rewards: the transaction must be exactly the one
 * phar.gg sends (captured in 2claim-rewards-ext.har: to the vault, no value,
 * data 0x4e71d92d = claim()), simulated before signing, and refused when there
 * is nothing to claim or the wallet is on another chain. Then the PHAR
 * Dashboard page around it.
 */
import { flushPromises, mount } from '@vue/test-utils'
import Web3 from 'web3'

import { BN } from '@/avalanche'
// The page tests below mock this module (jest.mock applies file-wide), so the
// claim itself is taken from the real implementation.
const { AUTOVAULT_ADDRESS, claimAutoVaultRewards } = jest.requireActual('@/js/PharAutoVault')

const ME = '0x4887c61ee00a4df4191533f3e7be62bd00ea2537'
const WAVAX = '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7'
const EARNED = new BN('120183040811386474300') // ≈ 120.18 WAVAX, the captured claim

/** A C-Chain that answers the vault's reads, and records every eth_call. */
function fakeChain(opts: { earned?: BN; claimReverts?: boolean } = {}) {
    const calls: string[] = []
    const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0')
    const provider = {
        send(payload: any, cb: (err: any, res?: any) => void) {
            const reply = (result: any) => cb(null, { jsonrpc: '2.0', id: payload.id, result })
            if (payload.method !== 'eth_call') return reply('0x0')
            const data: string = payload.params[0].data
            calls.push(data.slice(0, 10))
            if (data.startsWith('0x008cc262')) return reply('0x' + word((opts.earned ?? EARNED).toString(16)))
            if (data.startsWith('0x04045d72')) return reply('0x' + word(WAVAX))
            if (data.startsWith('0x4e71d92d')) {
                if (opts.claimReverts) return cb(null, { jsonrpc: '2.0', id: payload.id, error: { code: 3, message: 'execution reverted: Locked' } })
                return reply('0x')
            }
            return reply('0x')
        },
    }
    return { web3: new Web3(provider as any), calls }
}

function fakeSigner(opts: { chainId?: number; earned?: BN; claimReverts?: boolean; receiptOk?: boolean; txHash?: string } = {}) {
    const chain = fakeChain(opts)
    const sent: any[] = []
    const signer = {
        network: { evmChainId: opts.chainId ?? 43114, name: opts.chainId ? 'Ethereum' : 'Avalanche C-Chain' },
        address: ME,
        authSubject: {},
        reader: () => chain.web3,
        assertOnChain: jest.fn(async () => {}),
        estimateGas: jest.fn(async () => 130_646),
        send: jest.fn(async (req: any) => {
            sent.push(req)
            return opts.txHash ?? '0x98cf9366d51cc355cf7fc3197d571d0126f08e7b8dcb50805e5165ac39ec1b16'
        }),
        waitForReceipt: jest.fn(async (hash: string) => ({ txHash: hash, contractAddress: null, status: opts.receiptOk ?? true })),
    }
    return { signer: signer as any, sent, calls: chain.calls }
}

describe('claimAutoVaultRewards', () => {
    it("sends exactly phar.gg's claim: claim() on the vault, no value, after simulating it", async () => {
        const { signer, sent, calls } = fakeSigner()
        const res = await claimAutoVaultRewards(signer)

        expect(sent).toHaveLength(1)
        expect(sent[0].to).toBe(AUTOVAULT_ADDRESS)
        expect(sent[0].data).toBe('0x4e71d92d')
        expect(sent[0].value).toBeUndefined()
        expect(sent[0].gasLimit).toBe(130_646)
        // earned + outputPreference read, then claim() simulated — all before the send.
        expect(calls).toEqual(expect.arrayContaining(['0x008cc262', '0x04045d72', '0x4e71d92d']))
        expect(signer.assertOnChain).toHaveBeenCalled()

        expect(res.amount.toString()).toBe(EARNED.toString())
        expect(res.token.toLowerCase()).toBe(WAVAX)
        expect(res.offline).toBe(false)
    })

    it('refuses when there is nothing to claim, without asking to sign', async () => {
        const { signer, sent } = fakeSigner({ earned: new BN(0) })
        await expect(claimAutoVaultRewards(signer)).rejects.toThrow(/no AutoVault rewards to claim/)
        expect(sent).toHaveLength(0)
    })

    it('refuses on another chain', async () => {
        const { signer, sent } = fakeSigner({ chainId: 1 })
        await expect(claimAutoVaultRewards(signer)).rejects.toThrow(/Avalanche C-Chain/)
        expect(sent).toHaveLength(0)
    })

    it('stops at the simulation when the claim would revert', async () => {
        const { signer, sent } = fakeSigner({ claimReverts: true })
        await expect(claimAutoVaultRewards(signer)).rejects.toThrow(/Locked/)
        expect(sent).toHaveLength(0)
    })

    it('reports a mined-but-failed claim, and an offline capture', async () => {
        await expect(claimAutoVaultRewards(fakeSigner({ receiptOk: false }).signer)).rejects.toThrow(/claim transaction failed/)

        const offline = fakeSigner({ txHash: 'offline-1' })
        jest.requireMock('@/stores/offlineSigning')
        const res = await claimAutoVaultRewards(offline.signer)
        expect(res.offline).toBe(true)
        expect(offline.signer.waitForReceipt).not.toHaveBeenCalled()
    })
})

jest.mock('@/stores/offlineSigning', () => ({
    ...jest.requireActual('@/stores/offlineSigning'),
    isOfflineTxId: (id: string) => String(id).startsWith('offline-'),
}))

// ─── The page ──────────────────────────────────────────────────────────────

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

const offlineStore = { hasRecords: false, records: [], clearRecords: jest.fn() }
jest.mock('@/stores', () => ({ useOfflineSigningStore: () => offlineStore }))
jest.mock('@/js/security/authorize', () => ({
    authorizeSingle: (_w: unknown, _r: string, fn: () => Promise<unknown>) => fn(),
    SessionAuthCancelled: class extends Error {},
}))

const readOnChain = jest.fn()
const claimFn = jest.fn()
jest.mock('@/js/PharAutoVault', () => ({
    ...jest.requireActual('@/js/PharAutoVault'),
    readAutoVaultOnChain: (...a: any[]) => readOnChain(...a),
    readPharaohApi: async () => ({
        protocol: null,
        tokens: new Map([[WAVAX, { address: WAVAX, symbol: 'WAVAX', decimals: 18, price: 11.4 }]]),
        pools: new Map(),
    }),
    readTokenInfo: async () => [],
    claimAutoVaultRewards: (...a: any[]) => claimFn(...a),
}))

import PharDashboard from '@/views/wallet/PharDashboard.vue'

const vault = {
    totalShares: new BN('717069447638418994493213042'),
    isUnlocked: true,
    period: 2962,
    operator: '0x41A9EBA9f39ceE0724c755414A88E9682b98d7FF',
    outputs: [],
    pendingSwaps: [],
    claimedInputTokens: [],
    votesThisPeriod: [],
    votesNextPeriod: [],
    weeklyEmissions: new BN(0),
    xpharTotalSupply: new BN('987005360262525616793199821'),
    xpharExitPenalty: 0.5,
}
const userWith = (earned: BN) => ({
    address: ME,
    shares: new BN('1553521299621744467845626'),
    earned,
    storedRewards: new BN(0),
    outputPreference: WAVAX,
    xpharBalance: new BN(0),
    xpharAllowance: new BN(0),
})

const stubs = {
    fa: true,
    SignOnlyToggle: true,
    SignedTxExport: true,
    CopyText: { props: ['value'], template: '<span class="copy_stub"><slot /></span>' },
    'router-link': { template: '<a><slot /></a>' },
    'v-btn': {
        props: ['disabled', 'loading'],
        emits: ['click'],
        template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
    },
}

const claimButton = (w: any) => w.findAll('button.v_btn').find((b: any) => b.text() === 'Claim rewards')!

describe('the PHAR Dashboard', () => {
    beforeEach(() => {
        signerRef.current = { address: ME, authSubject: {}, network: { evmChainId: 43114, name: 'Avalanche C-Chain' } }
        readOnChain.mockReset()
        claimFn.mockReset()
    })

    it("shows the connected wallet's pending rewards in its payout token, with their dollar value", async () => {
        readOnChain.mockResolvedValue({ vault, user: userWith(EARNED) })
        const w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()

        expect(readOnChain).toHaveBeenCalledWith(ME)
        expect(w.find('.reward_amount').text()).toContain('120.183')
        expect(w.find('.reward_amount').text()).toContain('WAVAX')
        expect(w.find('.reward_usd').text()).toContain('$1,370') // 120.18 × $11.40
        expect(claimButton(w).attributes('disabled')).toBeUndefined()
        w.unmount()
    })

    it('claims, then shows the amount, the transaction and an explorer link', async () => {
        readOnChain
            .mockResolvedValueOnce({ vault, user: userWith(EARNED) })
            .mockResolvedValueOnce({ vault, user: userWith(new BN(0)) })
        claimFn.mockResolvedValue({ txHash: '0xabc123', offline: false, amount: EARNED, token: WAVAX })
        const w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()

        await claimButton(w).trigger('click')
        await flushPromises()

        expect(claimFn).toHaveBeenCalledWith(signerRef.current)
        expect(w.find('.claim_done').text()).toContain('Claimed 120.183')
        expect(w.find('.claim_done').text()).toContain('0xabc123')
        expect(w.find('.claim_done a').attributes('href')).toBe('https://snowtrace.io/tx/0xabc123')
        // Re-read after claiming: nothing left to claim.
        expect(claimButton(w).attributes('disabled')).toBeDefined()
        w.unmount()
    })

    it('shows why a claim failed', async () => {
        readOnChain.mockResolvedValue({ vault, user: userWith(EARNED) })
        claimFn.mockRejectedValue(new Error('execution reverted: Locked'))
        const w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()
        await claimButton(w).trigger('click')
        await flushPromises()

        expect(w.text()).toContain('execution reverted: Locked')
        w.unmount()
    })

    it('disables claiming with nothing pending, or on another chain', async () => {
        readOnChain.mockResolvedValue({ vault, user: userWith(new BN(0)) })
        let w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()
        expect(claimButton(w).attributes('disabled')).toBeDefined()
        expect(w.text()).toContain('Nothing to claim right now')
        w.unmount()

        signerRef.current = { address: ME, authSubject: {}, network: { evmChainId: 1, name: 'Ethereum' } }
        readOnChain.mockResolvedValue({ vault, user: userWith(EARNED) })
        w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()
        expect(claimButton(w).attributes('disabled')).toBeDefined()
        expect(w.text()).toContain('your wallet is on Ethereum')
        w.unmount()
    })

    it('asks for a wallet when none is connected', async () => {
        signerRef.current = null
        const w = mount(PharDashboard, { global: { stubs } })
        await flushPromises()
        expect(w.text()).toContain('Connect an Avalanche wallet')
        expect(readOnChain).not.toHaveBeenCalled()
        w.unmount()
    })
})
