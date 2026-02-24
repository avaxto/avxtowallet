import { createPinia } from 'pinia'

// Create Pinia instance
export const pinia = createPinia()

// Export all stores for direct Pinia usage
export { useMainStore } from './main'
export { useAssetsStore } from './assets'
export { useNetworkStore } from './network'
export { useNotificationsStore } from './notifications'
export { useHistoryStore } from './history'
export { usePlatformStore } from './platform'
export { useLedgerStore } from './ledger'
export { useAccountsStore } from './accounts'
export { useEarnStore } from './earn'
export { useErc721Store } from './erc721'
export { useAvxtoStore } from './avxto'