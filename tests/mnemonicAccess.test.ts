/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * /access/mnemonic accepts every BIP-39 phrase length — 12 words as well as
 * 24 — tolerates the extra spaces and line breaks a pasted phrase carries,
 * and still refuses anything that is not a valid phrase.
 */
import { flushPromises, mount } from '@vue/test-utils'
import * as bip39 from 'bip39'

const accessWallet = jest.fn(async () => {})
jest.mock('@/stores', () => ({ useMainStore: () => ({ accessWallet }) }))
jest.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))

import Mnemonic from '@/views/access/Mnemonic.vue'

const stubs = { fa: true, 'router-link': { template: '<a><slot /></a>' }, MnemonicPasswordInput: true }

async function submit(phrase: string) {
    const w = mount(Mnemonic, { global: { stubs, mocks: { $t: (k: string) => k } } })
    const [mnemonicIn, pw, confirm] = w.findAll('input[type="password"]')
    ;(mnemonicIn.element as HTMLInputElement).value = phrase
    await pw.setValue('pw')
    await confirm.setValue('pw')
    await w.find('button.access').trigger('click')
    await flushPromises()
    return w
}

beforeEach(() => accessWallet.mockClear())

describe('/access/mnemonic', () => {
    it('says 12 or 24 words', () => {
        const w = mount(Mnemonic, { global: { stubs, mocks: { $t: (k: string) => k } } })
        expect(w.text()).toContain('12 or 24 words')
        w.unmount()
    })

    it('opens a 12-word phrase', async () => {
        const phrase = bip39.generateMnemonic(128)
        const w = await submit(phrase)
        expect(accessWallet).toHaveBeenCalledWith(phrase, 'pw')
        expect(w.find('.err').exists()).toBe(false)
        w.unmount()
    })

    it('still opens a 24-word phrase, and the other BIP-39 lengths', async () => {
        for (const bits of [256, 160, 192, 224]) {
            const phrase = bip39.generateMnemonic(bits)
            const w = await submit(phrase)
            expect(accessWallet).toHaveBeenLastCalledWith(phrase, 'pw')
            w.unmount()
        }
    })

    it('tolerates extra spaces and line breaks in a pasted phrase', async () => {
        const phrase = bip39.generateMnemonic(128)
        const w = await submit(`  ${phrase.split(' ').join('   \n')}  `)
        expect(accessWallet).toHaveBeenCalledWith(phrase, 'pw')
        w.unmount()
    })

    it('refuses other lengths and invalid phrases', async () => {
        const words = bip39.generateMnemonic(128).split(' ')
        let w = await submit(words.slice(0, 11).join(' '))
        expect(w.find('.err').text()).toBe('access.mnemonic.error')
        w.unmount()

        const bad = words.slice()
        bad[0] = bad[0] === 'abandon' ? 'zebra' : 'abandon'
        w = await submit(bad.join(' '))
        expect(w.find('.err').text()).toMatch(/Invalid mnemonic phrase/)
        w.unmount()
        expect(accessWallet).not.toHaveBeenCalled()
    })
})
