import { createPinia } from 'pinia'
import { computed } from 'vue'

// Create Pinia instance
export const pinia = createPinia()

// Store imports
import { useMainStore } from './main'
import { useAssetsStore } from './assets'
import { useNetworkStore } from './network'
import { useNotificationsStore } from './notifications'
import { useHistoryStore } from './history'
import { usePlatformStore } from './platform'
import { useLedgerStore } from './ledger'
import { useAccountsStore } from './accounts'
import { useEarnStore } from './earn'

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
            isAuth: computed(() => mainStore.isAuth),
            activeWallet: computed(() => mainStore.activeWallet),
            address: computed(() => mainStore.address),
            addresses: computed(() => mainStore.addresses || []),
            wallets: computed(() => mainStore.wallets),
            volatileWallets: computed(() => mainStore.volatileWallets),
            warnUpdateKeyfile: computed(() => mainStore.warnUpdateKeyfile),
            prices: computed(() => mainStore.prices),

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
                } else {
                    console.warn(`❌ Store action not found: ${module}.${actionName}`)
                    return Promise.resolve()
                }
            } else {
                // Root-level actions
                if (typeof (mainStore as any)[action] === 'function') {
                    return (mainStore as any)[action](payload)
                }
            }
            
            return Promise.resolve()
        },

        // Commit method - maps to Pinia actions (no mutations needed in Pinia)
        commit(mutation: string, payload?: any) {
            switch (mutation) {
                case 'Ledger/openModal':
                    return ledgerStore.openModal(payload)
                case 'Ledger/closeModal':
                    return ledgerStore.closeModal()
                case 'Notifications/add':
                    return notificationsStore.add(payload)
                case 'Notifications/remove':
                    return notificationsStore.remove(payload)
                case 'Accounts/loadAccounts':
                    return accountsStore.loadAccounts()
                default:
                    // Try to find matching action in stores
                    if (mutation.includes('/')) {
                        return this.dispatch(mutation, payload)
                    }
                    break
            }
        },

        // Getters method - maps to Pinia computed properties
        getters(path: string) {
            if (path.includes('/')) {
                const [module, getterName] = path.split('/')
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
                if (store && store[getterName] !== undefined) {
                    // Return the computed value if it's a computed property
                    return typeof store[getterName] === 'function' ? store[getterName]() : store[getterName]
                }
            }
            
            return undefined
        },
    }
}