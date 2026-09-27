/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The "I have backed up my phrase" checkbox on /create. It was still wired
 * the Vue 2 way, so it never ticked and the parent's `v-model` never changed
 * — the create flow could not get past it. Real Vuetify here: the bug was in
 * how the two were wired together.
 */
import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { defineComponent, ref } from 'vue'

import MnemonicCopied from '@/components/CreateWalletWorkflow/MnemonicCopied.vue'

function mountWithParent() {
    const isSecured = ref(false)
    const wrapper = mount(
        defineComponent({
            components: { MnemonicCopied },
            setup: () => ({ isSecured }),
            template: '<MnemonicCopied v-model="isSecured" explain="I backed it up" />',
        }),
        { global: { plugins: [createVuetify({ components, directives })] } }
    )
    return { wrapper, isSecured }
}

it('ticks, and updates the parent v-model, when clicked', async () => {
    const { wrapper, isSecured } = mountWithParent()
    const box = wrapper.find('input[type="checkbox"]')
    expect((box.element as HTMLInputElement).checked).toBe(false)

    await box.setValue(true)

    expect(isSecured.value).toBe(true)
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
})

it('unticks again on a second click', async () => {
    const { wrapper, isSecured } = mountWithParent()
    const box = wrapper.find('input[type="checkbox"]')
    await box.setValue(true)
    await box.setValue(false)
    expect(isSecured.value).toBe(false)
})

it('follows the parent when it resets the box', async () => {
    const { wrapper, isSecured } = mountWithParent()
    await wrapper.find('input[type="checkbox"]').setValue(true)

    // CreateWallet clears it whenever a new phrase is generated.
    isSecured.value = false
    await wrapper.vm.$nextTick()
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
})

it('shows its label', () => {
    const { wrapper } = mountWithParent()
    expect(wrapper.text()).toContain('I backed it up')
})
