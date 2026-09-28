/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The idle lock ends EVERY connected platform's session (File → Exit's
 * `logoutAll`), not just Avalanche's. Locking Avalanche alone made its tab
 * vanish while every other tab stayed open with its keys in memory.
 */
import { mount } from '@vue/test-utils'

const stub = (name: string) => ({ name, template: '<div />' })
jest.mock('@/components/wallet/TopInfo.vue', () => stub('TopInfo'))
jest.mock('@/components/wallet/Sidebar.vue', () => stub('Sidebar'))
jest.mock('@/components/modals/UpdateKeystore/UpdateKeystoreModal.vue', () => stub('UpdateKeystoreModal'))
jest.mock('@/components/NavbarMenu.vue', () => stub('NavbarMenu'))
jest.mock('@/components/wallet/PlatformTabs.vue', () => stub('PlatformTabs'))
jest.mock('@/components/modals/BaseAssetGateModal.vue', () => stub('BaseAssetGateModal'))

const mainLogout = jest.fn()
jest.mock('@/stores', () => ({
    useMainStore: () => ({ logout: mainLogout, warnUpdateKeyfile: false, volatileWallets: [] }),
}))

const logoutAll = jest.fn()
jest.mock('@/platforms', () => ({
    useActivePlatformStore: () => ({ logoutAll, activePlatformId: 'avalanche' }),
}))

const scope = { active: false, onClosed: null as null | (() => void) }
jest.mock('@/js/security/session', () => ({
    isScopeActive: () => scope.active,
    onScopeClosed: (fn: () => void) => {
        scope.onClosed = fn
        return () => {}
    },
}))

jest.mock('vue-router', () => ({ useRouter: () => ({ push: jest.fn() }) }))

import Wallet from '@/views/Wallet.vue'

const SEVEN_MIN = 7 * 60 * 1000
const CHECK = 15 * 1000

function mountWallet() {
    return mount(Wallet, {
        global: {
            stubs: { 'router-view': true, transition: false, 'keep-alive': true },
        },
    })
}

beforeEach(() => {
    jest.useFakeTimers()
    mainLogout.mockClear()
    logoutAll.mockClear()
    scope.active = false
})

afterEach(() => {
    jest.useRealTimers()
})

it('logs out every platform after the idle timeout, not just Avalanche', () => {
    const wrapper = mountWallet()

    jest.advanceTimersByTime(SEVEN_MIN - CHECK)
    expect(logoutAll).not.toHaveBeenCalled()

    jest.advanceTimersByTime(2 * CHECK)
    expect(logoutAll).toHaveBeenCalledTimes(1)
    expect(mainLogout).not.toHaveBeenCalled()
    wrapper.unmount()
})

it('restarts the idle clock on activity', () => {
    const wrapper = mountWallet()

    jest.advanceTimersByTime(SEVEN_MIN - 2 * CHECK)
    wrapper.find('.wallet_view').trigger('mousemove')
    jest.advanceTimersByTime(SEVEN_MIN - 2 * CHECK)
    expect(logoutAll).not.toHaveBeenCalled()
    wrapper.unmount()
})

it('waits for a signing operation to finish before locking', () => {
    const wrapper = mountWallet()
    scope.active = true

    jest.advanceTimersByTime(SEVEN_MIN + CHECK)
    expect(logoutAll).not.toHaveBeenCalled()

    scope.active = false
    scope.onClosed?.()
    expect(logoutAll).toHaveBeenCalledTimes(1)
    wrapper.unmount()
})
