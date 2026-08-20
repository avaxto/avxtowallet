/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Memo encoding for a native EVM send's `data` field.
 *
 * The two things worth pinning: the double encoding (UTF-8 -> base64 -> hex,
 * not straight UTF-8 -> hex) actually happens rather than silently collapsing
 * to one step, and the intrinsic-gas count matches what the encoder actually
 * produces — a mismatch there is exactly what would make FormC.vue compute a
 * gas limit too low for the memo it is about to send.
 */
import { encodeMemoToTxData, intrinsicGasForData } from '@/evm/memo'

describe('encodeMemoToTxData', () => {
    it('produces base64-then-hex, not plain UTF-8-then-hex', () => {
        // "hi" in base64 is "aGk=" — its ASCII bytes hex-encoded is what
        // should land in the tx data field.
        const data = encodeMemoToTxData('hi')
        expect(data).toBe('0x' + Buffer.from('aGk=', 'utf8').toString('hex'))
        // Distinct from the naive one-step encoding this is NOT supposed to be.
        expect(data).not.toBe('0x' + Buffer.from('hi', 'utf8').toString('hex'))
    })

    it('round-trips back to the original text through both decode steps', () => {
        const memo = 'Rent for March'
        const data = encodeMemoToTxData(memo)
        const hex = data.slice(2)
        const base64 = Buffer.from(hex, 'hex').toString('utf8')
        expect(Buffer.from(base64, 'base64').toString('utf8')).toBe(memo)
    })

    it('round-trips multi-byte UTF-8 (emoji, non-Latin text)', () => {
        const memo = '🎉 支払い完了'
        const data = encodeMemoToTxData(memo)
        const hex = data.slice(2)
        const base64 = Buffer.from(hex, 'hex').toString('utf8')
        expect(Buffer.from(base64, 'base64').toString('utf8')).toBe(memo)
    })

    it('always returns even-length hex with the 0x prefix', () => {
        for (const memo of ['a', 'ab', 'abc', '', '💰']) {
            const data = encodeMemoToTxData(memo)
            expect(data.startsWith('0x')).toBe(true)
            expect((data.length - 2) % 2).toBe(0)
        }
    })
})

describe('intrinsicGasForData', () => {
    it('charges 16 gas per non-zero byte', () => {
        // base64's alphabet never produces a 0x00 byte, so every real memo
        // this module encodes hits the full rate.
        expect(intrinsicGasForData('0x' + Buffer.from('aGk=', 'utf8').toString('hex'))).toBe(4 * 16)
    })

    it('charges 4 gas per zero byte', () => {
        expect(intrinsicGasForData('0x0000')).toBe(4 + 4)
    })

    it('handles a mix of zero and non-zero bytes', () => {
        // 0x00 (zero) + 0xff (non-zero) + 0x00 (zero)
        expect(intrinsicGasForData('0x00ff00')).toBe(4 + 16 + 4)
    })

    it('is zero for empty data', () => {
        expect(intrinsicGasForData('0x')).toBe(0)
    })

    it('matches what a real memo actually costs', () => {
        // Guards the exact number FormC.vue adds to the 21000 base — a drift
        // here would mean the confirm screen under- or over-states the fee,
        // and on the Avalanche-platform path (which passes this exact number
        // as the transaction's gasLimit) an undercount would produce a
        // transaction the network rejects as under-priced for its own data.
        const data = encodeMemoToTxData('Invoice #4471')
        const byteLength = (data.length - 2) / 2
        expect(intrinsicGasForData(data)).toBe(byteLength * 16)
    })
})
