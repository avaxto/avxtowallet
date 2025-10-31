import { createPinia } from 'pinia'

// Create the pinia instance
export const pinia = createPinia()

// Export individual stores
export { useMainStore } from './main'
export { useAssetsStore } from './assets'
export { useNetworkStore } from './network'
export { useNotificationsStore } from './notifications'
export { useHistoryStore } from './history'
export { usePlatformStore } from './platform'
export { useLedgerStore } from './ledger'
export { useAccountsStore } from './accounts'
export { useEarnStore } from './earn'

// Temporary compatibility layer for Vuex migration
export { useStore } from './vuex-compat'