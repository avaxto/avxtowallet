/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * AVXTO Manager straight from /access: the top-level option on the access
 * menu, and the page it opens — fetch the phrase from the user's endpoint,
 * open the ticked platforms with it, and drop the password afterwards.
 */
import { flushPromises, mount } from '@vue/test-utils'
import * as bip39 from 'bip39'

const store = {
    activePlatform: { descriptor: { id: 'avalanche' }, accessMethods: [] },
    mnemonicUnlockablePlatforms: [
        { descriptor: { id: 'avalanche', name: 'Avalanche', symbol: 'AVAX' } },
        { descriptor: { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' } },
    ],
    isPlatformConnected: (id: string) => id === 'solana',
    unlockWithMnemonic: jest.fn(),
    injectedConnectablePlatforms: () => [],
    isConnecting: false,
    connectingPlatformId: null,
}
jest.mock('@/platforms', () => ({ useActivePlatformStore: () => store, getPlatform: () => undefined }))
const push = jest.fn()
const routeQuery: Record<string, string> = {}
jest.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ query: routeQuery }) }))
jest.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k: string) => k }) }))
jest.mock('@/components/Ledger/LedgerButton.vue', () => ({ template: '<i />' }))
jest.mock('@/components/Access/AccountsFound.vue', () => ({ template: '<i />' }))
jest.mock('@/components/Access/PlatformSelect.vue', () => ({ template: '<i />' }))
jest.mock('@/components/Access/MobileWalletHelp.vue', () => ({ template: '<i />' }))
jest.mock('@/helpers/mobileWallets', () => ({ hasInjectedWallet: () => false, isMobileBrowser: () => false }))

import ManagerAccess from '@/views/access/ManagerAccess.vue'
import { fetchMnemonicFromManager } from '@/utils/avxtoManager'

const PHRASE = bip39.generateMnemonic(128)
const stubs = {
    fa: true,
    'router-link': { props: ['to'], template: '<a :data-to="to"><slot /></a>' },
    'v-btn': { props: ['disabled', 'loading'], emits: ['click'], template: '<button class="v_btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>' },
}

function managerReplies(body: unknown, ok = true, status = 200) {
    global.fetch = jest.fn(async () => ({ ok, status, json: async () => body })) as any
}

beforeEach(() => {
    push.mockClear()
    store.unlockWithMnemonic.mockReset()
    delete routeQuery.add
})

describe('fetchMnemonicFromManager', () => {
    it('posts the read request and returns the validated phrase', async () => {
        managerReplies({ jsonrpc: '2.0', id: 1, result: { mnemonic: PHRASE } })
        expect(await fetchMnemonicFromManager(' https://m.example/rpc ', 'pw')).toBe(PHRASE)
        const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
        expect(url).toBe('https://m.example/rpc')
        expect(JSON.parse(init.body)).toEqual({ jsonrpc: '2.0', id: 1, method: 'read', params: { password: 'pw' } })
    })

    it('explains unreachable endpoints, HTTP errors and rejected passwords', async () => {
        global.fetch = jest.fn(async () => {
            throw new TypeError('Failed to fetch')
        }) as any
        await expect(fetchMnemonicFromManager('https://m.example', 'pw')).rejects.toThrow(/CORS/)
        managerReplies({}, false, 500)
        await expect(fetchMnemonicFromManager('https://m.example', 'pw')).rejects.toThrow('HTTP 500')
        managerReplies({ error: { message: 'wrong password' } })
        await expect(fetchMnemonicFromManager('https://m.example', 'pw')).rejects.toThrow('wrong password')
        await expect(fetchMnemonicFromManager('', 'pw')).rejects.toThrow(/Enter the AVXTO Manager/)
    })
})

describe('the /access/manager page', () => {
    const fill = async (w: any) => {
        await w.find('#manager-url').setValue('https://m.example/rpc')
        await w.find('#manager-pw').setValue('session-pw')
    }

    it('opens every ticked platform with the fetched phrase, then goes to the wallet', async () => {
        managerReplies({ result: { mnemonic: PHRASE } })
        store.unlockWithMnemonic.mockResolvedValue([
            { platformId: 'avalanche', status: 'connected' },
            { platformId: 'bitcoin', status: 'connected' },
        ])
        const w = mount(ManagerAccess, { global: { stubs } })
        expect(w.findAll('.platform_row input').map((i) => (i.element as HTMLInputElement).checked)).toEqual([true, true])
        await fill(w)
        await w.find('button.v_btn').trigger('click')
        await flushPromises()
        expect(store.unlockWithMnemonic).toHaveBeenCalledWith(PHRASE, 'session-pw', ['avalanche', 'bitcoin'])
        expect(push).toHaveBeenCalledWith('/wallet')
        expect((w.find('#manager-pw').element as HTMLInputElement).value).toBe('')
        w.unmount()
    })

    it('opens only the platforms left ticked, and reports a partial result', async () => {
        managerReplies({ result: { mnemonic: PHRASE } })
        store.unlockWithMnemonic.mockResolvedValue([{ platformId: 'avalanche', status: 'failed', error: 'boom' }])
        const w = mount(ManagerAccess, { global: { stubs } })
        await w.findAll('.platform_row input')[1].setValue(false)
        await fill(w)
        await w.find('button.v_btn').trigger('click')
        await flushPromises()
        expect(store.unlockWithMnemonic.mock.calls[0][2]).toEqual(['avalanche'])
        expect(w.text()).toContain('boom')
        expect(push).not.toHaveBeenCalled()
        w.unmount()
    })

    it('shows the endpoint’s error and opens nothing', async () => {
        managerReplies({ error: { message: 'wrong password' } })
        const w = mount(ManagerAccess, { global: { stubs } })
        await fill(w)
        await w.find('button.v_btn').trigger('click')
        await flushPromises()
        expect(w.find('.err').text()).toBe('wrong password')
        expect(store.unlockWithMnemonic).not.toHaveBeenCalled()
        expect((w.find('#manager-pw').element as HTMLInputElement).value).toBe('')
        w.unmount()
    })
})

describe('the /access menu', () => {
    it('offers AVXTO Manager as a top-level option', async () => {
        const { default: Menu } = await import('@/views/access/Menu.vue')
        const w = mount(Menu, { global: { stubs: Object.assign({ ToS: true, ImageDayNight: true }, stubs), mocks: { $t: (k: string) => k } } })
        const link = w.findAll('a.multi_option').find((a) => a.text().includes('Access using AVXTO Manager'))
        expect(link?.attributes('data-to')).toBe('/access/manager')
        routeQuery.add = '1'
        w.unmount()
        const w2 = mount(Menu, { global: { stubs: Object.assign({ ToS: true, ImageDayNight: true }, stubs), mocks: { $t: (k: string) => k } } })
        expect(w2.findAll('a.multi_option').find((a) => a.text().includes('AVXTO Manager'))?.attributes('data-to')).toBe('/access/manager?add=1')
        w2.unmount()
    })
})
