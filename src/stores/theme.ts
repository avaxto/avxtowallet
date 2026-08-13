/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemeType = 'day' | 'night'

// Dark theme is permanent — there is no user-facing toggle, so this store
// no longer tracks a live preference or reads/writes a saved one; it just
// applies 'night' once on startup. ThemeType stays a 'day' | 'night' union
// (rather than narrowing to 'night') so the many isDay/isNight-driven
// asset-swapping components elsewhere keep compiling unchanged — isDay
// simply always resolves false now.
export const useThemeStore = defineStore('theme', () => {
    const theme = ref<ThemeType>('night')

    const setTheme = (newTheme: ThemeType) => {
        theme.value = newTheme
        document.documentElement.setAttribute('data-theme', newTheme)
    }

    const initTheme = () => {
        setTheme('night')
    }

    return {
        theme,
        setTheme,
        initTheme
    }
})
