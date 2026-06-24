import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { addAccountToStorage, getLocalStorageAccounts } from '@/helpers/account_helper'
import { makeKeyfile } from '@/js/Keystore'
import type { SaveAccountInput, iUserAccountEncrypted as iUserAccountEncryptedType } from '@/types'
import type { Wallet } from '@/js/wallets/AbstractWallet'

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

    const saveAccount = async (input: SaveAccountInput): Promise<void> => {
        // Lazy import to avoid circular dependency
        const { useMainStore } = await import('./main')
        const mainStore = useMainStore()

        const walletList = mainStore.wallets
        const activeWallet = mainStore.activeWallet
        if (!walletList.length || !activeWallet) throw new Error('No wallets loaded.')

        const activeIndex = walletList.findIndex((w: any) => w.id === (activeWallet as any).id)
        const keyfile = await makeKeyfile(walletList as any, input.password, activeIndex)

        const baseAddresses: string[] = walletList.map((w: any) => w.getEvmAddress())

        const account: iUserAccountEncryptedType = {
            name: input.accountName,
            baseAddresses,
            wallet: keyfile,
        }

        addAccountToStorage(account)
        loadAccounts()
    }

    // Initialize accounts on store creation
    loadAccounts()

    return {
        accounts: computed(() => accounts.value),
        loadAccounts,
        addAccount,
        removeAccount,
        clearAccounts,
        saveAccount,
    }
})