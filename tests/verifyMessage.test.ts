/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Message-signature verification: recovering the signer, and — the part that
 * actually proves who signed — matching it against the expected address.
 */
import { mount } from '@vue/test-utils'

import { KeyPair } from '@/avalanche/apis/avm'
import { Buffer } from '@/avalanche'
import { bintools } from '@/AVA'
import { digestMessage } from '@/helpers/helper'
import { getPreferredHRP } from '@/avalanche/utils'
import { recoverSigner, signerMatches } from '@/helpers/verify_message'
import VerifyMessage from '@/components/wallet/advanced/VerifyMessage.vue'

const NETWORK_ID = 1
const hrp = getPreferredHRP(NETWORK_ID)

function newSigner() {
    const pair = new KeyPair(hrp, 'X')
    pair.generateKey()
    const address = bintools.addressToString(hrp, 'X', pair.getAddress())
    /** Signs exactly as SingletonWallet.signMessage does. */
    const sign = (msg: string) => {
        const digest = digestMessage(msg)
        return bintools.cb58Encode(pair.sign(Buffer.from(digest.toString('hex'), 'hex')))
    }
    return { address, sign }
}

describe('recoverSigner / signerMatches', () => {
    const alice = newSigner()
    const bob = newSigner()
    const message = 'I own this address. 2026-09-30'

    it('recovers the address that signed, on both X and P', () => {
        const signer = recoverSigner(message, alice.sign(message), NETWORK_ID)
        expect(signer.addressX).toBe(alice.address)
        expect(signer.addressP).toBe('P-' + alice.address.slice(2))
    })

    it('matches the expected signer in X-, P- or bare form, any case', () => {
        const signer = recoverSigner(message, alice.sign(message), NETWORK_ID)
        const bare = alice.address.slice(2)
        for (const expected of [alice.address, 'P-' + bare, bare, ` ${alice.address.toUpperCase()} `]) {
            expect(signerMatches(expected, signer)).toBe(true)
        }
    })

    it('does not match when the message was altered or someone else signed', () => {
        // Any well-formed signature recovers SOME address — just not the right one.
        const tampered = recoverSigner(message + '!', alice.sign(message), NETWORK_ID)
        expect(signerMatches(alice.address, tampered)).toBe(false)

        const byBob = recoverSigner(message, bob.sign(message), NETWORK_ID)
        expect(signerMatches(alice.address, byBob)).toBe(false)
        expect(signerMatches('', byBob)).toBe(false)
    })

    it('throws on a signature that cannot be decoded', () => {
        expect(() => recoverSigner(message, 'not-a-signature', NETWORK_ID)).toThrow()
    })
})

jest.mock('@/AVA', () => ({ ...jest.requireActual('@/AVA'), ava: { getNetworkID: () => 1 } }))

describe('the Verify Message panel', () => {
    const alice = newSigner()
    const bob = newSigner()
    const message = 'hello avalanche'

    async function verify(fields: { message: string; signature: string; expected?: string }) {
        const w = mount(VerifyMessage, {
            global: {
                mocks: { $t: (k: string) => k },
                stubs: {
                    fa: { props: ['icon'], template: '<i class="fa_stub" :data-icon="icon"></i>' },
                    'v-btn': { emits: ['click'], template: '<button @click="$emit(\'click\')"><slot /></button>' },
                },
            },
        })
        const [msgArea, sigArea] = w.findAll('textarea')
        await msgArea.setValue(fields.message)
        await sigArea.setValue(fields.signature)
        if (fields.expected) await w.find('input').setValue(fields.expected)
        await w.find('button').trigger('click')
        return w
    }

    it('shows a big green check when the expected signer signed', async () => {
        const w = await verify({ message, signature: alice.sign(message), expected: alice.address })
        expect(w.find('.result').classes()).toContain('match')
        expect(w.find('.verdict_icon .fa_stub').attributes('data-icon')).toBe('circle-check')
        expect(w.text()).toContain('Valid signature from the expected signer')
        expect(w.text()).toContain(alice.address)
    })

    it('shows a big red X when someone else signed', async () => {
        const w = await verify({ message, signature: bob.sign(message), expected: alice.address })
        expect(w.find('.result').classes()).toContain('mismatch')
        expect(w.find('.verdict_icon .fa_stub').attributes('data-icon')).toBe('circle-xmark')
        expect(w.text()).toContain('Not signed by the expected signer')
        expect(w.text()).toContain(bob.address) // who actually signed
    })

    it('shows a big red X for a signature that cannot be decoded', async () => {
        const w = await verify({ message, signature: 'garbage' })
        expect(w.find('.result').classes()).toContain('invalid')
        expect(w.find('.verdict_icon .fa_stub').attributes('data-icon')).toBe('circle-xmark')
        expect(w.text()).toContain('Invalid signature')
    })

    it('shows a green check for a valid signature, prompting for the expected signer', async () => {
        const w = await verify({ message, signature: alice.sign(message) })
        expect(w.find('.result').classes()).toContain('valid')
        expect(w.find('.verdict_icon .fa_stub').attributes('data-icon')).toBe('circle-check')
        expect(w.text()).toContain('Enter the address you expect')
    })
})
