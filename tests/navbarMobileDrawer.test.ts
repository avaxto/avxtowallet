/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The mobile hamburger drawer. On phones the navbar's Connect / Access / Create
 * buttons are hidden, so the drawer must carry them before login — it used to
 * list only logged-in pages, leaving it empty on the home page.
 */
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'

const activeWallet = ref<any>(null)
jest.mock('@/platforms', () => ({
    useActivePlatformStore: () => ({
        get activeWallet() {
            return activeWallet.value
        },
        activePlatform: { descriptor: { symbol: 'AVAX' } },
        activePlatformId: 'avalanche',
        isMultiChain: true,
        can: () => true,
        hasChainKind: () => true,
    }),
}))
jest.mock('@/stores', () => ({ useMainStore: () => ({ prices: { usd: 11.4 } }) }))
const connectInjected = jest.fn()
jest.mock('@/composables/useInjectedConnect', () => ({
    useInjectedConnect: () => ({ isConnecting: ref(false), connectInjected }),
}))

import Navbar from '@/components/Navbar.vue'

function mountNavbar() {
    return mount(Navbar, {
        global: {
            mocks: { $t: (k: string) => ({ 'access.but_connect_wallet': 'Connect Wallet', 'nav.access': 'Access Wallet', 'nav.create': 'Create Wallet' } as any)[k] ?? k },
            stubs: {
                fa: true,
                'v-spacer': true,
                'v-btn': { template: '<button><slot /></button>' },
                // Render the drawer's contents inline so they can be inspected.
                'v-navigation-drawer': { template: '<nav class="drawer_stub"><slot /></nav>' },
                'v-list': { template: '<div><slot /></div>' },
                'router-link': { props: ['to'], template: '<a :href="to" @click="$emit(\'click\')"><slot /></a>' },
                AccountMenu: true,
                NetworkMenu: true,
                EvmNetworkMenu: true,
                SolanaNetworkMenu: true,
                BitcoinNetworkMenu: true,
                LanguageSelect: true,
                PlatformLogo: true,
            },
        },
    })
}

beforeEach(() => {
    connectInjected.mockReset()
    activeWallet.value = null
})

it('offers Connect, Access and Create in the drawer before login', async () => {
    const w = mountNavbar()
    const drawer = w.find('.drawer_stub')
    const labels = drawer.findAll('a').map((a) => a.text())
    expect(labels).toEqual(['Connect Wallet', 'Access Wallet', 'Create Wallet'])
    expect(drawer.findAll('a').map((a) => a.attributes('href'))).toEqual(['/access', '/access', '/create'])

    await drawer.find('a.drawer_connect').trigger('click')
    await flushPromises()
    expect(connectInjected).toHaveBeenCalledWith('/wallet')
    w.unmount()
})

it('shows the wallet pages instead once logged in', () => {
    activeWallet.value = { getPrimaryAddress: () => '0x1' }
    const w = mountNavbar()
    const labels = w.find('.drawer_stub').findAll('a').map((a) => a.text())
    expect(labels).not.toContain('Connect Wallet')
    expect(labels).toContain('wallet.sidebar.portfolio')
    w.unmount()
})
