/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { BlockchainId, Network, SortOrder } from '@avalabs/glacier-sdk'
import { ava } from '@/AVA'
import { isMainnetNetworkID, isTestnetNetworkID } from '@/utils/network-utils'
import { extractPastDelegations, type PastDelegation } from '@/js/restake'
import { getTransactionsForAddresses } from './getTransactionsForAddresses'
import { cleanAddrs } from './utils'

/**
 * How many of the most recent P-chain transactions to look through. Glacier's
 * type filter would be the obvious shortcut, but on an address query it times
 * out, so the history is read in full pages and filtered here instead.
 */
export const DELEGATION_SCAN_LIMIT = 2000

/**
 * Every past delegation made from `pAddresses` (this wallet's used P-chain
 * addresses, "P-" prefixed or not), newest first. Mainnet and Fuji only —
 * Glacier indexes nothing else.
 */
export async function listDelegationsForAddresses(pAddresses: string[]): Promise<PastDelegation[]> {
    if (!pAddresses.length) return []

    const netID = ava.getNetworkID()
    if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) return []

    const txs = await getTransactionsForAddresses(
        {
            addresses: cleanAddrs(pAddresses),
            blockchainId: BlockchainId.P_CHAIN,
            network: isMainnetNetworkID(netID) ? Network.MAINNET : Network.FUJI,
            sortOrder: SortOrder.DESC,
            pageSize: 100,
        },
        DELEGATION_SCAN_LIMIT
    )
    return extractPastDelegations(txs as any[], pAddresses)
}
