import { createApp } from 'vue'
import { configureCompat } from '@vue/compat'
import App from './App.vue'
import router from './router'
import { pinia } from './stores'
import store from './store'
import { createI18n } from 'vue-i18n'
//@ts-ignore
import { Datetime } from 'vue-datetime'
import 'vue-datetime/dist/vue-datetime.css'
import { createBootstrap, BContainer, BRow, BCol } from 'bootstrap-vue-next'
import vuetify from './plugins/vuetify'
// @ts-ignore
import i18nMessages from './plugins/i18n.js'
// @ts-ignore
import posthogPlugin from './plugins/posthog.js'
import 'bootstrap/dist/css/bootstrap.css'
import 'bootstrap-vue-next/dist/bootstrap-vue-next.css'
// Import FontAwesome component
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'
// Import head management
import { createUnhead } from '@unhead/vue'
import { VueHeadMixin } from '@unhead/vue'


configureCompat({
    COMPONENT_FUNCTIONAL: 'suppress-warning',
    RENDER_FUNCTION: false
})

// Create the Vue app
const app = createApp(App)

// Create i18n instance
const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: i18nMessages
})

// Create head instance for managing document head
const head = createUnhead()

// Install plugins
app.use(router)
app.use(pinia)
app.use(store)
app.use(vuetify)
app.use(i18n)
// Install head plugin
app.use({
    install(app) {
        app.config.globalProperties.$head = head
        app.provide('usehead', head)
    }
})
app.use(posthogPlugin)
app.use(createBootstrap({ components: true, directives: true }))
app.component('datetime', Datetime)
app.component('fa', FontAwesomeIcon)
app.component('b-container', BContainer)
app.component('b-row', BRow)
app.component('b-col', BCol)

app.config.globalProperties.$productionTip = false

// Global error handler for unhandled errors
app.config.errorHandler = (err: any, instance, info) => {
    console.error('Vue Error Handler:', err)
    console.error('Component:', instance)
    console.error('Error Info:', info)
    
    // Handle axios errors specifically
    if (err.response) {
        const status = err.response.status
        if (status === 401) {
            console.warn('Authentication error detected. This may be due to API changes or rate limiting.')
        } else if (status === 429) {
            console.warn('Rate limit exceeded. Please try again later.')
        }
    }
    
    // Prevent the error from propagating to the browser console in production
    if (process.env.NODE_ENV === 'production') {
        return false
    }
}

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
        console.log(`AVAX Toolbox Version: ${process.env.VITE_APP_VERSION}`)
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
