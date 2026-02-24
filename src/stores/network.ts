import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { AvaNetwork } from '@/js/AvaNetwork'
import { BN } from '@/avalanche'
import { ava, avm, cChain, infoApi, pChain } from '@/AVA'
import { explorer_api } from '@/explorer_api'
import { web3 } from '@/evm'
import router from '@/router'
import { setCurrentNetwork } from '@/providers'
import { getConfigFromUrl, setNetworkAsync } from '@/avalanche-wallet-sdk/Network'

// Default network configurations — must match the explorer API endpoints
const MainnetConfig = new AvaNetwork(
    'Mainnet',
    'https://api.avax.network:443',
    1,
    'https://explorerapi.avax.network',
    'https://explorer-xp.avax.network',
    true
)

const TestnetConfig = new AvaNetwork(
    'Fuji',
    'https://api.avax-test.network:443',
    5,
    'https://explorerapi.avax-test.network',
    'https://explorer-xp.avax-test.network',
    true
)

export const useNetworkStore = defineStore('network', () => {
    // State
    const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
    const networks = ref<AvaNetwork[]>([])
    const networksCustom = ref<AvaNetwork[]>([])
    const selectedNetwork = ref<AvaNetwork | null>(null)
    const txFee = ref<BN>(new BN(0))

    // Getters
    const allNetworks = computed(() => {
        return networks.value.concat(networksCustom.value)
    })

    const currentNetwork = computed(() => {
        return selectedNetwork.value
    })

    // Actions
    const addNetwork = (net: AvaNetwork) => {
        networks.value.push(net)
    }

    const addCustomNetwork = (net: AvaNetwork) => {
        const customNets = networksCustom.value
        for (let i = 0; i < customNets.length; i++) {
            if (net.url === customNets[i].url) {
                return
            }
        }
        networksCustom.value.push(net)
        save()
    }

    const removeCustomNetwork = async (net: AvaNetwork) => {
        const index = networksCustom.value.indexOf(net)
        networksCustom.value.splice(index, 1)
        await save()
    }

    const saveSelectedNetwork = () => {
        const data = JSON.stringify(selectedNetwork.value?.url)
        localStorage.setItem('network_selected', data)
    }

    const loadSelectedNetwork = async (): Promise<boolean> => {
        const data = localStorage.getItem('network_selected')
        if (!data) return false
        try {
            const nets: AvaNetwork[] = allNetworks.value
            for (let i = 0; i < nets.length; i++) {
                const net = nets[i]
                if (JSON.stringify(net.url) === data) {
                    await setNetwork(net)
                    return true
                }
            }
            return false
        } catch (e) {
            return false
        }
    }

    const save = () => {
        const data = JSON.stringify(networksCustom.value)
        localStorage.setItem('networks', data)
    }

    const load = () => {
        const data = localStorage.getItem('networks')
        if (data) {
            const loadedNetworks: AvaNetwork[] = JSON.parse(data)
            loadedNetworks.forEach((n) => {
                const newCustom = new AvaNetwork(
                    n.name,
                    n.url,
                    //@ts-ignore
                    parseInt(n.networkId),
                    n.explorerUrl,
                    n.explorerSiteUrl,
                    n.readonly
                )
                addCustomNetwork(newCustom)
            })
        }
    }

    /**
     * Connect to the given network. This is the core network-switching action
     * that configures the Avalanche SDK, web3, explorer API, and notifies all
     * other stores so that balances / history / platform data refresh.
     */
    const setNetwork = async (net: AvaNetwork) => {
        status.value = 'connecting'

        // Lazy-import stores to avoid circular dependency at module load time
        const { useMainStore } = await import('@/stores/main')
        const { useAssetsStore } = await import('@/stores/assets')
        const { useHistoryStore } = await import('@/stores/history')
        const { usePlatformStore } = await import('@/stores/platform')

        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const historyStore = useHistoryStore()
        const platformStore = usePlatformStore()

        try {
            // Check if the network supports credentials
            await net.updateCredentials()
            ava.setRequestConfig('withCredentials', net.withCredentials)
            ava.setAddress(net.ip, net.port, net.protocol)
            ava.setNetworkID(net.networkId)

            // Clear old history
            historyStore.setRecentTransactions([])

            // Query the network to get blockchain IDs for X/P/C
            const chainIdX = await infoApi.getBlockchainID('X')
            const chainIdP = await infoApi.getBlockchainID('P')
            const chainIdC = await infoApi.getBlockchainID('C')

            avm.refreshBlockchainID(chainIdX)
            avm.setBlockchainAlias('X')
            pChain.refreshBlockchainID(chainIdP)
            pChain.setBlockchainAlias('P')
            cChain.refreshBlockchainID(chainIdC)
            cChain.setBlockchainAlias('C')

            avm.getAVAXAssetID(true)
            pChain.getAVAXAssetID(true)
            cChain.getAVAXAssetID(true)

            selectedNetwork.value = net
            saveSelectedNetwork()

            // Update explorer API base URL
            explorer_api.defaults.baseURL = net.explorerUrl

            // Set web3 provider to the C-chain RPC
            const web3Provider = `${net.protocol}://${net.ip}:${net.port}/ext/bc/C/rpc`
            web3.setProvider(web3Provider)

            // Start REST polling for this network
            setCurrentNetwork(net)

            // Reset assets and fetch the AVAX asset descriptor
            assetsStore.removeAllAssets()
            await assetsStore.updateAvaAsset()

            // If a wallet is active, notify it and refresh
            if (mainStore.isAuth) {
                router.replace('/wallet')
                const wallets = mainStore.wallets || []
                for (let i = 0; i < wallets.length; i++) {
                    wallets[i].onnetworkchange()
                }
            }

            await assetsStore.onNetworkChange(net)
            assetsStore.updateUTXOs()

            // Platform data
            if (typeof platformStore.update === 'function') platformStore.update()
            if (typeof platformStore.updateMinStakeAmount === 'function') platformStore.updateMinStakeAmount()

            // Transaction fee
            await updateTxFee()

            // Transaction history
            historyStore.updateTransactionHistory()

            // Point the embedded SDK at the same network
            try {
                const sdkNetConf = await getConfigFromUrl(net.getFullURL())
                await setNetworkAsync({
                    ...sdkNetConf,
                    explorerURL: net.explorerUrl,
                    explorerSiteURL: net.explorerSiteUrl,
                })
            } catch (sdkErr) {
                console.warn('SDK setNetworkAsync failed (non-fatal):', sdkErr)
            }

            status.value = 'connected'
            return true
        } catch (e) {
            console.error('Network connection failed:', e)
            status.value = 'disconnected'
            throw e
        }
    }

    const updateTxFee = async () => {
        try {
            const feeResult = await infoApi.getTxFee()
            txFee.value = feeResult.txFee
            avm.setTxFee(feeResult.txFee)
        } catch (e) {
            console.warn('Failed to fetch tx fee:', e)
        }
    }

    const init = async () => {
        // Load custom networks from localStorage first
        try {
            load()
        } catch (e) {
            console.error(e)
        }

        // Register built-in networks
        addNetwork(MainnetConfig)
        addNetwork(TestnetConfig)

        try {
            // Attempt to restore the previously selected network
            const isSet = await loadSelectedNetwork()
            if (!isSet) {
                // Default to the first built-in network (Mainnet)
                await setNetwork(networks.value[0])
            }
            return true
        } catch (e) {
            console.log(e)
            status.value = 'disconnected'
        }
    }

    return {
        // State
        status,
        networks,
        networksCustom,
        selectedNetwork,
        txFee,

        // Getters
        allNetworks,
        currentNetwork,

        // Actions
        init,
        setNetwork,
        addNetwork,
        addCustomNetwork,
        removeCustomNetwork,
        saveSelectedNetwork,
        loadSelectedNetwork,
        updateTxFee,
        save,
        load,
    }
})
