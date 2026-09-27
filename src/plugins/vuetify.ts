// Vue 3 + Vuetify 3 migration in progress
// Temporarily using compatibility mode
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@fortawesome/fontawesome-free/css/all.css' // Ensure you are using css-loader

import { library } from '@fortawesome/fontawesome-svg-core'

// Every icon in the three free sets, rather than a curated per-icon import
// list. That list (still visible in git history) had to be updated by hand
// every time a `<fa icon="...">` referencing a new name was added anywhere in
// the app, and a missed update meant the icon silently rendered nothing —
// vue-fontawesome logs a console warning rather than a visible broken-icon
// glyph, so this had already drifted out of sync at least once by the time
// this change was made.
//
// This is a real, deliberate bundle-size trade: `library.add()` needs each
// icon's SVG path data at runtime, which cannot be tree-shaken the way a
// per-icon import can — so this ships the full solid/brands/regular sets
// (roughly 2000 + 587 + 273 icons) instead of only the ~65 actually used
// today. Registration itself is purely additive and cannot change or remove
// any icon that already resolves, so nothing that renders today can break.
import { fas } from '@fortawesome/free-solid-svg-icons'
import { fab } from '@fortawesome/free-brands-svg-icons'
import { far } from '@fortawesome/free-regular-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

library.add(fas, fab, far)

// Vuetify draws its own controls' icons — the checkbox box, radio dots,
// select arrows, clear buttons — from an icon font, Material Design Icons by
// default. That font was never installed or loaded here, so every one of
// them rendered as an empty glyph: an invisible checkbox on /create, among
// others. Font Awesome 5 (loaded above) is what the app uses everywhere
// else, and Vuetify ships an icon set mapping all its built-in icons onto it.
import { aliases as faAliases, fa } from 'vuetify/iconsets/fa'

// Vuetify's `fa` set names four icons the Font Awesome 6 way; this is Font
// Awesome 5, which calls them something else — left alone they render blank.
// tests/vuetifyIcons checks every alias against the installed CSS.
const aliases = {
    ...faAliases,
    fullscreen: 'fas fa-expand',
    volumeHigh: 'fas fa-volume-up',
    volumeMedium: 'fas fa-volume-down',
    search: 'fas fa-search',
}

// Import Vuetify components
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// Create Vuetify 3 instance with all components
export default createVuetify({
    // Import all components and directives
    components,
    directives,

    theme: {
        // The app has one theme (dark) — this used to be overridden at
        // runtime by a watch in App.vue synced to a theme store that no
        // longer exists.
        defaultTheme: 'dark',
        themes: {
            light: {
                colors: {
                    primary: '#42b983',
                    secondary: '#06f',
                    accent: '#82B1FF',
                    error: '#ff9090',
                    info: '#2196F3',
                    success: '#4CAF50',
                    warning: '#ecce73',
                },
            },
            dark: {
                dark: true,
                colors: {
                    primary: '#42b983',
                    secondary: '#e84142',
                    accent: '#82B1FF',
                    error: '#ff9090',
                    info: '#2196F3',
                    success: '#4CAF50',
                    warning: '#ecce73',
                },
            },
        },
    },
    icons: {
        defaultSet: 'fa',
        aliases,
        sets: { fa },
    },
})
