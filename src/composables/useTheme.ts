/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { computed } from 'vue'
import { useThemeStore, ThemeType } from '@/stores/theme'

export function useTheme() {
    const themeStore = useThemeStore()
    
    const theme = computed(() => themeStore.theme)
    const isDay = computed(() => themeStore.theme === 'day')
    const isNight = computed(() => themeStore.theme === 'night')

    return {
        theme,
        isDay,
        isNight,
        setTheme: themeStore.setTheme,
        initTheme: themeStore.initTheme
    }
}

export type { ThemeType }