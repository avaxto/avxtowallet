import { iUserAccountEncrypted } from '@/types'
import { Wallet } from '@/js/wallets/AbstractWallet'
import isEqual from 'lodash.isequal'
import differenceBy from 'lodash.differenceby'
import { readKeyFile } from '@/js/Keystore'

const checkAccountsExist = (): boolean => {
    return localStorage.getItem('accounts') !== null
}

export function getAccountByIndex(index: number): iUserAccountEncrypted | null {
    return getLocalStorageAccounts()[index] || null
}

export const checkIfSavedLocally = (allWallets: Wallet[]): boolean => {
    const exists = checkAccountsExist()

    if (!exists) return false

    const ethAddressArray: string[] = allWallets.map((x: Wallet) => x.ethAddress)

    const savedAccounts: iUserAccountEncrypted[] = getLocalStorageJSONItem('accounts')

    for (const each of savedAccounts) {
        if (isEqual(each.baseAddresses, ethAddressArray)) {
            return true
        }
    }

    return false
}
export const removeAccountByIndex = (index: number): void => {
    const accounts: iUserAccountEncrypted[] = getLocalStorageAccounts()
    accounts.splice(index, 1)
    saveLocalStorageJSONItem('accounts', accounts)
}

export const getLocalStorageJSONItem = (key: string) => {
    const item = localStorage.getItem(key)
    if (item !== null) {
        return JSON.parse(item)
    }
}

export function getLocalStorageAccounts(): iUserAccountEncrypted[] {
    return getLocalStorageJSONItem('accounts') || []
}

export const saveLocalStorageJSONItem = (key: string, data: any) => {
    const formatted = JSON.stringify(data)
    localStorage.setItem(key, formatted)
}

export const getIndexByWallets = (wallets: Wallet[]): number | null => {
    const ethAddressArray: string[] = wallets.map((x: Wallet) => x.getEvmAddress())
    const savedAccounts: iUserAccountEncrypted[] = getLocalStorageAccounts()
    for (let i = 0; i < savedAccounts.length; i++) {
        const acct = savedAccounts[i]
        if (isEqual(acct.baseAddresses, ethAddressArray)) {
            return i
        }
    }
    return null
}

export const getNonVolatileWallets = (
    allWallets: Wallet[],
    volatileWallets: Wallet[]
): Wallet[] => {
    const diff = differenceBy(allWallets, volatileWallets, 'ethAddress') as Wallet[]
    return diff === undefined ? [] : diff
}

export function addAccountToStorage(account: iUserAccountEncrypted) {
    const accounts = getLocalStorageAccounts()
    accounts.push(account)
    saveLocalStorageJSONItem('accounts', accounts)
}

// Given a password and an account, will verify if its the correct password
export async function verifyAccountPassword(account: iUserAccountEncrypted, password: string) {
    try {
        const res = await readKeyFile(account.wallet, password)
        return true
    } catch (err) {
        return false
    }
}

export function overwriteAccountAtIndex(newAccount: iUserAccountEncrypted, index: number) {
    const accts = getLocalStorageAccounts()
    accts.splice(index, 1, newAccount)
    saveLocalStorageJSONItem('accounts', accts)
}

export default {
    removeAccountByIndex,
    checkIfSavedLocally,
    getNonVolatileWallets,
}
