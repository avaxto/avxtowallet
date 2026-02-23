import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { ava, avm, bintools } from '@/AVA'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { SingletonWallet } from '@/js/wallets/SingletonWallet'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'
import { WalletType } from '@/js/wallets/types'
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
} from '@/store/types'

// Import store composables
import { useAssetsStore } from './assets'
import { useNotificationsStore } from './notifications'
import { useHistoryStore } from './history'
import { useAvxtoStore } from './avxto'

export const useMainStore = defineStore('main', () => {
    // State
    const isAuth = ref(false)
    const activeWallet = ref<WalletType | null>(null)
    const address = ref<string | null>(null)
    const wallets = ref<WalletType[]>([])
    const volatileWallets = ref<WalletType[]>([]) // will be forgotten when tab is closed
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

    const accessWalletInjected = async () => {
        const wallet = await InjectedWallet.connect()
        wallets.value = [wallet]
        volatileWallets.value = [wallet]

        await activateWallet(wallet)

        onAccess()
    }

    const onAccess = () => {
        isAuth.value = true

        const assetsStore = useAssetsStore()
        assetsStore.updateAvaAsset()
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
        const currentWallets = wallets.value

        while (currentWallets.length > 0) {
            const wallet = currentWallets[0]
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
            const w = wallets.value[i] as WalletType
            if (w.type === 'mnemonic') {
                if ((w as MnemonicWallet).getMnemonic() === mnemonic) {
                    throw new Error('Wallet already exists.')
                }
            }
        }

        const wallet = new MnemonicWallet(mnemonic)
        wallets.value.push(wallet)
        volatileWallets.value.push(wallet)
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
            const w = wallets.value[i] as WalletType
            if (w.type === 'singleton') {
                if ((w as SingletonWallet).key === pk) {
                    throw new Error('Wallet already exists.')
                }
            }
        }

        const wallet = new SingletonWallet(pk)
        wallets.value.push(wallet)
        volatileWallets.value.push(wallet)
        return wallet
    }

    const removeWallet = (wallet: WalletType) => {
        // TODO: This might cause an error use wallet id instead
        const index = wallets.value.indexOf(wallet)
        wallets.value.splice(index, 1)
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
    const activateWallet = async (wallet: WalletType) => {
        activeWallet.value = wallet

        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()

        assetsStore.updateAvaAsset()
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