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
import { WalletHelper } from '@/helpers/wallet_helper'
import { IBatchRecipient } from '@/js/TxHelper'
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
import type { SessionVault } from '@/js/security/SessionVault'

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
// The rest of the stores holding Avalanche session state — see `logout`.
// Several of these import this file back; that cycle is pre-existing and safe
// (nothing is read at module scope, only inside functions), and `assets` and
// `avxto` above already rely on it.
import { useEarnStore } from './earn'
import { useErc721Store } from './erc721'
import { useEvmPortfolioStore } from './evmPortfolio'
import { useOfflineSigningStore } from './offlineSigning'
import { useTransferPrefillStore } from './transferPrefill'
import { useSessionLogStore } from './sessionlog'
import { useLedgerStore } from './ledger'
import { stopPollingX, stopPollingC } from '../providers'
// Imported from the store module directly rather than the `@/platforms` barrel:
// that barrel registers every platform, including the Avalanche adapter, which
// imports this file back. `platforms/store` itself imports nothing from here.
import { useActivePlatformStore } from '@/platforms/store'
import type { AccessOptions } from '@/platforms/types'

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

    /**
     * Avalanche's connected wallet, regardless of which platform tab is active.
     *
     * Use this ONLY for work that is about Avalanche as such and must run while
     * the user is looking at another platform — tearing this session down, and
     * refreshing it when its tab is re-entered. Everything that renders or acts
     * on "the wallet the user is currently using" wants `activeWallet` below.
     */
    const avalancheWallet = computed<Wallet | null>(
        () => _activeWallet.value as unknown as Wallet | null
    )

    /**
     * The connected wallet, or null when Avalanche is not the active platform.
     *
     * That second clause is the whole reason this is a computed rather than the
     * plain ref it reads. Roughly seventy call sites read `mainStore.activeWallet`
     * — X/P chain tabs, staking, HD derivation, the keystore modals, the NFT
     * studio — and every one of them is written on the assumption, stated
     * explicitly in AddressCard.vue, that it "is null for any other platform
     * since each keeps its own session store".
     *
     * That assumption used to hold by accident: only one platform could be
     * connected at a time, so a non-Avalanche platform being active implied
     * Avalanche was logged out. Concurrent sessions break exactly that
     * implication — Avalanche can now be connected while Bitcoin is the active
     * tab — and every one of those call sites would start rendering Avalanche's
     * wallet onto another platform's tab. Showing one chain's balances and
     * addresses under another chain's name is the worst failure this codebase
     * has; a user could send to an address the UI attributed to the wrong chain.
     *
     * Gating here makes the assumption true by construction instead, in one
     * place, for every reader at once — including the ones nobody thought to
     * audit. The alternative, re-pointing seventy call sites at the platform
     * store, is the same fix applied seventy times with seventy chances to miss
     * one, and a permanent obligation on every future reader to know about this.
     *
     * `isAvalancheActive` is the established test for this, expressed in terms
     * of chain kinds rather than the platform id — see the note on it in
     * platforms/store.ts, and on `PlatformChainKind` in platforms/types.ts.
     */
    const activeWallet = computed<Wallet | null>({
        get: () => {
            if (!useActivePlatformStore().isAvalancheActive) return null
            return _activeWallet.value as unknown as Wallet | null
        },
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
    // `avalancheWallet`, not `activeWallet`: this runs inside `activateWallet`,
    // i.e. during login, and the one-phrase unlock opens several platforms
    // before landing on one of them — so Avalanche is not necessarily the
    // active tab at the moment its own wallet is being set up. Reading the
    // gated accessor here would blank the address of the wallet we are in the
    // middle of connecting.
    const updateActiveAddress = () => {
        const wallet = avalancheWallet.value
        if (!wallet) {
            address.value = null
        } else {
            address.value = wallet.getCurrentAddressAvm()
        }
    }

    // Called from Mnemonic.vue when accessing wallet.
    // `sessionPassword` encrypts this wallet's secrets in memory and is never
    // stored — it must be re-entered to authorize each signing operation.
    const accessWallet = async (
        mnemonic: string,
        sessionPassword: string,
        options: AccessOptions = {}
    ): Promise<MnemonicWallet> => {
        const wallet: MnemonicWallet = await addWalletMnemonic(mnemonic, sessionPassword)

        await activateWallet(wallet)

        onAccess(options)
        return wallet
    }

    // Only for singletons and mnemonics
    const accessWalletMultiple = async ({
        keys: keyList,
        activeIndex,
        sessionPassword,
    }: {
        keys: AccessWalletMultipleInput[]
        activeIndex: number
        sessionPassword: string
    }) => {
        for (let i = 0; i < keyList.length; i++) {
            try {
                const keyInfo = keyList[i]
                if (keyInfo.type === 'mnemonic') {
                    await addWalletMnemonic(keyInfo.key, sessionPassword)
                } else {
                    await addWalletSingleton(keyInfo.key, sessionPassword)
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

    const accessWalletSingleton = async (key: string, sessionPassword: string) => {
        const wallet = await addWalletSingleton(key, sessionPassword)
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

    // `options.navigate === false` when several platforms are being opened at
    // once from one recovery phrase: the first to finish would otherwise
    // navigate away from the form still opening the rest. Everything else here
    // — auth flag, UTXO fetch, balance polling — happens either way. Same shape
    // as the Bitcoin and Solana stores' `accessWithMnemonic`.
    const onAccess = (options: AccessOptions = {}) => {
        isAuth.value = true
        isSwitchingAccount.value = false

        // activateWallet() (always called right before this) has already run
        // updateAvaAsset()/updateBaseAsset() — don't repeat them here.
        const assetsStore = useAssetsStore()
        if (options.navigate !== false) router.push('/wallet')
        assetsStore.updateUTXOs()

        // Start periodic AVXTO token balance check
        const avxtoStore = useAvxtoStore()
        avxtoStore.startPolling()

        // The platform layer mirrors "is anything connected?" per platform, and
        // Avalanche's answer is this store. Without this the new session is
        // invisible to the tabs until something else happens to bump the epoch.
        useActivePlatformStore().notifyWalletChanged()
    }


    /**
     * Wipes the ciphertext held by every wallet this session opened.
     *
     * Dropping the references is not enough. A `SessionVault` holds encrypted
     * secrets in ordinary memory, and until the reload that used to follow
     * logout, nothing guaranteed that memory was ever released — a wallet still
     * reachable from a closure, a pending promise, or a component that has not
     * been torn down yet keeps its vault alive with the secrets still in it.
     * `clear()` zeroes them on the spot. Ledger and injected wallets have no
     * vault (the key never leaves the device or the extension), hence the
     * duck-check — the same one the Bitcoin and Solana stores use.
     */
    const clearWalletVaults = () => {
        for (const wallet of [..._wallets.value, ..._volatileWallets.value]) {
            if (wallet && 'vault' in wallet) {
                const held = wallet as unknown as { vault: SessionVault }
                held.vault.clear()
            }
        }
    }

    /**
     * Ends the Avalanche session in place, without a page reload.
     *
     * This function is Phase 3. Logging out used to be one line —
     * `window.location.href = '/'` — and that line did all the work: every
     * store, poller and SDK singleton went away with the page. It cannot stay,
     * because a reload takes every OTHER platform's session with it; their
     * vaults live only in memory, so disconnecting Avalanche would silently
     * log the user out of Bitcoin and Solana too. So the reload's job has to be
     * done explicitly here.
     *
     * The danger in doing it by hand is precise and worth naming: anything
     * missed keeps the previous account's data, and the next wallet to connect
     * inherits it — balances, addresses and transaction history belonging to
     * someone else, presented as the current wallet's own. That is a far worse
     * failure than a slow logout, so the order below is deliberate:
     *
     *  1. Stop everything that writes. Pollers and the AVXTO interval run on
     *     timers; clearing a store while one is still in flight just lets it
     *     repopulate behind us.
     *  2. Wipe the vaults, while the wallets are still reachable.
     *  3. Clear the derived stores, then this store's own state last.
     *
     * This function is NOT covered by a test yet, and should be. Reaching it
     * from Jest means loading this module, which reaches `@avalanche-sdk/chainkit`
     * — shipped as untransformed TypeScript that the repo's Jest setup cannot
     * currently load at all. The test worth writing once that is fixed is a
     * generic one rather than a list of assertions mirroring the list below:
     * dirty every key of every store named here, reset, and require each to be
     * back at its initial value unless explicitly declared session-independent.
     * Written that way it fails by name when someone adds session state and
     * forgets this function — which is the actual risk, and the reason the
     * reload was safer than any hand-written list can be.
     *
     * Adding state here? It belongs in this function unless it describes the
     * chain rather than the user: network endpoints, validator sets, token
     * *definitions* and saved keystore accounts all deliberately survive.
     * `js/Erc20Token.resetBalance` is the shape of the awkward middle case —
     * a chain-level object carrying one wallet's balance.
     */
    const resetSession = () => {
        // 1. Silence the writers.
        stopPollingX()
        stopPollingC()
        useAvxtoStore().resetSession()

        // 2. The secrets themselves.
        clearWalletVaults()

        // 3. Everything derived from the wallet.
        useAssetsStore().resetSession()
        useHistoryStore().resetSession()
        useEarnStore().resetSession()
        useErc721Store().clear()
        useEvmPortfolioStore().resetSession()
        useOfflineSigningStore().resetSession()
        useTransferPrefillStore().clear()
        useSessionLogStore().reset()
        useLedgerStore().resetSession()

        // 4. This store's own.
        wallets.value = []
        volatileWallets.value = []
        _activeWallet.value = null
        address.value = null
        isAuth.value = false
        isSwitchingAccount.value = false
        warnUpdateKeyfile.value = false

        // The persisted volatile wallet, which would otherwise be restored on
        // the next boot as though the user had never logged out.
        localStorage.removeItem('w')
    }

    const logout = async () => {
        resetSession()

        // Tell the platform layer the wallet is gone before asking it where to
        // go next — `finishDisconnect` picks a surviving session by looking at
        // which platforms still report one, and Avalanche's answer is read
        // through this store.
        const platformStore = useActivePlatformStore()
        platformStore.notifyWalletChanged()

        // Hands off rather than hard-navigating here. This is the line the
        // whole phase turns on: `window.location.href = '/'` would end every
        // other live platform session too. `finishDisconnect` falls back to the
        // same full reset when this was the last one. See platforms/store.ts.
        await platformStore.finishDisconnect()
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

    // Add a HD wallet from mnemonic string, protected by a session password
    const addWalletMnemonic = async (
        mnemonic: string,
        sessionPassword: string
    ): Promise<MnemonicWallet | null> => {
        // Cannot add mnemonic wallets on ledger mode. Ungated for the same
        // reason as `updateActiveAddress` — this runs during login, when
        // Avalanche need not be the active platform yet.
        if (avalancheWallet.value?.type === 'ledger') return null

        const wallet = await MnemonicWallet.create(mnemonic, sessionPassword)

        // Make sure wallet doesnt exist already. Compares extended public keys
        // rather than mnemonics: two wallets share an xpub exactly when they
        // share a mnemonic, and this needs no access to the vaulted secret.
        const xpub = wallet.getXpubXP()
        for (let i = 0; i < wallets.value.length; i++) {
            const w = wallets.value[i]
            if (w.type === 'mnemonic' && (w as MnemonicWallet).getXpubXP() === xpub) {
                throw new Error('Wallet already exists.')
            }
        }

        wallets.value = [...wallets.value, wallet]
        volatileWallets.value = [...volatileWallets.value, wallet]
        return wallet
    }

    // Add a singleton wallet from private key string
    const addWalletSingleton = async (
        pk: string,
        sessionPassword: string
    ): Promise<SingletonWallet | null> => {
        try {
            const keyBuf = Buffer.from(pk, 'hex')
            // @ts-ignore
            privateToAddress(keyBuf)
            pk = `PrivateKey-${bintools.cb58Encode(keyBuf)}`
        } catch (e) {
            //
        }

        // Cannot add singleton wallets on ledger mode. Ungated — see above.
        if (avalancheWallet.value?.type === 'ledger') return null

        const wallet = await SingletonWallet.create(pk, sessionPassword)

        // Make sure wallet doesnt exist already. Compares addresses rather than
        // private keys, which are no longer readable without authorizing.
        const addr = wallet.getCurrentAddressAvm()
        for (let i = 0; i < wallets.value.length; i++) {
            const w = wallets.value[i]
            if (w.type === 'singleton' && (w as SingletonWallet).getCurrentAddressAvm() === addr) {
                throw new Error('Wallet already exists.')
            }
        }

        wallets.value = [...wallets.value, wallet]
        volatileWallets.value = [...volatileWallets.value, wallet]
        return wallet
    }

    const removeWallet = (wallet: Wallet) => {
        // Reassign (not splice) so the shallowRef triggers reactivity.
        wallets.value = wallets.value.filter((w) => w !== wallet)
    }

    // Deliberately the GATED accessor: signing must be done by the wallet the
    // user is actually looking at. If Avalanche is connected but another
    // platform's tab is active, this refuses rather than spending from a chain
    // the user is not currently on.
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

    /**
     * Sends a single X-chain transaction to multiple recipients (batch send).
     * Returns the resulting tx id.
     */
    const issueBatchTxMulti = async (recipients: IBatchRecipient[], memo?: Buffer) => {
        const wallet = activeWallet.value
        if (!wallet) throw new Error('No active wallet.')
        return await WalletHelper.issueBatchTxMultiRecipient(wallet, recipients, memo)
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
        const sessionPassword = data.sessionPassword
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
                    sessionPassword,
                })
            } else {
                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i]

                    // Private keys from the keystore file do not have the PrivateKey- prefix
                    if (key.type === 'mnemonic') {
                        await addWalletMnemonic(key.key, sessionPassword)
                    } else if (key.type === 'singleton') {
                        await addWalletSingleton(key.key, sessionPassword)
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
        avalancheWallet,
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
        resetSession,
        removeAllKeys,
        addWalletMnemonic,
        addWalletSingleton,
        removeWallet,
        issueBatchTx,
        issueBatchTxMulti,
        activateWallet,
        exportWallets,
        importKeyfile,
        updateAvaxPrice,
        acceptCookies,
        rejectCookies,
    }
})