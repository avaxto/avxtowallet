/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { AvaNetwork } from '@/js/AvaNetwork'
import { BN } from '@/avalanche'
import { ava, avm, cChain, infoApi, pChain } from '@/AVA'
import { Defaults } from '@/avalanche/utils'
import { explorer_api } from '@/explorer_api'
import { web3, FetchHttpProvider } from '@/evm'
import router from '@/router'
import { setCurrentNetwork } from '@/providers'
import { resetRpcFailover } from '@/providers/rpc_failover'
import {
    getConfigFromUrl,
    setNetworkAsync,
    MainnetConfig as SdkMainnetConfig,
    TestnetConfig as SdkTestnetConfig,
} from '@/avalanche-wallet-sdk/Network'

// Default network configurations — must match the explorer API endpoints.
// The official endpoint is listed first in each array (preferred/default
// choice); the public backups double as the RPC failover candidate pool
// (see src/providers/rpc_failover.ts) and as user-selectable networks.
// Indexer/explorer URLs are the same as the official network for all of
// them — only the RPC endpoint differs.
//
// Public backup providers serve the FULL node API (X/P/C by path),
// live-verified 2026-07-03 with avm.getHeight, platform.getHeight and
// eth_chainId + browser CORS checks. Note: EVM-only public RPCs (dRPC,
// 1RPC, Tenderly gateway…) are NOT listed — they cannot serve the X/P chain
// APIs a full network switch requires. Also verified dead/keyed as of
// 2026-07-03: Ankr, Blast, MeowRPC, Omnia, Nodies, BlockPI, Lava, SubQuery,
// Stakely.
const MAINNET_NETWORKS: AvaNetwork[] = [
    new AvaNetwork(
        'Mainnet',
        'https://api.avax.network:443',
        1,
        'https://explorerapi.avax.network',
        'https://explorer-xp.avax.network',
        true
    ),
    new AvaNetwork(
        'Mainnet (PublicNode)',
        'https://avalanche-c-chain-rpc.publicnode.com',
        1,
        'https://explorerapi.avax.network',
        'https://explorer-xp.avax.network',
        true,
        false // no /ext/info — see AvaNetwork.supportsInfoEndpoint
    ),
    new AvaNetwork(
        'Mainnet (OnFinality)',
        'https://avalanche.api.onfinality.io/public',
        1,
        'https://explorerapi.avax.network',
        'https://explorer-xp.avax.network',
        true,
        false
    ),
    new AvaNetwork(
        'Mainnet (ZAN)',
        'https://api.zan.top/avax-mainnet',
        1,
        'https://explorerapi.avax.network',
        'https://explorer-xp.avax.network',
        true,
        false
    ),
]

const TESTNET_NETWORKS: AvaNetwork[] = [
    new AvaNetwork(
        'Fuji',
        'https://api.avax-test.network:443',
        5,
        'https://explorerapi.avax-test.network',
        'https://explorer-xp.avax-test.network',
        true
    ),
    new AvaNetwork(
        'Fuji (PublicNode)',
        'https://avalanche-fuji-c-chain-rpc.publicnode.com',
        5,
        'https://explorerapi.avax-test.network',
        'https://explorer-xp.avax-test.network',
        true,
        false
    ),
    new AvaNetwork(
        'Fuji (ZAN)',
        'https://api.zan.top/avax-fuji',
        5,
        'https://explorerapi.avax-test.network',
        'https://explorer-xp.avax-test.network',
        true,
        false
    ),
]

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
     *
     * @param net Network to connect to
     * @param isFailover True when called by the RPC failover system
     * (src/providers/rpc_failover.ts). A failover switch keeps the session's
     * dead-endpoint list (so exhausted RPCs aren't retried).
     */
    const setNetwork = async (net: AvaNetwork, isFailover = false) => {
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
            // Fresh network — clear any RPC failover state from the old one.
            // (Not on failover switches: the dead-host list must survive.)
            if (!isFailover) resetRpcFailover()

            // Check if the network supports credentials
            await net.updateCredentials()
            ava.setRequestConfig('withCredentials', net.withCredentials)
            ava.setAddress(net.ip, net.port, net.protocol, net.basePath)
            ava.setNetworkID(net.networkId)

            // Clear old history
            historyStore.setRecentTransactions([])

            // Blockchain IDs for X/P/C. For the known public networks
            // (Mainnet/Fuji) these are compile-time constants — importantly,
            // the public backup RPC providers don't serve /ext/info at all,
            // so querying is not even an option there. Only custom networks
            // (local, subnets…) query the node.
            let chainIdX: string
            let chainIdP: string
            let chainIdC: string
            const knownNet = Defaults.network[net.networkId]
            if (knownNet && net.networkId in { 1: true, 5: true }) {
                chainIdX = knownNet.X.blockchainID
                chainIdP = knownNet.P.blockchainID
                chainIdC = knownNet.C.blockchainID
            } else {
                chainIdX = await infoApi.getBlockchainID('X')
                chainIdP = await infoApi.getBlockchainID('P')
                chainIdC = await infoApi.getBlockchainID('C')
            }

            avm.refreshBlockchainID(chainIdX)
            avm.setBlockchainAlias('X')
            pChain.refreshBlockchainID(chainIdP)
            pChain.setBlockchainAlias('P')
            cChain.refreshBlockchainID(chainIdC)
            cChain.setBlockchainAlias('C')

            // Fetch the AVAX asset descriptor once and share the ID with all
            // three chain APIs — it is the same asset on X, P and C.
            const avaxDesc = await avm.getAssetDescription('AVAX')
            avm.setAVAXAssetID(avaxDesc.assetID)
            pChain.setAVAXAssetID(avaxDesc.assetID)
            cChain.setAVAXAssetID(avaxDesc.assetID)

            selectedNetwork.value = net

            // Update explorer API base URL
            explorer_api.defaults.baseURL = net.explorerUrl

            // Set web3 provider to the C-chain RPC. Use the fetch-based
            // provider so web3 traffic goes through the global rate limiter
            // and 429 detection (web3's default HttpProvider uses XHR, which
            // bypasses both).
            const web3ProviderUrl = `${net.getFullURL()}/ext/bc/C/rpc`
            web3.setProvider(new FetchHttpProvider(web3ProviderUrl) as any)

            // Start REST polling for this network
            setCurrentNetwork(net)

            // Reset assets and register the AVAX asset from the descriptor
            // fetched above (no second network round-trip).
            assetsStore.removeAllAssets()
            await assetsStore.updateAvaAsset(avaxDesc)

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

            // Point the embedded SDK at the same network. For the built-in
            // Mainnet/Fuji networks the SDK ships hardcoded configs, so avoid
            // getConfigFromUrl which re-queries networkID, the three blockchain
            // IDs, the EVM chain ID and the AVAX asset ID over the network.
            try {
                const sdkNetConf =
                    net.networkId === 1
                        ? SdkMainnetConfig
                        : net.networkId === 5
                        ? SdkTestnetConfig
                        : await getConfigFromUrl(net.getFullURL())
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
        const net = selectedNetwork.value
        const knownNet = net ? Defaults.network[net.networkId] : undefined
        // Known networks (Mainnet/Fuji): compile-time constant, and the
        // public backup RPCs don't serve /ext/info anyway.
        if (knownNet && net && net.networkId in { 1: true, 5: true }) {
            txFee.value = knownNet.X.txFee
            avm.setTxFee(knownNet.X.txFee)
            return
        }
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

        // Register built-in networks.
        MAINNET_NETWORKS.forEach(addNetwork)
        TESTNET_NETWORKS.forEach(addNetwork)

        try {
            // Always start on Mainnet — the selected network is intentionally
            // not persisted, so every fresh load (and every origin) starts
            // from the same place. From here, RPC failover (see
            // src/providers/rpc_failover.ts) transparently falls back to the
            // other Mainnet endpoints in MAINNET_NETWORKS if the primary one
            // is unavailable.
            await setNetwork(networks.value[0])
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
        updateTxFee,
        save,
        load,
    }
})
