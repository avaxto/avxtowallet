import { isSameInjectedAccount } from '@/helpers/injected_account'

describe('isSameInjectedAccount', () => {
    const stored = '5da60a5391bf349e64d4d2ae41c5e28896396fd9' // InjectedWallet.ethAddress form

    it('treats a re-announcement of the current account as the same account', () => {
        expect(isSameInjectedAccount(stored, '0x5DA60a5391bF349e64D4d2Ae41C5e28896396Fd9')).toBe(true)
        expect(isSameInjectedAccount('0x' + stored, stored)).toBe(true)
    })

    it('treats a different account as a switch', () => {
        expect(isSameInjectedAccount(stored, '0x1111111111111111111111111111111111111111')).toBe(false)
    })

    it('treats no current wallet as a switch', () => {
        expect(isSameInjectedAccount(null, '0x' + stored)).toBe(false)
        expect(isSameInjectedAccount(undefined, '0x' + stored)).toBe(false)
    })
})
