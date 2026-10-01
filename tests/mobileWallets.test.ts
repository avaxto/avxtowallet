/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wallet apps on phones (reported: Pixel Pro, Chrome, with MetaMask, Rabby and
 * Phantom installed, told "no extension found"). Phone browsers run no wallet
 * extensions — the apps only inject into their own in-app browsers — so the
 * wallet must recognise that case and offer to reopen the page in the app.
 */
import { mount } from '@vue/test-utils'

import { hasInjectedWallet, isMobileBrowser, walletAppLinks } from '@/helpers/mobileWallets'

const PIXEL_CHROME =
    'Mozilla/5.0 (Linux; Android 16; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

describe('detection', () => {
    it('recognises phone browsers, and never a desktop one', () => {
        expect(isMobileBrowser(PIXEL_CHROME)).toBe(true)
        expect(isMobileBrowser(IPHONE_SAFARI)).toBe(true)
        expect(isMobileBrowser(MAC_CHROME)).toBe(false)
    })

    it('sees a wallet injected by any supported app', () => {
        expect(hasInjectedWallet({})).toBe(false)
        expect(hasInjectedWallet({ ethereum: {} })).toBe(true) // MetaMask, Rabby, …
        expect(hasInjectedWallet({ avalanche: {} })).toBe(true) // Core
        expect(hasInjectedWallet({ phantom: { solana: {} } })).toBe(true)
    })
})

describe('walletAppLinks', () => {
    const page = 'https://wallet.avax.to/access?add=1'

    it("builds each app's documented open-in-app link for this page", () => {
        const links = Object.fromEntries(walletAppLinks(page).map((l) => [l.name, l.href]))
        expect(links['MetaMask']).toBe('https://metamask.app.link/dapp/wallet.avax.to/access?add=1')
        expect(links['Phantom']).toBe(
            'https://phantom.app/ul/browse/' +
                encodeURIComponent(page) +
                '?ref=' +
                encodeURIComponent('https://wallet.avax.to')
        )
        expect(links['Coinbase Wallet']).toBe('https://go.cb-w.com/dapp?cb_url=' + encodeURIComponent(page))
        expect(links['Trust Wallet']).toBe(
            'https://link.trustwallet.com/open_url?coin_id=60&url=' + encodeURIComponent(page)
        )
    })
})

import MobileWalletHelp from '@/components/Access/MobileWalletHelp.vue'

describe('the help panel', () => {
    it('links into the wallet apps and gives the address to paste elsewhere', () => {
        const w = mount(MobileWalletHelp, {
            global: { stubs: { fa: true, CopyText: { props: ['value'], template: '<span class="copy">{{ value }}</span>' } } },
        })
        const names = w.findAll('a.app_link').map((a) => a.text())
        expect(names).toEqual(['Open in MetaMask', 'Open in Phantom', 'Open in Coinbase Wallet', 'Open in Trust Wallet'])
        expect(w.text()).toContain('Rabby, Core or another wallet')
        expect(w.find('.copy').text()).toBe(window.location.href)
        w.unmount()
    })
})

// ─── Navbar "Connect Wallet" ───────────────────────────────────────────────

const push = jest.fn()
jest.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
const notify = jest.fn()
jest.mock('@/stores', () => ({ useNotificationsStore: () => ({ add: notify }) }))
const injectedRun = jest.fn()
jest.mock('@/platforms', () => ({
    useActivePlatformStore: () => ({
        activePlatform: { accessMethods: [{ id: 'injected', kind: 'action', run: injectedRun }] },
        injectedConnectablePlatforms: () => [],
    }),
}))

import { useInjectedConnect } from '@/composables/useInjectedConnect'

describe('Connect Wallet on a phone without a wallet injected', () => {
    const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })

    beforeEach(() => {
        push.mockReset()
        notify.mockReset()
        injectedRun.mockReset()
        delete (window as any).ethereum
    })

    it('goes to the access screen, which explains and links into the apps — no error toast', async () => {
        setUA(PIXEL_CHROME)
        await useInjectedConnect().connectInjected('/wallet/swap')
        expect(push).toHaveBeenCalledWith('/access')
        expect(injectedRun).not.toHaveBeenCalled()
        expect(notify).not.toHaveBeenCalled()
    })

    it("connects as usual inside a wallet app's browser", async () => {
        setUA(PIXEL_CHROME)
        ;(window as any).ethereum = {}
        await useInjectedConnect().connectInjected()
        expect(injectedRun).toHaveBeenCalled()
        delete (window as any).ethereum
    })

    it('is unchanged on desktop', async () => {
        setUA(MAC_CHROME)
        await useInjectedConnect().connectInjected()
        expect(injectedRun).toHaveBeenCalled()
    })
})
