// Vue 3 + Vuetify 3 migration in progress
// Temporarily using compatibility mode
import { createVuetify } from 'vuetify'
import 'vuetify/styles'
import '@fortawesome/fontawesome-free/css/all.css' // Ensure you are using css-loader

import { library } from '@fortawesome/fontawesome-svg-core'
import {
    faDollarSign,
    faTimesCircle,
    faSignOutAlt,
    faSignInAlt,
    faCaretDown,
    faHistory,
    faGlobe,
    faExchangeAlt,
    faDna,
    faCamera,
    faDownload,
    faCheckCircle,
    faTimes,
    faPlus,
    faMinus,
    faSync,
    faExclamationTriangle,
    faPrint,
    faQrcode,
    faCopy,
    faKey,
    faFileExcel,
    faList,
    faTrash,
    faUpload,
    faCreditCard,
    faEllipsisH,
    faArrowRight,
    faArrowLeft,
    faTint,
    faChevronDown,
    faBars,
    faCog,
    faSearch,
    faListOl,
    faSpinner,
    faInfoCircle,
    faLink,
    faQuoteRight,
    faLock,
    faUnlock,
    faEye,
    faEyeSlash,
    faQuestionCircle,
    faUsers,
    faFilter,
    faFont,
    faBoxes,
    faRandom,
    faCheckSquare,
    faAngleLeft,
    faAngleRight,
    faExpand,
    faShare,
    faVideo,
    faUnlink,
    faFileCsv,
    faGlasses,
} from '@fortawesome/free-solid-svg-icons'

import { faBtc, faGoogle } from '@fortawesome/free-brands-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome'

library.add(
    faDollarSign,
    faBtc,
    faTimesCircle,
    faSignOutAlt,
    faSignInAlt,
    faCaretDown,
    faHistory,
    faGlobe,
    faExchangeAlt,
    faDna,
    faCamera,
    faEllipsisH,
    faDownload,
    faCheckCircle,
    faCheckSquare,
    faTimes,
    faPlus,
    faMinus,
    faSync,
    faExclamationTriangle,
    faPrint,
    faQrcode,
    faCopy,
    faKey,
    faFileExcel,
    faList,
    faTrash,
    faUpload,
    faCreditCard,
    faArrowRight,
    faArrowLeft,
    faTint,
    faChevronDown,
    faBars,
    faCog,
    faSearch,
    faListOl,
    faGoogle,
    faSpinner,
    faInfoCircle,
    faLink,
    faQuoteRight,
    faLock,
    faEye,
    faEyeSlash,
    faQuestionCircle,
    faUsers,
    faFilter,
    faFont,
    faBoxes,
    faUnlock,
    faRandom,
    faAngleLeft,
    faAngleRight,
    faExpand,
    faShare,
    faVideo,
    faUnlink,
    faFileCsv,
    faGlasses
)

// Import Vuetify components
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'

// Create Vuetify 3 instance with all components
export default createVuetify({
    // Import all components and directives
    components,
    directives,
    
    theme: {
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
                }
            },
        },
    },
    // icons: {
    //     defaultSet: 'fa',
    // },
})
