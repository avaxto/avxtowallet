import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GetTransactionsParams, TransactionType } from '@/js/Glacier/models'
import { getTransactionsForAddresses } from '@/js/Glacier/getTransactionsForAddresses'
import { ava } from '@/AVA'
import { isMainnetNetworkID, isTestnetNetworkID } from '@/utils/network-utils'
import { BlockchainId, Network, SortOrder } from '@avalabs/glacier-sdk'
import { cleanAddrs } from '@/js/Glacier/utils'

const TX_LIMIT = 500

export const useHistoryStore = defineStore('history', () => {
    // State
    const isUpdating = ref<boolean>(false)
    const isUpdatingAll = ref<boolean>(false)
    const isError = ref<boolean>(false)
    const recentTransactions = ref<TransactionType[]>([])
    const allTransactions = ref<TransactionType[]>([])

    // Actions
    const updateTransactionHistory = () => {
        updateAllTransactionHistory()
    }

    const setIsUpdating = (value: boolean) => {
        isUpdating.value = value
    }

    const setRecentTransactions = (transactions: TransactionType[]) => {
        recentTransactions.value = transactions
    }

    const updateAllTransactionHistory = async () => {
        const netID = ava.getNetworkID()
        if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) {
            allTransactions.value = []
            return
        }

        const network = isMainnetNetworkID(netID) ? Network.MAINNET : Network.FUJI

        // Lazy-import to avoid circular dependency at module load time
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useMainStore } = await import('@/stores/main')
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        if (!wallet) return

        isUpdatingAll.value = true
        isError.value = false

        try {
            const xAddrs = cleanAddrs(wallet.getAllAddressesX?.() ?? [])
            const pAddrs = cleanAddrs(wallet.getAllAddressesP?.() ?? [])
            const evmAddrs: string[] = wallet.ethAddress ? [`0x${wallet.ethAddress}`] : []

            const chains: { blockchainId: BlockchainId; addresses: string[] }[] = []
            if (xAddrs.length) chains.push({ blockchainId: BlockchainId.X_CHAIN, addresses: xAddrs })
            if (pAddrs.length) chains.push({ blockchainId: BlockchainId.P_CHAIN, addresses: pAddrs })
            if (evmAddrs.length) chains.push({ blockchainId: BlockchainId.C_CHAIN, addresses: evmAddrs })

            const results = await Promise.all(
                chains.map(({ blockchainId, addresses }) => {
                    const params: GetTransactionsParams = {
                        addresses,
                        blockchainId,
                        network,
                        sortOrder: SortOrder.DESC,
                    }
                    return getTransactionsForAddresses(params, TX_LIMIT)
                })
            )

            const merged = ([] as TransactionType[]).concat(...results)
            merged.sort((a, b) => {
                const tA = (a as any).timestamp ?? (a as any).blockTimestamp ?? 0
                const tB = (b as any).timestamp ?? (b as any).blockTimestamp ?? 0
                return tB - tA
            })
            allTransactions.value = merged
        } catch (e) {
            console.error('Failed to fetch transaction history:', e)
            isError.value = true
        } finally {
            isUpdatingAll.value = false
        }
    }

    return {
        // State
        isUpdating,
        isUpdatingAll,
        isError,
        recentTransactions,
        allTransactions,

        // Actions
        updateTransactionHistory,
        updateAllTransactionHistory,
        setIsUpdating,
        setRecentTransactions,
    }
})