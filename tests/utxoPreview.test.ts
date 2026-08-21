/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Reading selected UTXOs back off a built transaction.
 *
 * Built against real avalanche.js objects rather than mocks: the thing under
 * test is whether the right fields come off a `TransferableInput` and whether
 * change arithmetic holds, and both are properties of the SDK's own types.
 */
import { BN, Buffer } from '@/avalanche'
import {
    BaseTx,
    KeyChain as AVMKeyChain,
    SECPTransferInput,
    SECPTransferOutput,
    TransferableInput,
    TransferableOutput,
    UTXO as AVMUTXO,
} from '@/avalanche/apis/avm'
import { bintools } from '@/AVA'
import { previewFromTx, isEmptyPreview } from '@/js/utxoPreview'

function fill(byte: number, len = 32): Buffer {
    return Buffer.alloc(len, byte)
}

function outputIdxBuf(n: number): Buffer {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(n, 0)
    return b
}

/**
 * A transaction spending two UTXOs of the same asset.
 *
 * `amounts` are the two input values; the single output is what leaves the
 * wallet, so the difference is change.
 */
function buildFixture(amounts: number[], threshold = 1) {
    const keychain = new AVMKeyChain('avax', 'X')
    const owners = [keychain.makeKey(), keychain.makeKey(), keychain.makeKey()].map((k) =>
        k.getAddress()
    )
    const ownerSet = threshold > 1 ? owners : [owners[0]]

    const assetID = fill(0xaa)
    const ins: TransferableInput[] = []
    const utxos = new Map<string, AVMUTXO>()

    amounts.forEach((value, i) => {
        const txid = fill(0xb0 + i)
        const idx = outputIdxBuf(i)
        const amount = new BN(value)

        const sourceOutput = new SECPTransferOutput(amount, ownerSet, new BN(0), threshold)
        const utxo = new AVMUTXO(0, txid, idx, assetID, sourceOutput)

        const input = new SECPTransferInput(amount)
        input.addSignatureIdx(0, ownerSet[0])
        const xferIn = new TransferableInput(txid, idx, assetID, input)

        ins.push(xferIn)
        utxos.set(xferIn.getUTXOID(), utxo)
    })

    const sent = new BN(amounts.reduce((a, b) => a + b, 0) - 100)
    const out = new TransferableOutput(
        assetID,
        new SECPTransferOutput(sent, [owners[0]], new BN(0), 1)
    )

    const baseTx = new BaseTx(1, fill(0xcc), [out], ins)
    return {
        baseTx,
        assetId: bintools.cb58Encode(assetID),
        lookup: (id: string) => utxos.get(id),
        sent,
    }
}

describe('previewFromTx', () => {
    it('reads amount, asset and provenance off each selected input', () => {
        const { baseTx, assetId, lookup } = buildFixture([500, 300])
        const preview = previewFromTx(baseTx as any, lookup)

        expect(preview.rows).toHaveLength(2)
        for (const row of preview.rows) {
            expect(row.assetId).toBe(assetId)
            expect(row.txId).toBeTruthy()
            expect(row.utxoId).toContain('')
            expect(row.amount.gt(new BN(0))).toBe(true)
        }
        expect(preview.totals[assetId].toString()).toBe('800')
    })

    it('sorts largest first, so the surprising selection is on top', () => {
        const { baseTx, lookup } = buildFixture([100, 900, 400])
        const preview = previewFromTx(baseTx as any, lookup)
        const amounts = preview.rows.map((r) => r.amount.toNumber())
        expect(amounts).toEqual([900, 400, 100])
    })

    it('computes change as consumed minus sent', () => {
        // This is the number the whole preview exists for: spending a large
        // coin to send a small amount returns most of it as change, which is
        // not obvious from the form otherwise.
        const { baseTx, assetId, lookup, sent } = buildFixture([500, 300])
        const preview = previewFromTx(baseTx as any, lookup, { [assetId]: sent })
        expect(preview.change[assetId].toString()).toBe('100')
    })

    it('omits change entirely when the inputs are consumed exactly', () => {
        const { baseTx, assetId, lookup } = buildFixture([500, 300])
        const preview = previewFromTx(baseTx as any, lookup, { [assetId]: new BN(800) })
        expect(preview.change[assetId]).toBeUndefined()
    })

    it('resolves owners and threshold from the source UTXO', () => {
        const { baseTx, lookup } = buildFixture([500], 2)
        const preview = previewFromTx(baseTx as any, lookup)
        expect(preview.rows[0].threshold).toBe(2)
        expect(preview.rows[0].owners).toHaveLength(3)
    })

    it('degrades to no owner information when the UTXO cannot be resolved', () => {
        // Owners live on the source output, not on the input — losing the
        // lookup costs the owner column and nothing else, so amounts and
        // totals must still be right.
        const { baseTx, assetId } = buildFixture([500, 300])
        const preview = previewFromTx(baseTx as any, () => undefined)

        expect(preview.rows).toHaveLength(2)
        expect(preview.rows[0].owners).toEqual([])
        expect(preview.rows[0].threshold).toBe(1)
        expect(preview.totals[assetId].toString()).toBe('800')
    })
})

describe('isEmptyPreview', () => {
    it('treats null and a row-less preview alike', () => {
        expect(isEmptyPreview(null)).toBe(true)
        expect(isEmptyPreview({ rows: [], totals: {}, change: {} })).toBe(true)
    })

    it('is false once something is selected', () => {
        const { baseTx, lookup } = buildFixture([100])
        expect(isEmptyPreview(previewFromTx(baseTx as any, lookup))).toBe(false)
    })
})
