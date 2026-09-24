/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Navbar menu items navigate from anywhere on the row, not just the words.
 *
 * The bug: each item was a full-width, hover-highlighted `v-list-item` with a
 * `<router-link>` (or `<a>`) wrapping only its text. A click on the rest of
 * the row — most of it — closed the menu and went nowhere, so the item
 * "did nothing the first time" and worked when the next click happened to
 * land on the text. Real Vuetify and a real router here, because the bug
 * lives exactly in how the two meet.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defineComponent, h } from 'vue'

import NavbarMenu from '@/components/NavbarMenu.vue'

// jsdom lacks what Vuetify's overlays measure with.
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
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:any(.*)*', component: Page }],
    })
    await router.push('/wallet')
    const vuetify = createVuetify({ components, directives })

    const host = document.createElement('div')
    document.body.appendChild(host)
    const wrapper = mount(
        defineComponent({
            components: { NavbarMenu, VApp: components.VApp },
            template: '<v-app><NavbarMenu /></v-app>',
        }),
        {
            attachTo: host,
            global: {
                plugins: [pinia, router, vuetify],
                stubs: {
                    fa: true,
                    SaveAccountModal: true,
                    ConfirmLogout: true,
                    AboutModal: true,
                    AvxtoMenu: true,
                    'network-menu': true,
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

/** Opens a top-level menu by its button label; its items render in <body>. */
async function openMenu(wrapper: any, label: string) {
    const btn = wrapper.findAll('button').find((b: any) => b.text() === label)
    expect(btn).toBeTruthy()
    await btn.trigger('click')
    await flushPromises()
}

/** The menu row whose text is `label`, as rendered in the overlay. */
function row(label: string): HTMLElement {
    const items = Array.from(document.body.querySelectorAll<HTMLElement>('.v-list-item'))
    const found = items.find((el) => el.textContent?.trim() === label)
    if (!found) throw new Error(`No menu row "${label}"`)
    return found
}

/**
 * Waits for the router to settle. Its navigation crosses a macrotask, so
 * flushing microtasks alone reads the route before it has moved.
 */
async function settled(router: any, path: string) {
    for (let i = 0; i < 40 && router.currentRoute.value.path !== path; i++) {
        await new Promise((r) => setTimeout(r, 5))
    }
    return router.currentRoute.value.path
}

afterEach(() => {
    document.body.innerHTML = ''
})

it('navigates when the row is clicked outside its text', async () => {
    const { wrapper, router } = await mountMenu()
    await openMenu(wrapper, 'File')

    // Click the row element itself — its padding, not the words.
    row('Settings').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(await settled(router, '/wallet/config')).toBe('/wallet/config')
    wrapper.unmount()
})

it('opens external items from anywhere on the row, in a new tab', async () => {
    const { wrapper } = await mountMenu()
    await openMenu(wrapper, 'Help')

    const telegram = row('AVXTO Telegram Group')
    // The row IS the link, so a click anywhere on it follows it.
    expect(telegram.tagName).toBe('A')
    expect(telegram.getAttribute('href')).toBe('https://avax.to/telegram')
    expect(telegram.getAttribute('target')).toBe('_blank')
    expect(telegram.getAttribute('rel')).toContain('noopener')
    wrapper.unmount()
})

describe('the AVXTO menu', () => {
    it('navigates from anywhere on the row when logged in', async () => {
        const { useActivePlatformStore } = await import('@/platforms/store')
        const { registerPlatform } = await import('@/platforms/registry')
        const pinia = createPinia()
        setActivePinia(pinia)
        // Logged in: a platform with a wallet is the active one.
        const id = 'test-logged-in' as any
        registerPlatform({
            descriptor: { id, name: id, symbol: 'T', status: 'available' },
            capabilities: {} as any,
            accessMethods: [{ id: 'x', label: 'x', kind: 'route', route: '/access' }],
            chains: [],
            networks: [],
            supportsConcurrentSession: true,
            getActiveWallet: () => ({ getPrimaryAddress: () => '0xabc' }) as any,
            logout: async () => {},
        } as any)
        const platformStore = useActivePlatformStore()
        platformStore.activePlatformId = id
        platformStore.notifyWalletChanged()

        const router = createRouter({
            history: createMemoryHistory(),
            routes: [{ path: '/:any(.*)*', component: Page }],
        })
        await router.push('/wallet')
        const AvxtoMenu = (await import('@/components/AvxtoMenu.vue')).default
        const wrapper = mount(
            defineComponent({
                components: { AvxtoMenu, VApp: components.VApp },
                template: '<v-app><AvxtoMenu /></v-app>',
            }),
            {
                attachTo: document.body.appendChild(document.createElement('div')),
                global: {
                    plugins: [pinia, router, createVuetify({ components, directives })],
                    stubs: { fa: true, Modal: true },
                },
            }
        )
        await openMenu(wrapper, 'AVXTO')

        row('Burn AVXTO (Moats)').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

        expect(await settled(router, '/wallet/moats/burn')).toBe('/wallet/moats/burn')
        wrapper.unmount()
    })
})
