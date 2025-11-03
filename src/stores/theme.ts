import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemeType = 'day' | 'night'

export const useThemeStore = defineStore('theme', () => {
    const theme = ref<ThemeType>('day')

    const setTheme = (newTheme: ThemeType) => {
        theme.value = newTheme
        localStorage.setItem('theme', newTheme)
        document.documentElement.setAttribute('data-theme', newTheme)
    }

    const setDay = () => {
        setTheme('day')
    }

    const setNight = () => {
        setTheme('night')
    }

    const toggle = () => {
        setTheme(theme.value === 'day' ? 'night' : 'day')
    }

    const initTheme = () => {
        const savedTheme = localStorage.getItem('theme') as ThemeType
        if (savedTheme && (savedTheme === 'day' || savedTheme === 'night')) {
            setTheme(savedTheme)
        } else {
            setTheme('day')
        }
    }

    return {
        theme,
        setTheme,
        setDay,
        setNight,
        toggle,
        initTheme
    }
})