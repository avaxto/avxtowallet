/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The extension name behind the wallet-type badge, asked of the extension
 * through EIP-6963, with provider identity flags as the fallback.
 */
import { computed } from 'vue'

import { discoverInjectedWallets, injectedWalletName } from '@/js/wallets/injectedWalletName'

/** Makes `provider` answer discovery requests the way an extension does. */
function installAnnouncer(provider: object, name: string) {
    const announce = () =>
        window.dispatchEvent(
            new CustomEvent('eip6963:announceProvider', {
                detail: { info: { uuid: name, name, icon: '', rdns: `io.${name}` }, provider },
            })
        )
    window.addEventListener('eip6963:requestProvider', announce)
    return () => window.removeEventListener('eip6963:requestProvider', announce)
}

it('takes the name the extension announces for exactly this provider', () => {
    const core = { request: jest.fn() }
    const metamask = { request: jest.fn() }
    const offCore = installAnnouncer(core, 'Core')
    const offMm = installAnnouncer(metamask, 'MetaMask')

    discoverInjectedWallets()

    // Two extensions installed; each provider gets its own name, not the other's.
    expect(injectedWalletName(core)).toBe('Core')
    expect(injectedWalletName(metamask)).toBe('MetaMask')
    offCore()
    offMm()
})

it('falls back to the identity flags, checking Core before MetaMask', () => {
    // Core sets isMetaMask too, for compatibility.
    expect(injectedWalletName({ isAvalanche: true, isMetaMask: true })).toBe('Core')
    expect(injectedWalletName({ isMetaMask: true })).toBe('MetaMask')
    expect(injectedWalletName({ isRabby: true, isMetaMask: true })).toBe('Rabby')
    expect(injectedWalletName({})).toBeNull()
    expect(injectedWalletName(null)).toBeNull()
})

it('updates a name read before the extension announced itself', () => {
    const late = { isMetaMask: true }
    const name = computed(() => injectedWalletName(late))
    expect(name.value).toBe('MetaMask') // flags only, so far

    window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
            detail: { info: { name: 'Core' }, provider: late },
        })
    )
    expect(name.value).toBe('Core')
})

it('keeps an announced name to something that fits a badge', () => {
    const p = {}
    window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
            detail: { info: { name: '  A  Very   Long Wallet Name That Goes On  ' }, provider: p },
        })
    )
    expect(injectedWalletName(p)).toBe('A Very Long Wallet Name ')
})

it("names the Avalanche InjectedWallet by the provider it was connected through", async () => {
    const { InjectedWallet } = await import('@/js/wallets/InjectedWallet')
    const provider = { isAvalanche: true, request: jest.fn() }
    // Skips the constructor, which builds a viem client this does not need.
    const wallet = Object.create(InjectedWallet.prototype)
    wallet.provider = provider
    expect(wallet.walletName).toBe('Core')

    window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
            detail: { info: { name: 'Core Wallet' }, provider },
        })
    )
    expect(wallet.walletName).toBe('Core Wallet')
})

describe('the account name inside the extension', () => {
    const { injectedAccountName } = jest.requireActual('@/js/wallets/injectedWalletName')

    const ME = '0x' + 'ab'.repeat(20)
    const OTHER = '0x' + 'cd'.repeat(20)

    /** A Core-shaped provider: `avalanche_getAccounts` as Core answers it. */
    function coreProvider(accounts: any[]) {
        return {
            isAvalanche: true,
            request: jest.fn(async ({ method }: { method: string }) => {
                if (method === 'avalanche_getAccounts') return accounts
                throw new Error('unexpected ' + method)
            }),
        }
    }

    const flush = () => new Promise((r) => setTimeout(r, 0))

    it('reads the connected account\'s own name, matched by address', async () => {
        const provider = coreProvider([
            // The ACTIVE account in Core is another one: it must not be shown.
            { name: 'Account 1', walletName: 'Seed Phrase 1', addressC: OTHER, active: true },
            { name: 'Trading', walletName: 'Seed Phrase 2', addressC: ME.toUpperCase().replace('0X', '0x'), active: false },
        ])
        const name = computed(() => injectedAccountName(provider, ME))

        expect(name.value).toBeNull() // asked, not answered yet
        await flush()
        expect(name.value).toEqual({ name: 'Trading', walletName: 'Seed Phrase 2' })

        // Asked once, not on every read.
        name.value
        expect(provider.request).toHaveBeenCalledTimes(1)
    })

    it('accepts the address without its 0x, as the Avalanche wallet stores it', async () => {
        const provider = coreProvider([{ name: 'Account 3', addressC: ME }])
        injectedAccountName(provider, ME.slice(2))
        await flush()
        expect(injectedAccountName(provider, ME.slice(2))?.name).toBe('Account 3')
    })

    it('has no name when the address is not among the extension\'s accounts', async () => {
        const provider = coreProvider([{ name: 'Account 1', addressC: OTHER }])
        injectedAccountName(provider, ME)
        await flush()
        expect(injectedAccountName(provider, ME)).toBeNull()
    })

    it('never asks an extension that is not Core', () => {
        const metamask = { isMetaMask: true, request: jest.fn() }
        expect(injectedAccountName(metamask, ME)).toBeNull()
        expect(metamask.request).not.toHaveBeenCalled()
    })

    it('falls back quietly when Core refuses', async () => {
        const provider = { isAvalanche: true, request: jest.fn().mockRejectedValue(new Error('no')) }
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        injectedAccountName(provider, ME)
        await flush()
        warn.mockRestore()
        expect(injectedAccountName(provider, ME)).toBeNull()
    })
})
