/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Vuetify's built-in icons (checkbox boxes, radio dots, select arrows, clear
 * buttons…) come from the icon set configured in plugins/vuetify. They used
 * to come from Material Design Icons, a font this app never loaded — so they
 * all rendered as empty glyphs: the /create checkbox was invisible.
 *
 * Pinned here: the app's Vuetify draws them with Font Awesome, and every
 * icon it can ask for names a class the installed Font Awesome CSS defines.
 */
import fs from 'fs'
import path from 'path'
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'

// The plugin imports Vuetify's stylesheet by package path, which jest's
// .css stub does not match.
jest.mock('vuetify/styles', () => ({}))

import vuetify from '@/plugins/vuetify'
import MnemonicCopied from '@/components/CreateWalletWorkflow/MnemonicCopied.vue'

const FA_CSS = fs.readFileSync(
    path.join(__dirname, '../node_modules/@fortawesome/fontawesome-free/css/all.css'),
    'utf8'
)

it('names only icons the installed Font Awesome defines', () => {
    const aliases = (vuetify as any).icons.aliases as Record<string, string>
    const missing = Object.entries(aliases)
        .filter(([, v]) => typeof v === 'string')
        .flatMap(([k, v]) => v.split(' ').filter((c) => c.startsWith('fa-')).map((c) => [k, c]))
        .filter(([, c]) => !FA_CSS.includes(`.${c}:before`))
    expect(missing).toEqual([])
})

it('draws the /create checkbox with Font Awesome, unticked and ticked', async () => {
    const isSecured = ref(false)
    const wrapper = mount(
        defineComponent({
            components: { MnemonicCopied },
            setup: () => ({ isSecured }),
            template: '<MnemonicCopied v-model="isSecured" explain="Backed up" />',
        }),
        { global: { plugins: [vuetify] } }
    )
    const icon = () => wrapper.find('.v-selection-control__input i').classes()

    expect(icon()).toEqual(expect.arrayContaining(['far', 'fa-square']))
    expect(icon().some((c) => c.startsWith('mdi'))).toBe(false)

    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(icon()).toEqual(expect.arrayContaining(['fas', 'fa-check-square']))
})
