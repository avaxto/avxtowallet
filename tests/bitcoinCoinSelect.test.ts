/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Coin selection and fee arithmetic.
 *
 * This is the part of the Bitcoin implementation where a wrong number costs
 * real, unrecoverable money, so the invariants are pinned explicitly rather
 * than assumed: the fee must match the transaction's own size, change must
 * never be created below the dust limit, and inputs + outputs + fee must
 * balance exactly.
 */
import {
    DUST_THRESHOLD_SATS,
    INPUT_VBYTES,
    OUTPUT_VBYTES,
    TX_OVERHEAD_VBYTES,
    estimateVbytes,
    selectCoins,
    type SelectableUtxo,
} from '@/bitcoin/coinSelect'

const utxo = (value: number, confirmed = true, i = 0): SelectableUtxo => ({
    txid: 'aa'.repeat(32),
    vout: i,
    value,
    address: 'bc1qtest',
    addressType: 'p2wpkh',
    path: `m/84'/0'/0'/0/${i}`,
    confirmed,
})

describe('estimateVbytes', () => {
    it('matches the sizes bitcoinjs actually produces for 1-in/1-out', () => {
        // Cross-checked against real signed transactions: p2wpkh→p2wpkh came
        // out at exactly 110 vB, p2sh-p2wpkh→p2sh at 134. The legacy and
        // taproot estimates land 1 vB high, which is the safe direction — a
        // slight overestimate pays marginally more, an underestimate produces
        // a transaction that will not confirm.
        expect(estimateVbytes([{ addressType: 'p2wpkh' }], ['p2wpkh'])).toBe(110)
        expect(estimateVbytes([{ addressType: 'p2sh-p2wpkh' }], ['p2sh-p2wpkh'])).toBe(134)
        expect(estimateVbytes([{ addressType: 'p2pkh' }], ['p2pkh'])).toBe(193) // real: 192
        expect(estimateVbytes([{ addressType: 'p2tr' }], ['p2tr'])).toBe(112) // real: 111
    })

    it('is the sum of overhead, inputs and outputs', () => {
        const vb = estimateVbytes(
            [{ addressType: 'p2wpkh' }, { addressType: 'p2pkh' }],
            ['p2wpkh', 'p2tr']
        )
        expect(vb).toBe(
            TX_OVERHEAD_VBYTES +
                INPUT_VBYTES['p2wpkh'] +
                INPUT_VBYTES['p2pkh'] +
                OUTPUT_VBYTES['p2wpkh'] +
                OUTPUT_VBYTES['p2tr']
        )
    })
})

describe('selectCoins', () => {
    const base = {
        feeRate: 10,
        recipientType: 'p2wpkh' as const,
        changeType: 'p2wpkh' as const,
    }

    it('balances inputs against outputs plus fee, exactly', () => {
        const r = selectCoins({ ...base, utxos: [utxo(1_000_000)], targetSats: 100_000 })
        const inputTotal = r.inputs.reduce((s, u) => s + u.value, 0)
        expect(inputTotal).toBe(r.outputSats + r.changeSats + r.feeSats)
    })

    it('charges the fee its own transaction size implies', () => {
        const r = selectCoins({ ...base, utxos: [utxo(1_000_000)], targetSats: 100_000 })
        expect(r.feeSats).toBe(Math.ceil(r.vbytes * base.feeRate))
        expect(r.vbytes).toBe(estimateVbytes(r.inputs, ['p2wpkh', 'p2wpkh']))
    })

    it('prefers confirmed UTXOs over unconfirmed ones', () => {
        // Spending an unconfirmed output chains transactions; if the parent is
        // evicted the child dies with it.
        const r = selectCoins({
            ...base,
            utxos: [utxo(500_000, false, 0), utxo(400_000, true, 1)],
            targetSats: 100_000,
        })
        expect(r.inputs).toHaveLength(1)
        expect(r.inputs[0].confirmed).toBe(true)
    })

    it('takes the largest UTXOs first, minimising input count', () => {
        const r = selectCoins({
            ...base,
            utxos: [utxo(50_000, true, 0), utxo(900_000, true, 1), utxo(60_000, true, 2)],
            targetSats: 500_000,
        })
        expect(r.inputs).toHaveLength(1)
        expect(r.inputs[0].value).toBe(900_000)
    })

    it('adds more inputs when one is not enough', () => {
        const r = selectCoins({
            ...base,
            utxos: [utxo(100_000, true, 0), utxo(100_000, true, 1), utxo(100_000, true, 2)],
            targetSats: 250_000,
        })
        expect(r.inputs.length).toBeGreaterThanOrEqual(3)
    })

    it('never creates change below the dust limit', () => {
        // Tuned so the natural change would be a few hundred sats — below dust.
        const vb = estimateVbytes([{ addressType: 'p2wpkh' }], ['p2wpkh'])
        const fee = vb * base.feeRate
        const value = 100_000 + fee + 200 // 200 sats of would-be change
        const r = selectCoins({ ...base, utxos: [utxo(value)], targetSats: 100_000 })

        expect(r.changeSats).toBe(0)
        // The would-be dust goes to the miner rather than becoming an
        // unspendable output — inputs must still balance.
        expect(r.inputs.reduce((s, u) => s + u.value, 0)).toBe(r.outputSats + r.feeSats)
    })

    it('either creates no change or change at least the dust limit', () => {
        // Property check across a range of amounts: there is no case where a
        // sub-dust change output is produced.
        for (let extra = 0; extra < 3000; extra += 137) {
            const vb = estimateVbytes([{ addressType: 'p2wpkh' }], ['p2wpkh', 'p2wpkh'])
            const value = 100_000 + vb * base.feeRate + extra
            const r = selectCoins({ ...base, utxos: [utxo(value)], targetSats: 100_000 })
            expect(r.changeSats === 0 || r.changeSats >= DUST_THRESHOLD_SATS).toBe(true)
        }
    })

    it('rejects an amount below the dust limit', () => {
        expect(() =>
            selectCoins({ ...base, utxos: [utxo(1_000_000)], targetSats: 100 })
        ).toThrow(/dust/i)
    })

    it('reports a shortfall rather than building an unpayable transaction', () => {
        expect(() =>
            selectCoins({ ...base, utxos: [utxo(50_000)], targetSats: 100_000 })
        ).toThrow(/not enough/i)
    })

    it('rejects a zero or negative fee rate', () => {
        expect(() =>
            selectCoins({ ...base, feeRate: 0, utxos: [utxo(1_000_000)], targetSats: 1000 })
        ).toThrow(/fee rate/i)
    })

    it('throws when there is nothing to spend', () => {
        expect(() => selectCoins({ ...base, utxos: [], targetSats: 1000 })).toThrow(
            /no spendable/i
        )
    })

    describe('sendMax', () => {
        it('spends every UTXO and leaves no change', () => {
            const utxos = [utxo(100_000, true, 0), utxo(200_000, true, 1)]
            const r = selectCoins({ ...base, utxos, targetSats: 0, sendMax: true })

            expect(r.inputs).toHaveLength(2)
            expect(r.changeSats).toBe(0)
            expect(r.outputSats + r.feeSats).toBe(300_000)
        })

        it('deducts the fee from the amount sent, not from a change output', () => {
            const r = selectCoins({
                ...base,
                utxos: [utxo(100_000)],
                targetSats: 0,
                sendMax: true,
            })
            expect(r.outputSats).toBe(100_000 - r.feeSats)
        })

        it('refuses when the fee would leave dust', () => {
            expect(() =>
                selectCoins({ ...base, utxos: [utxo(1200)], targetSats: 0, sendMax: true })
            ).toThrow(/dust/i)
        })
    })
})
