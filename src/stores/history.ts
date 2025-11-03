import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { TransactionType } from '@/js/Glacier/models'

export const useHistoryStore = defineStore('history', () => {
    // State
    const isUpdating = ref<boolean>(false)
    const recentTransactions = ref<TransactionType[]>([])
    
    // Actions
    const updateTransactionHistory = () => {
        // TODO: Implement full transaction history functionality
        console.log('TODO: Implement updateTransactionHistory')
    }

    const setIsUpdating = (value: boolean) => {
        isUpdating.value = value
    }

    const setRecentTransactions = (transactions: TransactionType[]) => {
        recentTransactions.value = transactions
    }

    return {
        // State
        isUpdating,
        recentTransactions,
        
        // Actions
        updateTransactionHistory,
        setIsUpdating,
        setRecentTransactions,
    }
})