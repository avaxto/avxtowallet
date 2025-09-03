import { createApp } from 'vue'
import VueMeta from 'vue-meta'
import App from './App.vue'
import router from './router'
import store from './store'
import { createI18n } from 'vue-i18n'
//@ts-ignore
import { Datetime } from 'vue-datetime'
import 'vue-datetime/dist/vue-datetime.css'

import { createBootstrap } from 'bootstrap-vue-next'
import vuetify from './plugins/vuetify'
// @ts-ignore
import i18nMessages from './plugins/i18n.js'
// @ts-ignore
import posthogPlugin from './plugins/posthog.js'

// Import Bootstrap CSS
import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'

// Create the Vue app
const app = createApp(App)

// Create i18n instance
const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: i18nMessages
})

// Install plugins
app.use(router)
app.use(store)
app.use(vuetify)
app.use(i18n)
app.use(posthogPlugin)
app.use(createBootstrap())

// Register global components
app.component('datetime', Datetime)

// Configure app
app.config.globalProperties.$productionTip = false

// Mount the app
const mountedApp = app.mount('#app')

// @ts-ignore
if (window.Cypress) {
    // only available during E2E tests
    // @ts-ignore
    window.app = mountedApp
}

// App lifecycle - equivalent to mounted hook
app.mixin({
    mounted() {
        // Reveal app version
        console.log(`App Version: ${process.env.VUE_APP_VERSION}`)
        // Hide loader once vue is initialized
        const loader = document.getElementById('app_loading')
        if (loader) {
            loader.style.display = 'none'
        }
    }
})

// Extending Big.js with a helper function
import Big from 'big.js'

declare module 'big.js' {
    interface Big {
        toLocaleString(toFixed?: number): string
    }
}

Big.prototype.toLocaleString = function (toFixed: number = 9) {
    const value = this

    const fixedStr = this.toFixed(toFixed)
    const split = fixedStr.split('.')
    const wholeStr = parseInt(split[0]).toLocaleString('en-US')

    if (split.length === 1) {
        return wholeStr
    } else {
        let remainderStr = split[1]

        // remove trailing 0s
        let lastChar = remainderStr.charAt(remainderStr.length - 1)
        while (lastChar === '0') {
            remainderStr = remainderStr.substring(0, remainderStr.length - 1)
            lastChar = remainderStr.charAt(remainderStr.length - 1)
        }

        const trimmed = remainderStr.substring(0, toFixed)
        if (!trimmed) return wholeStr
        return `${wholeStr}.${trimmed}`
    }
}
