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
        setDay: themeStore.setDay,
        setNight: themeStore.setNight,
        toggle: themeStore.toggle,
        initTheme: themeStore.initTheme
    }
}

export type { ThemeType }