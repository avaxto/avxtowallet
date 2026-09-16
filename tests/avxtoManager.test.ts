/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The AVXTO Manager JSON-RPC protocol: building the read request, and every
 * way a response can legitimately or illegitimately fail to hand back a
 * usable mnemonic. See views/access/Mnemonic.vue for the form that uses this.
 */
import * as bip39 from 'bip39'
import { buildReadRequest, extractMnemonic } from '@/utils/avxtoManager'

// A real, valid 24-word mnemonic — generated fresh, not a well-known test
// vector, so this file cannot be mistaken for holding a funded phrase.
const VALID_MNEMONIC = bip39.generateMnemonic(256)

describe('buildReadRequest', () => {
    it('shapes the request exactly per the AVXTO Manager protocol', () => {
        expect(buildReadRequest('hunter2')).toEqual({
            jsonrpc: '2.0',
            id: 1,
            method: 'read',
            params: { password: 'hunter2' },
        })
    })
})

describe('extractMnemonic', () => {
    it('reads the mnemonic from the standard JSON-RPC 2.0 envelope', () => {
        const body = { jsonrpc: '2.0', id: 1, result: { mnemonic: VALID_MNEMONIC } }
        expect(extractMnemonic(body)).toBe(VALID_MNEMONIC)
    })

    it('also accepts a bare top-level mnemonic field', () => {
        const body = { mnemonic: VALID_MNEMONIC }
        expect(extractMnemonic(body)).toBe(VALID_MNEMONIC)
    })

    it('trims surrounding whitespace', () => {
        const body = { result: { mnemonic: `  ${VALID_MNEMONIC}  ` } }
        expect(extractMnemonic(body)).toBe(VALID_MNEMONIC)
    })

    it('prefers the enveloped result over a coincidental top-level field', () => {
        const other = bip39.generateMnemonic(256)
        const body = { result: { mnemonic: VALID_MNEMONIC }, mnemonic: other }
        expect(extractMnemonic(body)).toBe(VALID_MNEMONIC)
    })

    it('surfaces a JSON-RPC error message rather than a generic one', () => {
        const body = { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'wrong password' } }
        expect(() => extractMnemonic(body)).toThrow('wrong password')
    })

    it('falls back to a generic message when the error object has none', () => {
        const body = { error: {} }
        expect(() => extractMnemonic(body)).toThrow(/rejected the request/i)
    })

    it('rejects a response with no mnemonic at all', () => {
        expect(() => extractMnemonic({ result: {} })).toThrow(/did not include a mnemonic/i)
        expect(() => extractMnemonic({})).toThrow(/did not include a mnemonic/i)
        expect(() => extractMnemonic(null)).toThrow(/did not include a mnemonic/i)
    })

    it('rejects a phrase that is not 24 words', () => {
        const short = bip39.generateMnemonic(128) // 12 words
        expect(() => extractMnemonic({ mnemonic: short })).toThrow(/24-word mnemonic/)
    })

    it('rejects a 24-word phrase that fails the checksum', () => {
        // Same word count as a real phrase, but not a valid BIP-39 sentence.
        const words = VALID_MNEMONIC.split(' ')
        words[0] = words[0] === 'abandon' ? 'zebra' : 'abandon'
        const bogus = words.join(' ')
        expect(bip39.validateMnemonic(bogus)).toBe(false)
        expect(() => extractMnemonic({ mnemonic: bogus })).toThrow(/not a valid mnemonic/)
    })

    it('is not fooled by uppercase into accepting an otherwise-invalid phrase', () => {
        const uppercased = VALID_MNEMONIC.toUpperCase()
        expect(() => extractMnemonic({ mnemonic: uppercased })).toThrow(/all lowercase/)
    })
})
