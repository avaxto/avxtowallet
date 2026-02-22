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
import { useErc721Store } from './erc721'
import { useAvxtoStore } from './avxto'

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
    const erc721Store = useErc721Store()

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
            ERC721: erc721Store,
        },
        
        dispatch(action: string, payload?: any): any {
            if (action.includes('/')) {
                const parts = action.split('/')
                
                // Handle nested actions like Assets/ERC721/init
                if (parts.length === 3) {
                    const [module, subModule, actionName] = parts
                    
                    if (module === 'Assets' && subModule === 'ERC721') {
                        if (typeof erc721Store[actionName] === 'function') {
                            return erc721Store[actionName](payload)
                        } else {
                            console.warn(`❌ Store action not found: ${module}/${subModule}.${actionName}`)
                            return Promise.resolve()
                        }
                    }
                } else if (parts.length === 2) {
                    // Handle regular module actions
                    const [module, actionName] = parts
                    const storeMap: Record<string, any> = {
                        'Assets': assetsStore,
                        'Network': networkStore,
                        'Notifications': notificationsStore,
                        'History': historyStore,
                        'Platform': platformStore,
                        'Ledger': ledgerStore,
                        'Accounts': accountsStore,
                        'Earn': earnStore,
                        'ERC721': erc721Store,
                    }
                    
                    const store = storeMap[module]
                    if (store && typeof store[actionName] === 'function') {
                        return store[actionName](payload)
                    } else {
                        console.warn(`❌ Store action not found: ${module}.${actionName}`)
                        return Promise.resolve()
                    }
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
                const parts = path.split('/')
                
                // Handle nested getters like Assets/ERC721/networkContracts
                if (parts.length === 3) {
                    const [module, subModule, getterName] = parts
                    
                    if (module === 'Assets' && subModule === 'ERC721') {
                        if (erc721Store[getterName] !== undefined) {
                            return typeof erc721Store[getterName] === 'function' ? erc721Store[getterName]() : erc721Store[getterName]
                        }
                    }
                } else if (parts.length === 2) {
                    // Handle regular module getters
                    const [module, getterName] = parts
                    const storeMap: Record<string, any> = {
                        'Assets': assetsStore,
                        'Network': networkStore,
                        'Notifications': notificationsStore,
                        'History': historyStore,
                        'Platform': platformStore,
                        'Ledger': ledgerStore,
                        'Accounts': accountsStore,
                        'Earn': earnStore,
                        'ERC721': erc721Store,
                    }
                    
                    const store = storeMap[module]
                    if (store && store[getterName] !== undefined) {
                        // Return the computed value if it's a computed property
                        return typeof store[getterName] === 'function' ? store[getterName]() : store[getterName]
                    }
                }
            }
            
            return undefined
        },
    }
}