/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The message a gated action shows: the burn requirement, how much this
 * wallet has burned, what is left, and where to burn it.
 */
import { mount } from '@vue/test-utils'

import InsufficientBalanceNotice from '@/components/misc/InsufficientBalanceNotice.vue'

const MOATS = 'https://moats.app/moat/0xebe5fbacb882fd313d05684bef591c31f83b0524'

it('states the burn requirement, the burn so far and what is left, and links to moats.app', () => {
    const wrapper = mount(InsufficientBalanceNotice, {
        props: {
            thrValue: '1000000',
            thrSymbol: 'AVXTO',
            burnedValue: '2000',
            burnAddress: '0x4887c61ee00a4df4191533f3e7be62bd00ea2537',
        },
    })
    const text = wrapper.text()

    expect(text).toContain('requires burning AVXTO')
    expect(text).toContain('Minimum burned: 1,000,000 AVXTO')
    expect(text).toContain('Burned by this wallet so far: 2,000 AVXTO')
    expect(text).toContain('Burn at least 998,000 more AVXTO')
    expect(text).toContain('0x4887c61ee00a4df4191533f3e7be62bd00ea2537')
    expect(text).not.toContain('balance on this account is below')

    const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'))
    expect(hrefs).toContain(MOATS)
})

it('still explains the requirement with no session to read a burn from', () => {
    const wrapper = mount(InsufficientBalanceNotice, {
        props: { thrValue: '1000000', thrSymbol: 'AVXTO' },
    })
    const text = wrapper.text()

    expect(text).toContain('Burn 1,000,000 AVXTO')
    expect(text).not.toContain('so far')
    expect(wrapper.find('.alert').exists()).toBe(false)
})
