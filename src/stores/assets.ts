import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { BN } from 'avalanche'
import { AmountOutput, UTXOSet as AVMUTXOSet, UTXO, NFTMintOutput } from 'avalanche/dist/apis/avm'
import { UnixNow } from 'avalanche/dist/utils'
import { UTXOSet as PlatformUTXOSet } from 'avalanche/dist/apis/platformvm/utxos'
import { PlatformVMConstants, StakeableLockOut } from 'avalanche/dist/apis/platformvm'
import axios from 'axios'

import { ava, avm, bintools } from '@/AVA'
import { web3 } from '@/evm'
import AvaAsset from '@/js/AvaAsset'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import Erc20Token from '@/js/Erc20Token'
import { AvaNetwork } from '@/js/AvaNetwork'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { WalletType } from '@/js/wallets/types'
import { getPayloadFromUTXO } from '@/helpers/helper'
import { isUrlBanned } from '@/components/misc/NftPayloadView/blacklist'
import localTokenList from '@/ERC20Tokenlist.json'
import { useMainStore } from './main'

// Types (inline definitions to avoid circular imports)
export interface TokenListToken {
    address: string
    chainId: number
    name: string
    symbol: string
    decimals: number | string
    logoURI: string
}

export interface TokenList {
    name: string
    logoURI: string
    keywords: string[]
    timestamp: string
    url: string // added by frontend
    readonly: boolean // added by frontend
    version: {
        major: number
        minor: number
        patch: number
    }
    tokens: TokenListToken[]
}

export interface AddTokenListInput {
    url: string
    readonly: boolean
}

export interface AssetsDict {
    [key: string]: AvaAsset
}

export interface NftFamilyDict {
    [id: string]: AvaNftFamily
}

export interface IWalletAssetsDict {
    [assetId: string]: AvaAsset
}

export interface IWalletBalanceDict {
    [assetId: string]: {
        locked: BN
        available: BN
        multisig: BN
    }
}

export interface IWalletNftDict {
    [assetId: string]: UTXO[]
}

export interface IWalletNftMintDict {
    [assetId: string]: UTXO[]
}

const TOKEN_LISTS: string[] = []

// Fetch token list helper function
function mapTokenInfo(token: any) {
    return { ...token, logoURI: token.logoUri || token.logoURI }
}

async function fetchTokenList(): Promise<TokenList> {
    try {
        const res = await fetch(
            'https://raw.githubusercontent.com/ava-labs/avalanche-bridge-tokens/main/data/tokens.json'
        )
        
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`)
        }
        
        const json = await res.json()

        // Try to parse the new format (array with chainId)
        let tokensMainnet: any[] = []
        let tokensTestnet: any[] = []
        
        if (Array.isArray(json)) {
            tokensMainnet = json.filter((t: any) => t.chainId === 43114).map(mapTokenInfo)
            tokensTestnet = json.filter((t: any) => t.chainId === 43113).map(mapTokenInfo)
        } else if (json.tokens && Array.isArray(json.tokens)) {
            tokensMainnet = json.tokens.filter((t: any) => t.chainId === 43114).map(mapTokenInfo)
            tokensTestnet = json.tokens.filter((t: any) => t.chainId === 43113).map(mapTokenInfo)
        } else {
            // Fallback to local list
            console.warn('Unexpected token list format, using local fallback')
            return localTokenList as TokenList
        }

        return {
            name: 'Avalanche (C-Chain)',
            logoURI:
                'https://glacier-api.avax.network/proxy/chain-assets/3e1b653/chains/43113/token-logo.png',
            keywords: [],
            timestamp: '',
            url: '',
            readonly: true,
            version: {
                major: 1,
                minor: 0,
                patch: 0,
            },
            tokens: [...tokensMainnet, ...tokensTestnet],
        }
    } catch (error) {
        console.error('Failed to fetch token list from remote, using local fallback:', error)
        return localTokenList as TokenList
    }
}

export const useAssetsStore = defineStore('assets', () => {
    // State
    const AVA_ASSET_ID = ref<string | null>(null)
    const assets = ref<AvaAsset[]>([])
    const assetsDict = ref<AssetsDict>({})
    const nftFams = ref<AvaNftFamily[]>([])
    const nftFamsDict = ref<NftFamilyDict>({})
    const balanceDict = ref<IWalletBalanceDict>({})
    const nftUTXOs = ref<UTXO[]>([])
    const nftMintUTXOs = ref<UTXO[]>([])
    const erc20Tokens = ref<Erc20Token[]>([])
    const erc20TokensCustom = ref<Erc20Token[]>([])
    const evmChainId = ref<number>(0)
    const tokenLists = ref<TokenList[]>([])
    const tokenListUrls = ref<string[]>([])
    const tokenListsCustom = ref<string[]>([])
    const nftWhitelist = ref<string[]>([])

    // Actions
    const addAsset = (asset: AvaAsset) => {
        if (assetsDict.value[asset.id]) {
            return
        }
        assets.value.push(asset)
        assetsDict.value[asset.id] = asset
    }

    const addNftFamily = (family: AvaNftFamily) => {
        if (nftFamsDict.value[family.id]) {
            return
        }
        nftFams.value.push(family)
        nftFamsDict.value[family.id] = family
    }

    const removeAllAssets = () => {
        assets.value = []
        assetsDict.value = {}
        nftFams.value = []
        nftFamsDict.value = {}
        nftUTXOs.value = []
        nftMintUTXOs.value = []
        balanceDict.value = {}
        AVA_ASSET_ID.value = null
    }

    const saveCustomErc20Tokens = () => {
        const tokens: Erc20Token[] = erc20TokensCustom.value
        const tokenRawData: TokenListToken[] = tokens.map((token) => {
            return token.data
        })
        localStorage.setItem('erc20_tokens', JSON.stringify(tokenRawData))
    }

    const loadCustomErc20Tokens = () => {
        const tokensRaw = localStorage.getItem('erc20_tokens') || '[]'
        const tokens: TokenListToken[] = JSON.parse(tokensRaw)
        for (let i = 0; i < tokens.length; i++) {
            erc20TokensCustom.value.push(new Erc20Token(tokens[i]))
        }
    }

    const saveCustomTokenLists = () => {
        const lists = JSON.stringify(tokenListsCustom.value)
        localStorage.setItem('token_lists', lists)
    }

    const whitelistNFT = (id: string) => {
        nftWhitelist.value.push(id)
    }

    const onNetworkChange = async (network: AvaNetwork) => {
        const id = await web3.eth.getChainId()
        evmChainId.value = id
    }

    const onLogout = () => {
        removeAllAssets()
    }

    const onUtxosUpdated = async () => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any

        if (!wallet) return

        if (wallet.isFetchUtxos) {
            setTimeout(() => {
                onUtxosUpdated()
            }, 500)
            return
        }

        await updateBalanceDict()
        await updateUtxoArrays()
        await addUnknownAssets()
    }

    const updateUtxoArrays = () => {
        const utxoSet = walletAvmUtxoSet.value
        if (utxoSet === null) return {}

        const utxos = utxoSet.getAllUTXOs()

        let nftUtxos = []
        const nftMintUtxos = []

        for (let n = 0; n < utxos.length; n++) {
            const utxo = utxos[n]
            const outId = utxo.getOutput().getOutputID()

            if (outId === 11) {
                nftUtxos.push(utxo)
            } else if (outId === 10) {
                nftMintUtxos.push(utxo)
            }
        }

        // Filter NFT utxos
        nftUtxos = nftUtxos.filter((utxo) => {
            const payload = getPayloadFromUTXO(utxo)
            const content = payload.getContent().toString()
            return !isUrlBanned(content)
        })

        nftUTXOs.value = nftUtxos
        nftMintUTXOs.value = nftMintUtxos
    }

    const addErc20Token = async (token: TokenListToken) => {
        const tokens: Erc20Token[] = erc20TokensCustom.value.concat(erc20Tokens.value)

        // Make sure its not added before
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]
            if (token.address === t.data.address && token.chainId === t.data.chainId) {
                console.log('ERC20 Token already added.')
                return
            }
        }

        const t = new Erc20Token(token)
        erc20Tokens.value.push(t)
    }

    const addCustomErc20Token = async (token: TokenListToken) => {
        const mainStore = useMainStore()
        const tokens: Erc20Token[] = erc20TokensCustom.value.concat(erc20Tokens.value)

        // Make sure its not added before
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i]
            if (token.address === t.data.address && token.chainId === t.data.chainId) {
                console.log('ERC20 Token already added.')
                return
            }
        }

        const t = new Erc20Token(token)
        // Save token state to storage
        erc20TokensCustom.value.push(t)

        const w = mainStore.activeWallet
        if (w) {
            t.updateBalance(w.ethAddress)
        }

        saveCustomErc20Tokens()
        return t
    }

    const removeTokenList = async (list: TokenList) => {
        // Remove token list object
        for (let i = 0; i <= tokenLists.value.length; i++) {
            const l = tokenLists.value[i]

            if (l.url === list.url) {
                tokenLists.value.splice(i, 1)
                break
            }
        }

        // Remove custom Token list urls
        const index = tokenListsCustom.value.indexOf(list.url)
        tokenListsCustom.value.splice(index, 1)

        // Update local storage
        saveCustomTokenLists()
    }

    const addTokenListUrl = async (data: AddTokenListInput) => {
        // Make sure URL is not already added
        if (tokenListUrls.value.includes(data.url)) throw 'Already added.'
        if (tokenListsCustom.value.includes(data.url)) throw 'Already added.'

        const url = data.url
        const res = await axios.get(url)
        const tokenListData: TokenList = res.data
        tokenListData.url = url
        tokenListData.readonly = data.readonly

        await addTokenList(tokenListData)
    }

    const addTokenList = async (tokenList: TokenList) => {
        const tokens: TokenListToken[] = tokenList.tokens
        tokenLists.value.push(tokenList)
        
        for (let i = 0; i < tokens.length; i++) {
            await addErc20Token(tokens[i])
        }

        if (!tokenList.readonly) {
            tokenListsCustom.value.push(tokenList.url)
            saveCustomTokenLists()
        } else {
            tokenListUrls.value.push(tokenList.url)
        }
    }

    const loadCustomTokenLists = () => {
        const listRaw = localStorage.getItem('token_lists')
        if (!listRaw) return
        const urls: string[] = JSON.parse(listRaw)

        urls.forEach((url) => {
            addTokenListUrl({
                url: url,
                readonly: false,
            })
        })
    }

    const initErc20List = async () => {
        // Load default erc20 token contracts
        const erc20TokensData = await fetchTokenList()
        erc20TokensData.readonly = true
        erc20TokensData.url = 'Default'
        await addTokenList(erc20TokensData)

        for (let i = 0; i < TOKEN_LISTS.length; i++) {
            await addTokenListUrl({
                url: TOKEN_LISTS[i],
                readonly: true,
            })
        }

        loadCustomTokenLists()
        loadCustomErc20Tokens()
    }

    const addUnknownAssets = () => {
        const balanceDictValue: IWalletBalanceDict = balanceDict.value
        const nftDictValue: IWalletNftDict = walletNftDict.value
        const nftMintDictValue: IWalletNftMintDict = nftMintDict.value

        for (const id in balanceDictValue) {
            if (!assetsDict.value[id]) {
                addUnknownAsset(id)
            }
        }

        for (const nft_id in nftDictValue) {
            if (!nftFamsDict.value[nft_id]) {
                addUnknownNftFamily(nft_id)
            }
        }

        for (const familyId in nftMintDictValue) {
            if (!nftFamsDict.value[familyId]) {
                addUnknownNftFamily(familyId)
            }
        }
    }

    const updateUTXOs = async () => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet
        if (!wallet) {
            return false
        }

        await wallet.getUTXOs()
        await onUtxosUpdated()
        await updateERC20Balances()
        // dispatch('ERC721/updateWalletBalance') - TODO: implement ERC721 module
        // commit('updateActiveAddress', null, { root: true }) - handled by main store
    }

    const updateUTXOsExternal = async () => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet
        if (!wallet) {
            return false
        }

        if (wallet.type === 'ledger' || wallet.type === 'mnemonic') {
            await (wallet as MnemonicWallet | LedgerWallet).updateUTXOsExternal()
        } else {
            await wallet.updateUTXOsX()
        }

        await onUtxosUpdated()
        // commit('updateActiveAddress', null, { root: true }) - handled by main store
    }

    const updateERC20Balances = async () => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        if (!wallet) return
        // Old ledger wallets do not have an eth address
        if (!wallet.ethAddress) return

        const networkID = evmChainId.value
        const tokens: Erc20Token[] = networkErc20Tokens.value
        tokens.forEach((token) => {
            if (token.data.chainId !== networkID) return
            token.updateBalance(wallet!.ethAddress)
        })
    }

    const updateAvaAsset = async () => {
        const res = await avm.getAssetDescription('AVAX')
        const id = bintools.cb58Encode(res.assetID)
        AVA_ASSET_ID.value = id
        const asset = new AvaAsset(id, res.name, res.symbol, res.denomination)
        addAsset(asset)
    }

    const updateBalanceDict = (): IWalletBalanceDict => {
        const utxoSet = walletAvmUtxoSet.value
        if (utxoSet === null) return {}

        const dict: IWalletBalanceDict = {}
        const unixNow = UnixNow()
        const ZERO = new BN(0)
        const addrUtxos = utxoSet.getAllUTXOs()

        for (let n = 0; n < addrUtxos.length; n++) {
            const utxo = addrUtxos[n]

            // Process only SECP256K1 Transfer Output utxos, outputid === 07
            const outId = utxo.getOutput().getOutputID()
            if (outId !== 7) continue

            const utxoOut = utxo.getOutput() as AmountOutput
            const locktime = utxoOut.getLocktime()
            const threshold = utxoOut.getThreshold()
            const amount = utxoOut.getAmount()
            const assetIdBuff = utxo.getAssetID()
            const assetId = bintools.cb58Encode(assetIdBuff)

            // Which category should the utxo fall under
            const isMultisig = threshold > 1
            const isLocked = locktime.gt(unixNow)

            if (isMultisig) {
                if (!dict[assetId]) {
                    dict[assetId] = {
                        locked: ZERO.clone(),
                        available: ZERO.clone(),
                        multisig: amount.clone(),
                    }
                } else {
                    const amt = dict[assetId].multisig
                    dict[assetId].multisig = amt.add(amount)
                }
            } else if (!isLocked) {
                if (!dict[assetId]) {
                    dict[assetId] = {
                        locked: ZERO.clone(),
                        available: amount.clone(),
                        multisig: ZERO.clone(),
                    }
                } else {
                    const amt = dict[assetId].available
                    dict[assetId].available = amt.add(amount)
                }
            } else {
                if (!dict[assetId]) {
                    dict[assetId] = {
                        locked: amount.clone(),
                        available: ZERO.clone(),
                        multisig: ZERO.clone(),
                    }
                } else {
                    const amt = dict[assetId].locked
                    dict[assetId].locked = amt.add(amount)
                }
            }
        }

        balanceDict.value = dict
        return dict
    }

    const addUnknownAsset = async (assetId: string) => {
        const desc = await ava.XChain().getAssetDescription(assetId)
        const newAsset = new AvaAsset(assetId, desc.name, desc.symbol, desc.denomination)
        addAsset(newAsset)
        return desc
    }

    const addUnknownNftFamily = async (assetId: string) => {
        const desc = await ava.XChain().getAssetDescription(assetId)
        const newFam = new AvaNftFamily(assetId, desc.name, desc.symbol)
        addNftFamily(newFam)
        return desc
    }

    // Getters
    const networkErc20Tokens = computed((): Erc20Token[] => {
        const tokens = erc20Tokens.value.concat(erc20TokensCustom.value)
        const chainId = evmChainId.value

        return tokens.filter((t) => {
            return t.data.chainId === chainId
        })
    })

    const findErc20 = computed(() => {
        return (contractAddr: string) => {
            const tokens: Erc20Token[] = erc20Tokens.value.concat(erc20TokensCustom.value)
            for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i]
                if (t.data.address === contractAddr) {
                    return t
                }
            }
            return null
        }
    })

    const walletNftDict = computed((): IWalletNftDict => {
        const utxos = nftUTXOs.value
        const res: IWalletNftDict = {}

        for (let i = 0; i < utxos.length; i++) {
            const utxo = utxos[i] as any
            const assetIdBuff = utxo.getAssetID()
            const assetId = bintools.cb58Encode(assetIdBuff)

            if (res[assetId]) {
                res[assetId].push(utxo)
            } else {
                res[assetId] = [utxo]
            }
        }
        return res
    })

    const walletAssetsDict = computed((): IWalletAssetsDict => {
        const balanceDictValue: IWalletBalanceDict = balanceDict.value
        const assetsDictValue: AssetsDict = assetsDict.value
        const res: IWalletAssetsDict = {}

        for (const assetId in assetsDictValue) {
            const balanceAmt = balanceDictValue[assetId]

            let asset: AvaAsset
            if (!balanceAmt) {
                asset = assetsDictValue[assetId]
                asset.resetBalance()
            } else {
                asset = assetsDictValue[assetId]
                asset.resetBalance()
                asset.addBalance(balanceAmt.available)
                asset.addBalanceLocked(balanceAmt.locked)
                asset.addBalanceMultisig(balanceAmt.multisig)
            }

            // Add extras for AVAX token
            if (asset.id === AVA_ASSET_ID.value) {
                asset.addExtra(walletStakingBalance.value)
                asset.addExtra(walletPlatformBalance.value.available)
                asset.addExtra(walletPlatformBalance.value.locked)
                asset.addExtra(walletPlatformBalance.value.lockedStakeable)
                asset.addExtra(walletPlatformBalance.value.multisig)
            }

            res[assetId] = asset
        }
        return res
    })

    const walletAssetsArray = computed((): AvaAsset[] => {
        const assetsDictValue: IWalletAssetsDict = walletAssetsDict.value
        const res: AvaAsset[] = []

        for (const id in assetsDictValue) {
            const asset = assetsDictValue[id]
            res.push(asset)
        }
        return res
    })

    const walletAvmUtxoSet = computed((): AVMUTXOSet | null => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        if (!wallet) return null
        return wallet.utxoset as any
    })

    const nftFamilies = computed((): AvaNftFamily[] => {
        return nftFams.value
    })

    const walletStakingBalance = computed((): BN => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        if (!wallet) return new BN(0)
        return wallet.stakeAmount || new BN(0)
    })

    const walletPlatformBalance = computed(() => {
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        const balances = {
            available: new BN(0),
            locked: new BN(0),
            lockedStakeable: new BN(0),
            multisig: new BN(0),
        }

        if (!wallet || !AVA_ASSET_ID.value || !wallet.getPlatformUTXOSet) return balances

        try {
            const utxoSet: PlatformUTXOSet = wallet.getPlatformUTXOSet() as any
            const now = UnixNow()
            const utxos = utxoSet.getAllUTXOs()
            
            // Only use AVAX UTXOs
            const avaxID = bintools.cb58Decode(AVA_ASSET_ID.value)
            const avaxUTXOs = utxos.filter((utxo: any) => utxo.getAssetID().equals(avaxID))

            for (let n = 0; n < avaxUTXOs.length; n++) {
                const utxo = avaxUTXOs[n] as any
                const utxoOut = utxo.getOutput()
                const outId = utxoOut.getOutputID()
                const threshold = utxoOut.getThreshold()

                // If its multisig utxo
                if (threshold > 1) {
                    balances.multisig.iadd((utxoOut as AmountOutput).getAmount())
                    continue
                }

                const isStakeableLock = outId === PlatformVMConstants.STAKEABLELOCKOUTID

                let locktime
                if (isStakeableLock) {
                    locktime = (utxoOut as StakeableLockOut).getStakeableLocktime()
                } else {
                    locktime = (utxoOut as AmountOutput).getLocktime()
                }

                // If normal unlocked utxo (includes stakeable lock that is in the past)
                if (locktime.lte(now)) {
                    balances.available.iadd((utxoOut as AmountOutput).getAmount())
                }
                // If locked utxo
                else if (!isStakeableLock) {
                    balances.locked.iadd((utxoOut as AmountOutput).getAmount())
                }
                // If stakeable lock utxo
                else if (isStakeableLock) {
                    balances.lockedStakeable.iadd((utxoOut as AmountOutput).getAmount())
                }
            }
        } catch (error) {
            console.warn('Error calculating platform balance:', error)
        }

        return balances
    })

    const walletPlatformBalanceLocked = computed((): BN => {
        return walletPlatformBalance.value.locked
    })

    const walletPlatformBalanceLockedStakeable = computed((): BN => {
        return walletPlatformBalance.value.lockedStakeable
    })

    const nftMintDict = computed((): IWalletNftMintDict => {
        const res: IWalletNftMintDict = {}
        const mintUTXOs = nftMintUTXOs.value

        for (let i = 0; i < mintUTXOs.length; i++) {
            const utxo = mintUTXOs[i] as any
            const assetId = bintools.cb58Encode(utxo.getAssetID())

            const target = res[assetId]
            if (target) {
                target.push(utxo)
            } else {
                res[assetId] = [utxo]
            }
        }

        // sort by groupID
        for (const id in res) {
            res[id].sort((a: any, b: any) => {
                const idA = (a.getOutput() as NFTMintOutput).getGroupID()
                const idB = (b.getOutput() as NFTMintOutput).getGroupID()
                return idA - idB
            })
        }
        return res
    })

    const assetIds = computed((): string[] => {
        return assets.value.map((asset) => {
            return asset.id
        })
    })

    const AssetAVA = computed((): AvaAsset | null => {
        const walletBalanceDict = walletAssetsDict.value
        const AVA_ASSET_ID_VALUE = AVA_ASSET_ID.value
        if (AVA_ASSET_ID_VALUE) {
            if (walletBalanceDict[AVA_ASSET_ID_VALUE]) {
                return walletBalanceDict[AVA_ASSET_ID_VALUE]
            }
        }
        return null
    })

    return {
        // State
        AVA_ASSET_ID,
        assets,
        assetsDict,
        nftFams,
        nftFamsDict,
        balanceDict,
        nftUTXOs,
        nftMintUTXOs,
        erc20Tokens,
        erc20TokensCustom,
        evmChainId,
        tokenLists,
        tokenListUrls,
        tokenListsCustom,
        nftWhitelist,

        // Actions
        addAsset,
        addNftFamily,
        removeAllAssets,
        saveCustomErc20Tokens,
        loadCustomErc20Tokens,
        saveCustomTokenLists,
        whitelistNFT,
        onNetworkChange,
        onLogout,
        onUtxosUpdated,
        updateUtxoArrays,
        addErc20Token,
        addCustomErc20Token,
        removeTokenList,
        addTokenListUrl,
        addTokenList,
        loadCustomTokenLists,
        initErc20List,
        addUnknownAssets,
        updateUTXOs,
        updateUTXOsExternal,
        updateERC20Balances,
        updateAvaAsset,
        updateBalanceDict,
        addUnknownAsset,
        addUnknownNftFamily,

        // Getters
        networkErc20Tokens,
        findErc20,
        walletNftDict,
        walletAssetsDict,
        walletAssetsArray,
        walletAvmUtxoSet,
        nftFamilies,
        walletStakingBalance,
        walletPlatformBalance,
        walletPlatformBalanceLocked,
        walletPlatformBalanceLockedStakeable,
        nftMintDict,
        assetIds,
        AssetAVA,
    }
})