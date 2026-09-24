/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The Arena menu's "ArenaTrade Token Sniper" is gated at the menu: clicking
 * it runs the Moats-burn check, and only an address that has burned enough
 * is taken to the page — anyone else gets the burn modal and stays put.
 * Real Vuetify menu and real router, as in navbarMenuClicks.test.ts.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defineComponent, h } from 'vue'

import { BN } from '@/avalanche'
import { useMainStore } from '@/stores/main'

let burnedOnChain = new BN(0)
let reads = 0
jest.mock('@/js/MoatsStats', () => ({
    readBurnedOnMoats: async () => {
        reads++
        return burnedOnChain
    },
}))

import NavbarMenu from '@/components/NavbarMenu.vue'
import { REQUIRED_BURN_WEI, forgetBurnReads, useBaseAssetGate } from '@/composables/useBaseAssetGate'

beforeAll(() => {
    ;(globalThis as any).ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    ;(window as any).matchMedia ??= () => ({
        matches: false,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
    })
    ;(window as any).visualViewport ??= { addEventListener() {}, removeEventListener() {} }
})

const Page = defineComponent({ render: () => h('div') })

async function mountMenu() {
    const pinia = createPinia()
    setActivePinia(pinia)
    useMainStore().activeWallet = { ethAddress: '11'.repeat(20) } as any
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:any(.*)*', component: Page }],
    })
    await router.push('/wallet')
    const wrapper = mount(
        defineComponent({
            components: { NavbarMenu, VApp: components.VApp },
            template: '<v-app><NavbarMenu /></v-app>',
        }),
        {
            attachTo: document.body.appendChild(document.createElement('div')),
            global: {
                plugins: [pinia, router, createVuetify({ components, directives })],
                stubs: {
                    fa: true,
                    SaveAccountModal: true,
                    ConfirmLogout: true,
                    AboutModal: true,
                    AvxtoMenu: true,
                    NetworkMenu: true,
                    EvmNetworkMenu: true,
                    SolanaNetworkMenu: true,
                    BitcoinNetworkMenu: true,
                },
            },
        }
    )
    return { wrapper, router }
}

async function clickSniper(wrapper: any) {
    const arena = wrapper.findAll('button').find((b: any) => b.text() === 'Arena')
    await arena.trigger('click')
    await flushPromises()
    const row = Array.from(document.body.querySelectorAll<HTMLElement>('.v-list-item')).find((el) =>
        el.textContent?.includes('ArenaTrade Token Sniper')
    )!
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5))
}

beforeEach(() => {
    burnedOnChain = new BN(0)
    reads = 0
    forgetBurnReads()
    useBaseAssetGate().closeModal()
})

afterEach(() => {
    document.body.innerHTML = ''
})

it('opens the burn modal instead of the page when the burn is short', async () => {
    burnedOnChain = new BN(3300).mul(new BN('1000000000000000000'))
    const { wrapper, router } = await mountMenu()
    await clickSniper(wrapper)

    expect(reads).toBe(1)
    expect(useBaseAssetGate().isModalOpen.value).toBe(true)
    expect(router.currentRoute.value.path).toBe('/wallet')
    wrapper.unmount()
})

it('goes to the sniper when the burn requirement is met', async () => {
    burnedOnChain = REQUIRED_BURN_WEI
    const { wrapper, router } = await mountMenu()
    await clickSniper(wrapper)

    expect(useBaseAssetGate().isModalOpen.value).toBe(false)
    expect(router.currentRoute.value.path).toBe('/wallet/arenatrade/sniper')
    wrapper.unmount()
})

it('stays clickable after a refusal, and re-checks on the next click', async () => {
    burnedOnChain = new BN(0)
    const { wrapper, router } = await mountMenu()
    await clickSniper(wrapper)
    useBaseAssetGate().closeModal('cancel')
    await flushPromises()

    // The user burns on moats.app and comes back to the menu.
    burnedOnChain = REQUIRED_BURN_WEI
    await clickSniper(wrapper)

    expect(reads).toBe(2)
    expect(router.currentRoute.value.path).toBe('/wallet/arenatrade/sniper')
    wrapper.unmount()
})
