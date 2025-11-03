import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { AvaNetwork } from '@/js/AvaNetwork'
import { BN } from '@/avalanche'

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
    const init = async () => {
        
                
        // Create default networks
        const mainnet = new AvaNetwork(
            'Mainnet',
            'https://api.avax.network:443',
            1, // Network ID for mainnet
            'https://avascan.info/blockchain/c/address',
            'https://avascan.info'
        )
        
        const fuji = new AvaNetwork(
            'Fuji',
            'https://api.avax-test.network:443',
            5, // Network ID for fuji testnet
            'https://testnet.avascan.info/blockchain/c/address',
            'https://testnet.avascan.info'
        )
        
        networks.value = [mainnet, fuji]
        
        // Load custom networks from localStorage
        load()
        
        // Try to load the selected network from localStorage
        const loaded = await loadSelectedNetwork()
        if (!loaded) {
            // If no network was saved, default to mainnet
            selectedNetwork.value = mainnet
            saveSelectedNetwork()
        }
        
        return selectedNetwork.value
    }
    
    const setNetwork = async (net: AvaNetwork) => {
        selectedNetwork.value = net
        saveSelectedNetwork()
        status.value = 'connecting'
        
        // TODO: Add actual network connection logic here
        // For now, just set status to connected
        status.value = 'connected'
        
        return true
    }
    
    const addNetwork = (net: AvaNetwork) => {
        networks.value.push(net)
    }
    
    const addCustomNetwork = (net: AvaNetwork) => {
        // Check if network already exists
        const customNets = networksCustom.value
        // Do not add if there is a network already with the same url
        for (let i = 0; i < customNets.length; i++) {
            const url = customNets[i].url
            if (net.url === url) {
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
                    selectedNetwork.value = net
                    return true
                }
            }
            return false
        } catch (e) {
            return false
        }
    }
    
    // Save custom networks to local storage
    const save = () => {
        const data = JSON.stringify(networksCustom.value)
        localStorage.setItem('networks', data)
    }
    
    // Load custom networks from local storage
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
        save,
        load,
    }
})
