/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Pharaoh AutoVault dashboard: the API parsers against live payloads, the
 * contract reads against the values the vault returned for the captured
 * session, and the page itself — always for the connected wallet's address.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'
import protocolFixture from './fixtures/phar/protocol-info.json'
import tokensFixture from './fixtures/phar/tokens.json'
import poolsFixture from './fixtures/phar/pools.json'

// ─── A fake C-Chain: every contract read the module makes, with live values ──

const WAVAX = '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'
const USDC = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const BTCB = '0x152b9d0FdC40C096757F570A51E494bd4b943E50'
const FBOMB = '0x5C09A9cE08C4B332Ef1CC5f7caDB1158C32767Ce'
const POOL_WAVAX_USDC = '0x8aC5707f8D4BDe1d771d34c7AfD81c3922b73379'
const POOL_PHAR_WAVAX = '0x0AFdEE8162CcEAD9AC6a30c94F691E6E7d1af670'
const POOL_UNKNOWN = '0x6111286604c6fABCd88633f80F4ABaeA15094F3D'

const calls: { addr: string; name: string; args: unknown[] }[] = []
const answers: Record<string, (...a: any[]) => unknown> = {
    // AutoVault
    totalSupply: () => '717069447638418994493213042',
    isUnlocked: () => true,
    OPERATOR: () => '0x41A9EBA9f39ceE0724c755414A88E9682b98d7FF',
    getOutputTokens: () => [USDC, WAVAX, BTCB],
    totalSupplyPerOutput: (o: string) =>
        ({ [USDC]: '652835750687257183523936792', [WAVAX]: '59724575726712982501263096', [BTCB]: '4509121224448828468013154' })[o],
    getPendingSwaps: () => ({ 0: [FBOMB, FBOMB], 1: [USDC, WAVAX], 2: ['337593972571302652806', '1063709151564158160550'] }),
    getClaimedInputTokens: () => [FBOMB, USDC, WAVAX],
    balanceOf: () => '1553521299621744467845626',
    earned: () => '250000000000000000',
    getStoredRewards: () => '0',
    outputPreference: () => WAVAX,
    allowance: () => '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    // Minter
    getPeriod: () => '2960',
    weeklyEmissions: () => '4989196987142668762419659',
    // xPHAR
    SLASHING_PENALTY: () => '500000',
    BASIS: () => '1000000',
    // Voter
    getVotes: (_who: string, period: number) =>
        period === 2960
            ? { 0: [POOL_WAVAX_USDC, POOL_PHAR_WAVAX, POOL_UNKNOWN], 1: ['300', '100', '100'] }
            : { 0: [POOL_PHAR_WAVAX], 1: ['50'] },
}

jest.mock('@/evm/providers', () => ({
    web3For: () => ({
        eth: {
            Contract: function (_abi: unknown, addr: string) {
                return {
                    methods: new Proxy(
                        {},
                        {
                            get: (_t, name: string) => (...args: unknown[]) => ({
                                call: async () => {
                                    calls.push({ addr: addr.toLowerCase(), name, args })
                                    // xPHAR's own balance/totalSupply differ from the vault's.
                                    if (addr.toLowerCase() === '0xe8164ea89665dab7a553e667f81f30cfda736b9a') {
                                        if (name === 'balanceOf') return '0'
                                        if (name === 'totalSupply') return '987005360262525616793199821'
                                    }
                                    return answers[name](...args)
                                },
                            }),
                        }
                    ),
                }
            },
        },
    }),
}))

import {
    parsePools,
    parseProtocolInfo,
    parseTokens,
    periodStart,
    readAutoVaultOnChain,
    AUTOVAULT_ADDRESS,
} from '@/js/PharAutoVault'

const ME = '0x1234567890abcdef1234567890abcdef12345678'

describe('Pharaoh API parsers', () => {
    it('reads protocol-info', () => {
        const p = parseProtocolInfo(protocolFixture)
        expect(p.currentPeriod).toBe(2960)
        expect(p.firstPeriod).toBe(2910)
        expect(p.pharPriceUSD).toBeCloseTo(0.1092, 3)
        expect(p.pctVoted).toBeCloseTo(0.978, 2)
    })

    it('reads token prices by lowercased address, dropping zero prices', () => {
        const t = parseTokens([...tokensFixture, { id: '0xABC', symbol: 'Z', decimals: 18, price: 0 }])
        expect(t.get(WAVAX.toLowerCase())?.symbol).toBe('WAVAX')
        expect(t.get(USDC.toLowerCase())?.decimals).toBe(6)
        expect(t.get('0xabc')?.price).toBeNull()
    })

    it('reads pools by lowercased address', () => {
        const p = parsePools(poolsFixture)
        expect(p.get(POOL_WAVAX_USDC.toLowerCase())?.symbol).toBe('WAVAX/USDC')
        expect(p.get(POOL_PHAR_WAVAX.toLowerCase())?.voteApr).toBeGreaterThan(0)
    })

    it('numbers periods in weeks from the Unix epoch', () => {
        expect(new Date(periodStart(2960)).toISOString()).toBe('2026-09-24T00:00:00.000Z')
    })
})

describe('readAutoVaultOnChain', () => {
    beforeEach(() => (calls.length = 0))

    it("reads the vault, and the connected wallet's own position", async () => {
        const { vault, user } = await readAutoVaultOnChain(ME)

        expect(vault.period).toBe(2960)
        expect(vault.totalShares.toString()).toBe('717069447638418994493213042')
        expect(vault.outputs.map((o) => o.token)).toEqual([USDC, WAVAX, BTCB])
        expect(vault.pendingSwaps).toHaveLength(2)
        expect(vault.pendingSwaps[1]).toMatchObject({ input: FBOMB, output: WAVAX })
        expect(vault.votesThisPeriod.map((v) => v.pool)).toEqual([POOL_WAVAX_USDC, POOL_PHAR_WAVAX, POOL_UNKNOWN])
        expect(vault.votesNextPeriod).toHaveLength(1)
        expect(vault.xpharExitPenalty).toBe(0.5)

        expect(user?.shares.toString()).toBe('1553521299621744467845626')
        expect(user?.outputPreference).toBe(WAVAX)

        // Every per-user read is for the connected wallet — never a fixed address.
        const userReads = calls.filter((c) =>
            ['balanceOf', 'earned', 'getStoredRewards', 'outputPreference', 'allowance'].includes(c.name)
        )
        expect(userReads.length).toBeGreaterThan(0)
        for (const c of userReads) expect(c.args[0]).toBe(ME)
        // The vault's votes, not the user's (a depositor has none of their own).
        for (const c of calls.filter((c) => c.name === 'getVotes')) expect(c.args[0]).toBe(AUTOVAULT_ADDRESS)
    })

    it('reads only the vault with no wallet', async () => {
        const { user } = await readAutoVaultOnChain(null)
        expect(user).toBeNull()
        expect(calls.some((c) => c.name === 'earned')).toBe(false)
    })
})

// ─── The page ──────────────────────────────────────────────────────────────

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

import PharAutoVault from '@/views/wallet/PharAutoVault.vue'

jest.mock('axios', () => ({
    get: jest.fn(async (url: string) => {
        if (url.endsWith('/protocol-info')) return { data: require('./fixtures/phar/protocol-info.json') }
        if (url.endsWith('/tokens')) return { data: require('./fixtures/phar/tokens.json') }
        if (url.includes('/pools')) return { data: require('./fixtures/phar/pools.json') }
        throw new Error('unexpected ' + url)
    }),
}))

function mountPage() {
    const pinia = createPinia()
    setActivePinia(pinia)
    return mount(PharAutoVault, { global: { plugins: [pinia], stubs: { fa: true } } })
}

describe('the AutoVault page', () => {
    beforeEach(() => (calls.length = 0))

    it("shows the connected wallet's position, the vault, its votes and the protocol", async () => {
        signerRef.current = { address: ME }
        const wrapper = mountPage()
        await flushPromises()
        await flushPromises()

        const text = wrapper.text()
        // Position, for the connected wallet.
        expect(text).toContain('0x1234…5678')
        expect(text).toContain('1,553,521 xPHAR')
        expect(text).toContain('0.2166%') // 1.55M of 717M
        expect(text).toContain('Paid out in')
        expect(text).toContain('0.25 WAVAX')
        expect(text).toContain('Unlimited')
        // Vault.
        expect(text).toContain('717,069,448 xPHAR')
        expect(text).toContain('Unlocked')
        expect(text).toContain('fBOMB → WAVAX')
        // Votes: named pools, the unknown one by address, sorted by weight.
        const rows = wrapper.findAll('tbody tr').map((r) => r.text())
        const voteRows = rows.filter((r) => /WAVAX\/USDC|PHAR\/WAVAX|0x6111/.test(r))
        expect(voteRows[0]).toContain('WAVAX/USDC')
        expect(voteRows.some((r) => r.includes('0x6111…4F3D'))).toBe(true)
        // Protocol.
        expect(text).toContain('PHAR price')
        expect(text).toContain('50% penalty')
        wrapper.unmount()
    })

    it('asks for a wallet for the personal panel when none is connected', async () => {
        signerRef.current = null
        const wrapper = mountPage()
        await flushPromises()
        await flushPromises()

        expect(wrapper.text()).toContain('Connect an Avalanche wallet')
        expect(calls.some((c) => c.name === 'earned')).toBe(false)
        wrapper.unmount()
    })
})
