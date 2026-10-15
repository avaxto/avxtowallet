/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The shared P-Chain signing step (js/permissionlessDelegate.ts), used by both
 * delegation and the P-Chain send: sign with every candidate key, refuse a
 * partly-signed transaction, respect "sign only", otherwise issue.
 */
const issued: string[] = []
jest.mock('@/AVA', () => ({ pChain: { issueTx: async (hex: string) => (issued.push(hex), 'P-TXID') } }))
const offline = { isActive: false, capture: jest.fn((r: any) => `offline:${r.label}`) }
jest.mock('@/stores/offlineSigning', () => ({ useOfflineSigningStore: () => offline }))
jest.mock('@/stores/pinia', () => ({ pinia: {} }))
jest.mock('@avalanche-sdk/client', () => ({ createAvalancheWalletClient: () => ({}) }))

import { signLocallyAndIssueP } from '@/js/permissionlessDelegate'

function fakeTx(slotsNeeded: number) {
    const sigs: string[] = []
    return {
        sigs,
        toBytes: () => new Uint8Array([1, 2, 3]),
        addSignature: (s: Uint8Array) => sigs.push(Buffer.from(s).toString('hex')),
        hasAllSignatures: () => sigs.length >= slotsNeeded,
        getSignedTx: () => ({ toBytes: () => new Uint8Array([9, 9]) }),
    }
}
const account = (hex: string) => ({ signTransaction: jest.fn(async () => `0x${hex}`) })

beforeEach(() => {
    issued.length = 0
    offline.isActive = false
    offline.capture.mockClear()
})

describe('signing a P-Chain transaction locally', () => {
    it('signs with every candidate key, then issues the signed bytes', async () => {
        const tx = fakeTx(2)
        const id = await signLocallyAndIssueP(tx, [account('aa'), account('bb')], 'Send on P-Chain')
        expect(tx.sigs).toEqual(['aa', 'bb'])
        expect(id).toBe('P-TXID')
        expect(issued).toHaveLength(1)
        expect(issued[0]).toMatch(/^0x0909/) // the signed bytes, with a checksum appended
    })

    it('refuses to issue a transaction missing a signature, naming the funds', async () => {
        await expect(signLocallyAndIssueP(fakeTx(3), [account('aa')], 'Send on P-Chain')).rejects.toThrow(/The funds may be spread/)
        await expect(signLocallyAndIssueP(fakeTx(3), [account('aa')], 'Delegate stake', 'The stake')).rejects.toThrow(/The stake may be spread/)
        expect(issued).toHaveLength(0)
    })

    it('captures instead of issuing when "sign only" is on, under the given label', async () => {
        offline.isActive = true
        const id = await signLocallyAndIssueP(fakeTx(1), [account('aa')], 'Send on P-Chain')
        expect(id).toBe('offline:Send on P-Chain')
        expect(offline.capture.mock.calls[0][0]).toMatchObject({ label: 'Send on P-Chain', family: 'avalanche', chain: 'P' })
        expect(issued).toHaveLength(0)
    })

    it('needs at least one key', async () => {
        await expect(signLocallyAndIssueP(fakeTx(1), [], 'x')).rejects.toThrow(/No signing key/)
    })
})
