import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import ERC721Token from '@/js/ERC721Token'
import ERC721_TOKEN_LIST from '@/ERC721Tokenlist.json'
import { useMainStore } from './main'
import { useAssetsStore } from './assets'

// Types
export interface ERC721TokenInput {
    address: string
    chainId: number
    name: string
    symbol: string
    logoURI?: string
}

export interface ERC721WalletBalance {
    [contractAddress: string]: string[]
}

export const useErc721Store = defineStore('erc721', () => {
    // State
    const erc721Tokens = ref<ERC721Token[]>([])
    const erc721TokensCustom = ref<ERC721Token[]>([])
    const walletBalance = ref<ERC721WalletBalance>({})

    // Actions
    const clear = () => {
        walletBalance.value = {}
    }

    const saveCustomContracts = () => {
        const tokens = erc721TokensCustom.value
        const tokenRawData = tokens.map((token) => {
            return token.data
        })
        localStorage.setItem('erc721_tokens', JSON.stringify(tokenRawData))
    }

    const loadCustomContracts = () => {
        const tokensRaw = localStorage.getItem('erc721_tokens') || '[]'
        const tokens: any[] = JSON.parse(tokensRaw)
        for (let i = 0; i < tokens.length; i++) {
            erc721TokensCustom.value.push(new ERC721Token(tokens[i]))
        }
    }

    const removeCustom = (data: ERC721Token) => {
        const index = erc721TokensCustom.value.indexOf(data)
        erc721TokensCustom.value.splice(index, 1)
        delete walletBalance.value[data.contractAddress]
        saveCustomContracts()
    }

    const addCustom = async (data: ERC721TokenInput) => {
        const tokens = erc721Tokens.value.concat(erc721TokensCustom.value)

        // Make sure its not added before
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]
            if (data.address === t.data.address && data.chainId === t.data.chainId) {
                //console.log('ERC721 Token already added.')
                return
            }
        }

        const t = new ERC721Token(data)
        erc721TokensCustom.value.push(t)

        saveCustomContracts()
        setTimeout(() => {
            updateWalletBalance()
        }, 500)
        return t
    }

    const init = () => {
        // Load default erc721 token contracts
        const erc721TokensList = (ERC721_TOKEN_LIST as any).tokens
        for (let i = 0; i < erc721TokensList.length; i++) {
            erc721Tokens.value.push(new ERC721Token(erc721TokensList[i]))
        }
        loadCustomContracts()
    }

    const updateWalletBalance = () => {
        const mainStore = useMainStore()
        const w = mainStore.activeWallet
        if (!w) return

        const walletAddr = '0x' + w.getEvmAddress()

        // Loop through contracts and update wallet balance object
        const contracts: ERC721Token[] = networkContracts.value
        for (let i = 0; i < contracts.length; i++) {
            const erc721 = contracts[i]
            erc721
                .getAllTokensIds(walletAddr)
                .then((tokenIds: string[]) => {
                    walletBalance.value[erc721.contractAddress] = tokenIds
                })
                .catch((err) => {
                    console.error(err)
                })
        }
    }

    // Getters
    const networkContracts = computed((): ERC721Token[] => {
        const assetsStore = useAssetsStore()
        const tokens = erc721Tokens.value.concat(erc721TokensCustom.value)
        const chainId = assetsStore.evmChainId
        const filt = tokens.filter((t) => {
            if (t.data.chainId !== chainId) return false
            return true
        })
        return filt
    })

    const networkContractsCustom = computed((): ERC721Token[] => {
        const contracts: ERC721Token[] = networkContracts.value
        return contracts.filter((c) => {
            return erc721TokensCustom.value.includes(c)
        })
    })

    const totalOwned = computed(() => {
        const bal = walletBalance.value
        let tot = 0
        for (const contractAddress in bal) {
            const len = bal[contractAddress].length
            tot += len
        }
        return tot
    })

    const totalCollectionsOwned = computed(() => {
        const bal = walletBalance.value
        let tot = 0
        for (const contractAddress in bal) {
            const len = bal[contractAddress].length
            if (len > 0) tot++
        }
        return tot
    })

    const find = computed(() => {
        return (contractAddr: string) => {
            const tokens: ERC721Token[] = networkContracts.value
            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i]
                if (t.data.address === contractAddr) {
                    return t
                }
            }
            return null
        }
    })

    return {
        // State
        erc721Tokens,
        erc721TokensCustom,
        walletBalance,

        // Actions
        clear,
        saveCustomContracts,
        loadCustomContracts,
        removeCustom,
        addCustom,
        init,
        updateWalletBalance,

        // Getters
        networkContracts,
        networkContractsCustom,
        totalOwned,
        totalCollectionsOwned,
        find,
    }
})