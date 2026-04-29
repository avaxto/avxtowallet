import { defineStore } from 'pinia'
import { ref } from 'vue'
import { GetTransactionsParams, TransactionType, EvmTransactionDetails } from '@/js/Glacier/models'
import { getTransactionsForAddresses } from '@/js/Glacier/getTransactionsForAddresses'
import { ava } from '@/AVA'
import { isMainnetNetworkID, isTestnetNetworkID } from '@/utils/network-utils'
import { BlockchainId, Network, SortOrder } from '@avalabs/glacier-sdk'
import { cleanAddrs } from '@/js/Glacier/utils'
import { Avalanche as ChainKitAvalanche } from '@avalanche-sdk/chainkit'

const TX_LIMIT = 500

export const useHistoryStore = defineStore('history', () => {
    // State
    const isUpdating = ref<boolean>(false)
    const isUpdatingAll = ref<boolean>(false)
    const isError = ref<boolean>(false)
    const recentTransactions = ref<TransactionType[]>([])
    const allTransactions = ref<TransactionType[]>([])

    // Actions
    const updateTransactionHistory = () => {
        updateAllTransactionHistory()
    }

    const setIsUpdating = (value: boolean) => {
        isUpdating.value = value
    }

    const setRecentTransactions = (transactions: TransactionType[]) => {
        recentTransactions.value = transactions
    }

    const updateAllTransactionHistory = async () => {
        const netID = ava.getNetworkID()
        if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) {
            allTransactions.value = []
            return
        }

        const network = isMainnetNetworkID(netID) ? Network.MAINNET : Network.FUJI

        // Lazy-import to avoid circular dependency at module load time
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useMainStore } = await import('@/stores/main')
        const mainStore = useMainStore()
        const wallet = mainStore.activeWallet as any
        if (!wallet) return

        isUpdatingAll.value = true
        isError.value = false

        try {
            const xAddrs = cleanAddrs(wallet.getAllAddressesX?.() ?? [])
            const pAddrs = cleanAddrs(wallet.getAllAddressesP?.() ?? [])
            // C-chain atomic transactions (import/export) are indexed by bech32 C-chain address,
            // not the 0x EVM address. Use getEvmAddressBech() which returns "C-avax1..." and
            // strip the chain prefix with cleanAddrs so the API gets "avax1...".
            const cBech: string = wallet.getEvmAddressBech?.() ?? ''
            const cAddrs = cBech ? cleanAddrs([cBech]) : []

            const chains: { blockchainId: BlockchainId; addresses: string[] }[] = []
            if (xAddrs.length) chains.push({ blockchainId: BlockchainId.X_CHAIN, addresses: xAddrs })
            if (pAddrs.length) chains.push({ blockchainId: BlockchainId.P_CHAIN, addresses: pAddrs })
            if (cAddrs.length) chains.push({ blockchainId: BlockchainId.C_CHAIN, addresses: cAddrs })

            const results = await Promise.all(
                chains.map(({ blockchainId, addresses }) => {
                    const params: GetTransactionsParams = {
                        addresses,
                        blockchainId,
                        network,
                        sortOrder: SortOrder.DESC,
                    }
                    return getTransactionsForAddresses(params, TX_LIMIT)
                })
            )

            // Fetch full EVM transactions (token transfers, contract calls, etc.)
            // via @avalanche-sdk/chainkit which indexes the full C-chain EVM history.
            const evmTxs: EvmTransactionDetails[] = []
            const evmHexAddress: string | undefined = wallet.ethAddress
                ? `0x${wallet.ethAddress}`
                : wallet.getEvmAddress?.()
                ? `0x${wallet.getEvmAddress()}`
                : undefined

            if (evmHexAddress) {
                try {
                    const chainkitChainId = isMainnetNetworkID(netID) ? '43114' : '43113'
                    const chainkit = new ChainKitAvalanche({ chainId: chainkitChainId })
                    const pages = await chainkit.data.evm.address.transactions.list({
                        address: evmHexAddress,
                        sortOrder: 'desc',
                        pageSize: 100,
                    })
                    for await (const page of pages) {
                        for (const tx of page.result.transactions) {
                            evmTxs.push({
                                txHash: tx.nativeTransaction.txHash,
                                blockTimestamp: tx.nativeTransaction.blockTimestamp,
                                txType: 'EVMTx',
                                nativeTransaction: tx.nativeTransaction as EvmTransactionDetails['nativeTransaction'],
                                erc20Transfers: tx.erc20Transfers as EvmTransactionDetails['erc20Transfers'],
                            })
                            if (evmTxs.length >= TX_LIMIT) break
                        }
                        if (evmTxs.length >= TX_LIMIT) break
                    }
                } catch (e) {
                    console.warn('Failed to fetch EVM transactions via chainkit:', e)
                }
            }

            const merged = ([] as TransactionType[]).concat(...results, evmTxs)
            merged.sort((a, b) => {
                const tA = (a as any).timestamp ?? (a as any).blockTimestamp ?? 0
                const tB = (b as any).timestamp ?? (b as any).blockTimestamp ?? 0
                return tB - tA
            })
            allTransactions.value = merged
        } catch (e) {
            console.error('Failed to fetch transaction history:', e)
            isError.value = true
        } finally {
            isUpdatingAll.value = false
        }
    }

    return {
        // State
        isUpdating,
        isUpdatingAll,
        isError,
        recentTransactions,
        allTransactions,

        // Actions
        updateTransactionHistory,
        updateAllTransactionHistory,
        setIsUpdating,
        setRecentTransactions,
    }
})