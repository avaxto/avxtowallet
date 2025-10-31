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

// Vuex compatibility: useStore now returns the combined store state
// Components can access stores via: const store = useStore()
// Then use: store.state.xxx or store.dispatch()
import { useMainStore } from './main'
import { useAssetsStore } from './assets'
import { useNetworkStore } from './network'
import { useNotificationsStore } from './notifications'
import { useHistoryStore } from './history'
import { usePlatformStore } from './platform'
import { useLedgerStore } from './ledger'
import { useAccountsStore } from './accounts'
import { useEarnStore } from './earn'
import { computed } from 'vue'

export function useStore() {
    const mainStore = useMainStore()
    const assetsStore = useAssetsStore()
    const networkStore = useNetworkStore()
    const notificationsStore = useNotificationsStore()
    const historyStore = useHistoryStore()
    const platformStore = usePlatformStore()
    const ledgerStore = useLedgerStore()
    const accountsStore = useAccountsStore()
    const earnStore = useEarnStore()

    return {
        state: {
            // Main store state
            isAuth: computed(() => mainStore.isAuth),
            activeWallet: computed(() => mainStore.activeWallet),
            address: computed(() => mainStore.address),
            wallets: computed(() => mainStore.wallets),
            volatileWallets: computed(() => mainStore.volatileWallets),
            warnUpdateKeyfile: computed(() => mainStore.warnUpdateKeyfile),
            prices: computed(() => mainStore.prices),

            // Module stores (Vuex-style namespaced access)
            Assets: assetsStore,
            Network: networkStore,
            Notifications: notificationsStore,
            History: historyStore,
            Platform: platformStore,
            Ledger: ledgerStore,
            Accounts: accountsStore,
            Earn: earnStore,
        },
        
        dispatch(action: string, payload?: any): any {
            // Map Vuex-style dispatch calls to Pinia actions
            if (action.includes('/')) {
                const [module, actionName] = action.split('/')
                const storeMap: Record<string, any> = {
                    'Assets': assetsStore,
                    'Network': networkStore,
                    'Notifications': notificationsStore,
                    'History': historyStore,
                    'Platform': platformStore,
                    'Ledger': ledgerStore,
                    'Accounts': accountsStore,
                    'Earn': earnStore,
                }
                const store = storeMap[module]
                if (store && typeof store[actionName] === 'function') {
                    return store[actionName](payload)
                }
            } else {
                // Root-level actions go to mainStore
                if (typeof (mainStore as any)[action] === 'function') {
                    return (mainStore as any)[action](payload)
                }
            }
            console.warn(`Action not found: ${action}`)
            return Promise.resolve()
        },

        getters: {},
        commit() {
            // Pinia doesn't use commits, mutations are direct
            console.warn('commit() is deprecated with Pinia - use direct state mutations')
        },
    }
}