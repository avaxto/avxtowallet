/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { ava, avm, bintools } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { SingletonWallet } from '@/js/wallets/SingletonWallet'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'
import { Wallet } from '@/js/wallets/AbstractWallet'
import { Buffer } from '@/avalanche'
import { privateToAddress } from 'ethereumjs-util'
import { updateFilterAddresses } from '../providers'
import { getAvaxPriceUSD } from '@/helpers/price_helper'
import {
    extractKeysFromDecryptedFile,
    KEYSTORE_VERSION,
    makeKeyfile,
    readKeyFile,
} from '@/js/Keystore'
import { AllKeyFileDecryptedTypes } from '@/js/IKeystore'

// Import types
import type {
    IssueBatchTxInput,
    ImportKeyfileInput,
    ExportWalletsInput,
    AccessWalletMultipleInput,
} from '@/types'

// Import store composables
import { useAssetsStore } from './assets'
import { useNotificationsStore } from './notifications'
import { useHistoryStore } from './history'
import { useAvxtoStore } from './avxto'

export const useMainStore = defineStore('main', () => {
    // State
    const isAuth = ref(false)
    const isSwitchingAccount = ref(false)
    // Wallets are class instances whose internal balance/UTXO/fetch state mutates
    // asynchronously, and components read those fields reactively (P-chain balance,
    // EVM balance, staking, the refresh spinner). So the wallets must stay DEEPLY
    // reactive — a plain deep `ref` provides that.
    //
    // The catch: Vue's deep ref-unwrapping strips private members from the nested
    // avalanche.js objects (UTXOSet etc.), mangling the exposed type and forcing
    // `as any` casts at every call site. To get both deep reactivity AND a clean
    // `Wallet` type, each is held in a private deep ref and exposed through a
    // writable computed that re-asserts the type with a single internal cast. The
    // computed passes the reactive proxy straight through, so deep reactivity is
    // preserved (verified: cross-store computeds recompute on internal mutations).
    const _activeWallet = ref<Wallet | null>(null)
    const activeWallet = computed<Wallet | null>({
        get: () => _activeWallet.value as unknown as Wallet | null,
        set: (w) => {
            _activeWallet.value = w
        },
    })
    const address = ref<string | null>(null)
    const _wallets = ref<Wallet[]>([])
    const wallets = computed<Wallet[]>({
        get: () => _wallets.value as unknown as Wallet[],
        set: (w) => {
            _wallets.value = w
        },
    })
    // will be forgotten when tab is closed
    const _volatileWallets = ref<Wallet[]>([])
    const volatileWallets = computed<Wallet[]>({
        get: () => _volatileWallets.value as unknown as Wallet[],
        set: (w) => {
            _volatileWallets.value = w
        },
    })
    const warnUpdateKeyfile = ref(false) // If true will prompt the user to export a new keyfile
    const prices = ref({
        usd: 0,
    })

    // Cookie consent: null = not yet decided, true = accepted, false = rejected
    const cookiesAccepted = ref<boolean | null>(
        localStorage.getItem('cookiesAccepted') === null
            ? null
            : localStorage.getItem('cookiesAccepted') === 'true'
    )

    // Getters
    const addresses = computed((): string[] => {
        const wallet = activeWallet.value
        if (!wallet) return []
        const derivedAddresses = wallet.getDerivedAddresses()
        return derivedAddresses
    })

    // Actions
    const updateActiveAddress = () => {
        if (!activeWallet.value) {
            address.value = null
        } else {
            const addrNow = activeWallet.value.getCurrentAddressAvm()
            address.value = addrNow
        }
    }

    // Called from Mnemonic.vue when accessing wallet
    const accessWallet = async (mnemonic: string): Promise<MnemonicWallet> => {
        
        const wallet: MnemonicWallet = await addWalletMnemonic(mnemonic)

        await activateWallet(wallet)

        onAccess()
        return wallet
    }

    // Only for singletons and mnemonics
    const accessWalletMultiple = async ({
        keys: keyList,
        activeIndex,
    }: {
        keys: AccessWalletMultipleInput[]
        activeIndex: number
    }) => {
        for (let i = 0; i < keyList.length; i++) {
            try {
                const keyInfo = keyList[i]
                if (keyInfo.type === 'mnemonic') {
                    await addWalletMnemonic(keyInfo.key)
                } else {
                    await addWalletSingleton(keyInfo.key)
                }
            } catch (e) {
                continue
            }
        }

        await activateWallet(wallets.value[activeIndex])

        onAccess()
    }

    const accessWalletLedger = async (wallet: LedgerWallet) => {
        wallets.value = [wallet]

        await activateWallet(wallet)

        onAccess()
    }

    const accessWalletSingleton = async (key: string) => {
        const wallet = await addWalletSingleton(key)
        await activateWallet(wallet)

        onAccess()
    }

    let _injectedAccountsChangedListener: ((accounts: string[]) => void) | null = null

    /**
     * Switch to a new injected account in-place — no page reload.
     * Called directly from the accountsChanged listener so the switch
     * feels instant instead of going through a full reload cycle.
     */
    const switchInjectedAccount = async (newAddress: string) => {
        isSwitchingAccount.value = true
        const avxtoStore = useAvxtoStore()
        avxtoStore.stopPolling()

        // Reset wallet list — the old wallet is no longer valid
        wallets.value = []
        volatileWallets.value = []
        activeWallet.value = null
        address.value = null
        isAuth.value = false

        let wallet: InjectedWallet
        try {
            wallet = await InjectedWallet.connectWithAddress(newAddress)
        } catch (e) {
            console.error('switchInjectedAccount failed:', e)
            isSwitchingAccount.value = false
            return
        }

        wallets.value = [wallet]
        volatileWallets.value = [wallet]

        await activateWallet(wallet)
        onAccess()
    }

    const accessWalletInjected = async () => {
        let wallet: InjectedWallet | null = null
        try {
            wallet = await InjectedWallet.connect()
        } catch (e) {
            throw new Error(
                e instanceof Error ? e.message : 'Failed to connect to wallet extension.'
            )
        }

        wallets.value = [wallet]
        volatileWallets.value = [wallet]

        await activateWallet(wallet)

        onAccess()

        // Listen for account switches in the Core App / MetaMask extension.
        // When the user picks a different account, mark for auto-reconnect and
        // do a full-page reload so all wallet state is cleanly re-initialised.
        const provider = (window as any).avalanche ?? (window as any).ethereum
        if (provider?.on) {
            // Remove any stale listener from a previous connection.
            if (_injectedAccountsChangedListener) {
                provider.removeListener?.('accountsChanged', _injectedAccountsChangedListener)
            }
            _injectedAccountsChangedListener = (accounts: string[]) => {
                if (!accounts || accounts.length === 0) {
                    // Extension disconnected — log out cleanly.
                    logout()
                    return
                }
                // Switch to the new account immediately without a page reload.
                switchInjectedAccount(accounts[0])
            }
            provider.on('accountsChanged', _injectedAccountsChangedListener)
        }
    }

    const onAccess = () => {
        isAuth.value = true
        isSwitchingAccount.value = false

        const assetsStore = useAssetsStore()
        assetsStore.updateAvaAsset()
        assetsStore.updateBaseAsset()
        router.push('/wallet')
        assetsStore.updateUTXOs()

        // Start periodic AVXTO token balance check
        const avxtoStore = useAvxtoStore()
        avxtoStore.startPolling()
    }


    const logout = async () => {
        // Stop AVXTO balance polling
        const avxtoStore = useAvxtoStore()
        avxtoStore.stopPolling()

        localStorage.removeItem('w')
        // Go to the base URL with GET request not router
        // This clears all state and resets the app
        window.location.href = '/'
    }

    // used with logout
    const removeAllKeys = async () => {
        const notificationsStore = useNotificationsStore()

        while (wallets.value.length > 0) {
            const wallet = wallets.value[0]
            await removeWallet(wallet)

            notificationsStore.add({
                title: 'Key Removed',
                message: 'Private key and assets removed from the wallet.',
            })
        }

        wallets.value = []
        volatileWallets.value = []
    }

    // Add a HD wallet from mnemonic string
    const addWalletMnemonic = async (mnemonic: string): Promise<MnemonicWallet | null> => {
        // Cannot add mnemonic wallets on ledger mode
        if (activeWallet.value?.type === 'ledger') return null

        // Make sure wallet doesnt exist already
        for (let i = 0; i < wallets.value.length; i++) {
            const w = wallets.value[i]
            if (w.type === 'mnemonic') {
                if ((w as MnemonicWallet).getMnemonic() === mnemonic) {
                    throw new Error('Wallet already exists.')
                }
            }
        }

        const wallet = new MnemonicWallet(mnemonic)
        wallets.value = [...wallets.value, wallet]
        volatileWallets.value = [...volatileWallets.value, wallet]
        return wallet
    }

    // Add a singleton wallet from private key string
    const addWalletSingleton = async (pk: string): Promise<SingletonWallet | null> => {
        try {
            const keyBuf = Buffer.from(pk, 'hex')
            // @ts-ignore
            privateToAddress(keyBuf)
            pk = `PrivateKey-${bintools.cb58Encode(keyBuf)}`
        } catch (e) {
            //
        }

        // Cannot add singleton wallets on ledger mode
        if (activeWallet.value?.type === 'ledger') return null

        // Make sure wallet doesnt exist already
        for (let i = 0; i < wallets.value.length; i++) {
            const w = wallets.value[i]
            if (w.type === 'singleton') {
                if ((w as SingletonWallet).key === pk) {
                    throw new Error('Wallet already exists.')
                }
            }
        }

        const wallet = new SingletonWallet(pk)
        wallets.value = [...wallets.value, wallet]
        volatileWallets.value = [...volatileWallets.value, wallet]
        return wallet
    }

    const removeWallet = (wallet: Wallet) => {
        // Reassign (not splice) so the shallowRef triggers reactivity.
        wallets.value = wallets.value.filter((w) => w !== wallet)
    }

    const issueBatchTx = async (data: IssueBatchTxInput) => {
        const wallet = activeWallet.value
        if (!wallet) return 'error'

        const toAddr = data.toAddress
        const orders = data.orders
        const memo = data.memo

        try {
            const txId: string = await wallet.issueBatchTx(orders, toAddr, memo)
            return txId
        } catch (e) {
            throw e
        }
    }

    /*
        Called from accessWallet
    */
    const activateWallet = async (wallet: Wallet) => {
        activeWallet.value = wallet

        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()
        assetsStore.updateAvaAsset()
        assetsStore.updateBaseAsset()
        updateActiveAddress()
        historyStore.updateTransactionHistory()
        updateFilterAddresses()
    }

    const exportWallets = async (input: ExportWalletsInput) => {
        try {
            const pass = input.password
            const walletsToExport = input.wallets
            const wallet = activeWallet.value as MnemonicWallet | SingletonWallet | null
            if (!wallet) throw new Error('No active wallet.')
            const activeIndex = walletsToExport.findIndex((w) => w.id == wallet!.id)

            const file_data = await makeKeyfile(walletsToExport, pass, activeIndex)

            // Download the file
            const text = JSON.stringify(file_data)

            const utcDate = new Date()
            const dateString = utcDate.toISOString().replace(' ', '_')
            const filename = `AVAX_${dateString}.json`

            const blob = new Blob([text], {
                type: 'application/json',
            })
            const url = URL.createObjectURL(blob)
            const element = document.createElement('a')

            element.setAttribute('href', url)
            element.setAttribute('download', filename)
            element.style.display = 'none'
            document.body.appendChild(element)
            element.click()
            document.body.removeChild(element)
        } catch (e) {
            const notificationsStore = useNotificationsStore()
            notificationsStore.add({
                title: 'Export Wallet',
                message: 'Error exporting wallet.',
                type: 'error',
            })
        }
    }

    // Given a key file with password, will try to decrypt the file and add keys to user's
    // key chain
    const importKeyfile = async (data: ImportKeyfileInput) => {
        const pass = data.password
        const fileData = data.data

        const version = fileData.version

        try {
            // Decrypt the key file with the password
            const keyFile: AllKeyFileDecryptedTypes = await readKeyFile(fileData, pass)
            // Extract wallet keys
            const keys = extractKeysFromDecryptedFile(keyFile)

            // If not auth, login user then add keys
            if (!isAuth.value) {
                await accessWalletMultiple({
                    keys,
                    activeIndex: keyFile.activeIndex,
                })
            } else {
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i]

                    // Private keys from the keystore file do not have the PrivateKey- prefix
                    if (key.type === 'mnemonic') {
                        await addWalletMnemonic(key.key)
                    } else if (key.type === 'singleton') {
                        await addWalletSingleton(key.key)
                    }
                }
            }

            // Keystore warning flag asking users to update their keystore files;
            warnUpdateKeyfile.value = false
            if (version !== KEYSTORE_VERSION) {
                warnUpdateKeyfile.value = true
            }
            volatileWallets.value = []

            return {
                success: true,
                message: 'success',
            }
        } catch (err) {
            throw err
        }
    }

    const updateAvaxPrice = async () => {
        const usd = await getAvaxPriceUSD()
        prices.value = {
            usd,
        }
    }

    const acceptCookies = () => {
        cookiesAccepted.value = true
        localStorage.setItem('cookiesAccepted', 'true')
    }

    const rejectCookies = () => {
        cookiesAccepted.value = false
        localStorage.setItem('cookiesAccepted', 'false')
    }

    return {
        // State
        isAuth,
        isSwitchingAccount,
        activeWallet,
        address,
        wallets,
        volatileWallets,
        warnUpdateKeyfile,
        prices,
        cookiesAccepted,

        // Getters
        addresses,

        // Actions
        updateActiveAddress,
        accessWallet,
        accessWalletMultiple,
        accessWalletLedger,
        accessWalletSingleton,
        accessWalletInjected,
        onAccess,
        logout,
        removeAllKeys,
        addWalletMnemonic,
        addWalletSingleton,
        removeWallet,
        issueBatchTx,
        activateWallet,
        exportWallets,
        importKeyfile,
        updateAvaxPrice,
        acceptCookies,
        rejectCookies,
    }
})