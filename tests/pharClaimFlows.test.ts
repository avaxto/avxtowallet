/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Claim-and-unwrap and claim-to-X-Chain: built from the single claim and
 * unwrap steps, they must unwrap exactly what the claim paid (never WAVAX the
 * wallet already held), refuse non-WAVAX payouts before anything is sent, and
 * hand the cross-chain export exactly the claimed AVAX minus the two fees.
 */
import Web3 from 'web3'

import { BN } from '@/avalanche'
import { WAVAX_ADDRESS } from '@/js/PharSwap'
import { claimAndUnwrap, claimToXChain, planCrossChain, type CrossChainDeps } from '@/js/PharClaimFlows'

jest.mock('@/stores/offlineSigning', () => ({
    ...jest.requireActual('@/stores/offlineSigning'),
    isOfflineTxId: (id: string) => String(id).startsWith('offline-'),
}))

const ME = '0x4887c61ee00a4df4191533f3e7be62bd00ea2537'
const USDC = '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'
const E18 = (n: string) => new BN(n).mul(new BN('1000000000000000000'))
const HELD = E18('5') // WAVAX in the wallet before claiming
const CLAIMED = new BN('120183040811386474300') // ≈ 120.18 WAVAX

function fakeSigner(opts: { payout?: string; offline?: boolean } = {}) {
    const word = (hex: string) => hex.replace(/^0x/, '').padStart(64, '0')
    let claimMined = false
    const sent: any[] = []
    const provider = {
        send(payload: any, cb: (e: any, r?: any) => void) {
            const reply = (result: any) => cb(null, { jsonrpc: '2.0', id: payload.id, result })
            if (payload.method !== 'eth_call') return reply('0x0')
            const { data } = payload.params[0]
            if (data.startsWith('0x04045d72')) return reply('0x' + word(opts.payout ?? WAVAX_ADDRESS))
            if (data.startsWith('0x008cc262')) return reply('0x' + word(CLAIMED.toString(16)))
            if (data.startsWith('0x70a08231')) return reply('0x' + word((claimMined ? HELD.add(CLAIMED) : HELD).toString(16)))
            return reply('0x')
        },
    }
    const signer = {
        network: { evmChainId: 43114, name: 'Avalanche C-Chain' },
        address: ME,
        authSubject: {},
        reader: () => new Web3(provider as any),
        assertOnChain: jest.fn(async () => {}),
        estimateGas: jest.fn(async () => 120_000),
        getNonce: jest.fn(async () => 10),
        send: jest.fn(async (req: any) => {
            sent.push(req)
            if (req.data === '0x4e71d92d' && !opts.offline) claimMined = true
            return opts.offline ? `offline-${sent.length}` : `0xtx${sent.length}`
        }),
        waitForReceipt: jest.fn(async (h: string) => ({ txHash: h, contractAddress: null, status: true })),
    }
    return { signer: signer as any, sent }
}

const withdrawData = (amount: BN) => '0x2e1a7d4d' + amount.toString(16).padStart(64, '0')

describe('claimAndUnwrap', () => {
    it('claims, then unwraps exactly what the claim paid — not WAVAX already held', async () => {
        const { signer, sent } = fakeSigner()
        const steps: string[] = []
        const res = await claimAndUnwrap(signer, (s, st) => steps.push(`${s}:${st}`))

        expect(sent.map((t) => t.data.slice(0, 10))).toEqual(['0x4e71d92d', '0x2e1a7d4d'])
        expect(sent[1].to).toBe(WAVAX_ADDRESS)
        expect(sent[1].data).toBe(withdrawData(CLAIMED)) // 120.18, not 125.18
        expect(res.unwrapped.toString()).toBe(CLAIMED.toString())
        expect(steps).toEqual(['claim:running', 'claim:done', 'unwrap:running', 'unwrap:done'])
    })

    it('refuses before sending anything when rewards are not paid in WAVAX', async () => {
        const { signer, sent } = fakeSigner({ payout: USDC })
        await expect(claimAndUnwrap(signer)).rejects.toThrow(/not paid in WAVAX/)
        expect(sent).toHaveLength(0)
    })

    it('under offline signing, queues the unwrap of the pending amount on the next nonce', async () => {
        const { signer, sent } = fakeSigner({ offline: true })
        const res = await claimAndUnwrap(signer)
        expect(res.offline).toBe(true)
        expect(sent[0].nonce).toBe(10)
        expect(sent[1].nonce).toBe(11)
        expect(sent[1].data).toBe(withdrawData(CLAIMED))
    })
})

const deps = (over: Partial<CrossChainDeps> = {}): CrossChainDeps => ({
    getBaseFee: async () => new BN('30000000000'), // 30 gwei, priced at 2x = 60 gwei
    estimateExportGas: () => 11_230,
    xImportFee: () => new BN(1_000_000), // 0.001 AVAX
    sleep: async () => {},
    ...over,
})

const wallet = (over: any = {}) => ({
    getEvmAddress: () => ME.slice(2),
    getIndexZeroAddressAvm: () => 'X-avax1example',
    exportFromCChain: jest.fn(async () => 'exportTx'),
    importToXChain: jest.fn(async () => 'importTx'),
    ...over,
})

describe('planCrossChain', () => {
    it('prices the export at twice the base fee (50 gwei floor) and leaves the rest to arrive on X', async () => {
        const available = new BN('120183040811') // nAVAX
        const fees = await planCrossChain(available, wallet(), deps())
        // 60 gwei × 11,230 gas = 673,800 gwei = 673,800 nAVAX
        expect(fees.exportFee.toString()).toBe('673800')
        expect(fees.importFee.toString()).toBe('1000000')
        expect(fees.sent.toString()).toBe(available.sub(new BN(673_800)).sub(new BN(1_000_000)).toString())

        const floored = await planCrossChain(available, wallet(), deps({ getBaseFee: async () => new BN('1000000000') }))
        expect(floored.exportFee.toString()).toBe(new BN(50).mul(new BN(11_230)).toString()) // 50 gwei floor
    })
})

describe('claimToXChain', () => {
    it('claims, unwraps, exports exactly the claimed AVAX minus fees, then imports on X', async () => {
        const { signer, sent } = fakeSigner()
        const w = wallet()
        const steps: string[] = []
        const res = await claimToXChain(signer, w, { offlineSigning: false, deps: deps(), onStep: (s, st) => st === 'done' && steps.push(s) })

        expect(sent).toHaveLength(2) // claim + unwrap on C; export/import go through the Avalanche wallet
        const claimedNAvax = CLAIMED.div(new BN(1_000_000_000))
        const expectedSent = claimedNAvax.sub(new BN(673_800)).sub(new BN(1_000_000))
        expect(w.exportFromCChain).toHaveBeenCalledWith(expect.anything(), 'X', expect.anything())
        const [amt, , fee] = (w.exportFromCChain as jest.Mock).mock.calls[0]
        expect(amt.toString()).toBe(expectedSent.toString())
        expect(fee.toString()).toBe('673800')
        expect(w.importToXChain).toHaveBeenCalledWith('C')
        expect(res).toMatchObject({ exportTxId: 'exportTx', importTxId: 'importTx' })
        expect(steps).toEqual(['claim', 'unwrap', 'export', 'import'])
    })

    it('retries the import while the exported UTXO is not importable yet', async () => {
        const { signer } = fakeSigner()
        const importToXChain = jest
            .fn()
            .mockRejectedValueOnce(new Error('Nothing to import.'))
            .mockRejectedValueOnce(new Error('Nothing to import.'))
            .mockResolvedValue('importTx')
        const res = await claimToXChain(signer, wallet({ importToXChain }), { offlineSigning: false, deps: deps() })
        expect(importToXChain).toHaveBeenCalledTimes(3)
        expect(res.importTxId).toBe('importTx')
    })

    it('refuses under offline signing, before claiming', async () => {
        const { signer, sent } = fakeSigner()
        await expect(claimToXChain(signer, wallet(), { offlineSigning: true, deps: deps() })).rejects.toThrow(/offline signing/)
        expect(sent).toHaveLength(0)
    })

    it('stops before the export when the rewards cannot cover the cross-chain fees', async () => {
        const { signer } = fakeSigner()
        const w = wallet()
        await expect(
            claimToXChain(signer, w, { offlineSigning: false, deps: deps({ xImportFee: () => new BN('999999999999') }) })
        ).rejects.toThrow(/too small to cover/)
        expect(w.exportFromCChain).not.toHaveBeenCalled()
    })
})
