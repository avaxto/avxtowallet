import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getLocalStorageAccounts } from '@/helpers/account_helper'

// Define types locally for now (until we find the original types file)
export interface iUserAccountEncrypted {
    name: string
    wallet: any // KeyFile
    baseAddresses: string[]
}

export const useAccountsStore = defineStore('accounts', () => {
    const accounts = ref<iUserAccountEncrypted[]>([])

    // Actions
    const loadAccounts = () => {
        accounts.value = getLocalStorageAccounts()
    }

    const addAccount = (account: iUserAccountEncrypted) => {
        accounts.value.push(account)
    }

    const removeAccount = (index: number) => {
        accounts.value.splice(index, 1)
    }

    const clearAccounts = () => {
        accounts.value = []
    }

    // Initialize accounts on store creation
    loadAccounts()

    return {
        accounts: computed(() => accounts.value),
        loadAccounts,
        addAccount,
        removeAccount,
        clearAccounts
    }
})