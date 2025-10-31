/**
 * Temporary Vuex compatibility layer for migration
 * This provides basic useStore functionality to avoid import errors
 * Individual components should be migrated to use specific Pinia stores
 */
import { 
    useMainStore,
    useAssetsStore,
    useNetworkStore,
    useNotificationsStore,
    useHistoryStore,
    usePlatformStore,
    useLedgerStore,
    useAccountsStore,
    useEarnStore
} from './index'
import { computed } from 'vue'

export function useStore() {
    console.warn('Using Vuex compatibility layer - component should be migrated to Pinia')
    
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
            // Main store properties
            isAuth: computed(() => mainStore.isAuth),
            activeWallet: computed(() => mainStore.activeWallet),
            address: computed(() => mainStore.address),
            wallets: computed(() => mainStore.wallets),
            volatileWallets: computed(() => mainStore.volatileWallets),
            warnUpdateKeyfile: computed(() => mainStore.warnUpdateKeyfile),
            prices: computed(() => mainStore.prices),
            
            // Module properties (placeholder)
            Assets: {
                assetsDict: computed(() => ({})),
                balanceDict: computed(() => ({})),
                nftFams: computed(() => []),
                nftFamsDict: computed(() => ({})),
            },
            Network: {
                selectedNetwork: computed(() => null),
                networks: computed(() => []),
            },
            Notifications: {
                items: computed(() => notificationsStore.items),
            },
            History: {
                transactions: computed(() => []),
            },
            Platform: {
                minStakeAmount: computed(() => null),
            },
            Ledger: {
                isBlock: computed(() => false),
            },
            Accounts: {
                accountCount: computed(() => 0),
            },
            Earn: {
                rewardOwnerDict: computed(() => ({})),
            }
        },
        
        dispatch: (action: string, payload?: any) => {
            console.warn(`Vuex dispatch called: ${action} - should be migrated to Pinia action`)
            
            // Map common actions to Pinia actions
            switch (action) {
                case 'timeoutLogout':
                    return mainStore.timeoutLogout()
                case 'logout':
                    return mainStore.logout()
                case 'accessWallet':
                    return mainStore.accessWallet(payload)
                case 'Notifications/add':
                    return notificationsStore.add(payload)
                default:
                    console.warn(`Unmapped Vuex action: ${action}`)
                    return Promise.resolve()
            }
        },
        
        commit: (mutation: string, payload?: any) => {
            console.warn(`Vuex commit called: ${mutation} - should be migrated to Pinia`)
            // Most mutations should be replaced with direct state updates in Pinia
        }
    }
}