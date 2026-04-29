import { isTransactionP, isTransactionX, isTransactionC, isEvmTransaction, TransactionType } from '@/js/Glacier/models'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { isTestnetNetworkID } from '@/utils/network-utils'
import { getTxURL } from '@/js/Glacier/getTxURL'

/**
 * Given a glacier transaction, returns its URL on the explorer.
 * @param netID The network ID transaction is made on
 * @param transaction Transaction data from glacier
 */
export function getUrlFromTransaction(netID: number, transaction: TransactionType) {
    const isMainnet = isMainnetNetworkID(netID)
    const isFuji = isTestnetNetworkID(netID)

    if (!isMainnet && !isFuji) return null

    // Full EVM transactions from chainkit — link to C-chain explorer
    if (isEvmTransaction(transaction)) {
        return getTxURL(transaction.txHash, 'C', isMainnet)
    }

    // C-chain atomic (import/export) also have blockTimestamp so must be checked before isTransactionP
    if (isTransactionC(transaction)) {
        return getTxURL(transaction.txHash, 'C', isMainnet)
    }

    const isX = isTransactionX(transaction)
    const isP = isTransactionP(transaction)

    const chainId = isX ? 'X' : isP ? 'P' : 'C'
    return getTxURL(transaction.txHash, chainId, isMainnet)
}
