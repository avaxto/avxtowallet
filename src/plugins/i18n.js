// Vue 3 compatible i18n setup
import en from '../locales/en.json'

// Only English ships with the app; every other language is its own small
// chunk, loaded when it is picked (or restored at startup). These are the
// languages the picker has always offered; the other JSON files in
// src/locales were imported here but never offered.
const loaders = {
    fr: () => import('../locales/fr.json'),
    tr: () => import('../locales/tr.json'),
    it: () => import('../locales/it.json'),
    es: () => import('../locales/es.json'),
    de: () => import('../locales/de.json'),
    kr: () => import('../locales/kr.json'),
    ru: () => import('../locales/ru.json'),
    zh_hant: () => import('../locales/zh_hant.json'),
    zh_hans: () => import('../locales/zh_hans.json'),
    pt: () => import('../locales/pt.json'),
    vn: () => import('../locales/vn.json'),
    nl: () => import('../locales/nl.json'),
    uk: () => import('../locales/uk.json'),
    ca: () => import('../locales/ca.json'),
}

/** Every language the picker offers, English first. */
export const LOCALE_CODES = ['en', ...Object.keys(loaders)]

/** Loads `code`'s messages into `i18n` if needed, then switches to it. Unknown codes are ignored. */
export async function setLocale(i18n, code) {
    if (code !== 'en') {
        const load = loaders[code]
        if (!load) return
        if (!i18n.global.availableLocales.includes(code)) {
            const mod = await load()
            i18n.global.setLocaleMessage(code, mod.default ?? mod)
        }
    }
    i18n.global.locale.value = code
}

/** Re-applies the language saved by the picker, if any. */
export function restoreSavedLocale(i18n) {
    let saved = null
    try {
        saved = localStorage.getItem('lang')
    } catch {}
    if (saved && saved !== 'en') setLocale(i18n, saved).catch(() => {})
}

const messages = {
    en,
}

// Export just the messages for Vue 3 createI18n
export default messages
