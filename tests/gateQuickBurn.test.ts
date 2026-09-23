/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The one-click burn at the top of the "AVXTO Burn Required" modal.
 *
 * What must hold: the button is preset to exactly the AVXTO still missing,
 * it burns from the very address the gate checks (a burn from any other one
 * would spend the tokens and unlock nothing), it refuses rather than
 * reverting when the wallet cannot do it, and once it lands the gated action
 * the user originally clicked carries on by itself.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import { BN } from '@/avalanche'
import { useMainStore } from '@/stores/main'

const E18 = new BN('1000000000000000000')
const tokens = (n: number) => new BN(n).mul(E18)

const AVALANCHE_ETH = '11'.repeat(20)
const AVALANCHE_ADDRESS = '0x' + AVALANCHE_ETH

// What the chain says this address has burned, as the gate reads it.
let burnedOnChain = tokens(3300)
jest.mock('@/js/MoatsStats', () => ({
    readBurnedOnMoats: async () => burnedOnChain,
}))

const signerRef: { current: any } = { current: null }
jest.mock('@/platforms/evmSigner', () => ({ activeEvmSigner: () => signerRef.current }))

let walletBalance = tokens(5_000_000)
const runMoatsAction = jest.fn()
jest.mock('@/js/Moats', () => {
    const actual = jest.requireActual('@/js/Moats')
    return {
        ...actual,
        readMoatsState: async () => ({
            decimals: 18,
            balance: walletBalance,
            allowance: new BN(0),
            minAmount: new BN('1000000000000'),
            burningEnabled: true,
            stakingEnabled: true,
            lockingEnabled: true,
            paused: false,
        }),
        runMoatsAction: (...a: any[]) => runMoatsAction(...a),
    }
})

import BaseAssetGateModal from '@/components/modals/BaseAssetGateModal.vue'
import { forgetBurnReads, useBaseAssetGate } from '@/composables/useBaseAssetGate'

const VBtn = {
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: '<button class="v-btn" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
}

const onCChain = (address = AVALANCHE_ADDRESS) => ({
    address,
    network: { evmChainId: 43114, name: 'Avalanche C-Chain' },
    // An extension wallet: the authorization gate lets it sign without a vault.
    authSubject: { type: 'injected' },
})

/** Mounts the modal and clicks a gated button, leaving the modal open over it. */
async function openFromGatedButton(action: () => void) {
    const pinia = createPinia()
    setActivePinia(pinia)
    useMainStore().activeWallet = { ethAddress: AVALANCHE_ETH } as any

    const wrapper = mount(BaseAssetGateModal, {
        global: {
            plugins: [pinia],
            stubs: { fa: true, 'v-btn': VBtn },
            mocks: { $router: { push: jest.fn() } },
        },
    })
    const gate = useBaseAssetGate()
    const pending = gate.gatedAction(action)
    await flushPromises()
    expect(gate.isModalOpen.value).toBe(true)
    return { wrapper, gate, pending }
}

const quickButton = (w: any) => w.find('button.quick_burn_btn')

jest.mock('vue-router', () => ({
    ...jest.requireActual('vue-router'),
    useRouter: () => ({ push: jest.fn() }),
}))

beforeEach(() => {
    burnedOnChain = tokens(3300)
    walletBalance = tokens(5_000_000)
    signerRef.current = onCChain()
    runMoatsAction.mockReset()
    forgetBurnReads()
    useBaseAssetGate().closeModal()
})

it('is preset to exactly what is missing, and burns it from the checked address in one click', async () => {
    let ran = false
    const { wrapper, gate, pending } = await openFromGatedButton(() => (ran = true))

    const btn = quickButton(wrapper)
    expect(btn.text()).toContain('Burn 996,700 AVXTO now')
    expect(btn.attributes('disabled')).toBeUndefined()

    runMoatsAction.mockImplementation(async () => {
        burnedOnChain = tokens(1_000_000) // what the chain says afterwards
        return { approveTxHash: '0xa', actionTxHash: '0xb', offline: false }
    })
    await btn.trigger('click')
    await flushPromises()

    expect(runMoatsAction).toHaveBeenCalledTimes(1)
    const [signer, mode, amount] = runMoatsAction.mock.calls[0]
    expect(signer.address).toBe(AVALANCHE_ADDRESS)
    expect(mode).toBe('burn')
    expect((amount as BN).eq(tokens(996_700))).toBe(true)

    // The gated action the user clicked carries on by itself.
    expect(await pending).toBe(true)
    expect(ran).toBe(true)
    expect(gate.isModalOpen.value).toBe(false)
})

it('asks for the full requirement when nothing has been burned yet', async () => {
    burnedOnChain = new BN(0)
    const { wrapper } = await openFromGatedButton(() => undefined)
    expect(quickButton(wrapper).text()).toContain('Burn 1,000,000 AVXTO now')
})

it('refuses when the wallet holds less than it would burn, instead of reverting', async () => {
    walletBalance = tokens(1000)
    const { wrapper } = await openFromGatedButton(() => undefined)

    expect(quickButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('You hold 1,000 AVXTO. Get 995,700 more first')
})

it('refuses to burn from an address the requirement is not checked against', async () => {
    // The EVM tab is in front, but the gate checks the Avalanche wallet.
    signerRef.current = onCChain('0x' + '22'.repeat(20))
    const { wrapper } = await openFromGatedButton(() => undefined)

    expect(quickButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('switch to the Avalanche tab')
})

it('refuses off Avalanche C-Chain', async () => {
    signerRef.current = { ...onCChain(), network: { evmChainId: 1, name: 'Ethereum' } }
    const { wrapper } = await openFromGatedButton(() => undefined)

    expect(quickButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Switch your wallet from Ethereum to Avalanche C-Chain')
})

it('stays open and says so when the burn fails, without running the action', async () => {
    let ran = false
    const { wrapper, gate } = await openFromGatedButton(() => (ran = true))

    runMoatsAction.mockRejectedValue(new Error('User rejected the request.'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    await quickButton(wrapper).trigger('click')
    await flushPromises()
    err.mockRestore()

    expect(gate.isModalOpen.value).toBe(true)
    expect(wrapper.text()).toContain('User rejected the request.')
    expect(ran).toBe(false)
})

/**
 * Regression: Modal emits `beforeClose` from inside its own close(), and the
 * modal treats that as a dismissal. Closing the Modal before settling the
 * real outcome turned every exit into "cancel" and greyed out the button the
 * user came from — even when they were leaving to burn.
 */
it.each([
    ['Burn AVXTO on moats.app instead', 'burn'],
    ['Swap for it in this wallet', 'swap'],
])('leaving via "%s" does not disable the button behind the modal', async (label) => {
    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    const { wrapper, gate, pending } = await openFromGatedButton(() => undefined)

    const target = [...wrapper.findAll('.v-btn'), ...wrapper.findAll('a')].find((b) =>
        b.text().includes(label)
    )!
    await target.trigger('click')
    await flushPromises()
    open.mockRestore()

    expect(await pending).toBe(false)
    expect(gate.isModalOpen.value).toBe(false)
    expect(gate.isBlocked.value).toBe(false)
})

it('cancel still disables it', async () => {
    const { wrapper, gate, pending } = await openFromGatedButton(() => undefined)
    await wrapper.find('button.cancel_btn').trigger('click')
    await flushPromises()

    expect(await pending).toBe(false)
    expect(gate.isBlocked.value).toBe(true)
})
