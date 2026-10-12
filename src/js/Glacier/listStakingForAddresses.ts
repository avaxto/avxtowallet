import { ava } from '@/AVA'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { isTestnetNetworkID } from '@/utils/network-utils'
import { ListStakingParams } from '@/js/Glacier/models'
import { mapGlacierBatches } from '@/js/Glacier/utils'
import { filterDuplicateGlacierTxs } from './filterDuplicateGlacierTxs'
import Glacier from './Glacier'
import { Network, PChainId, PChainTransaction, SortOrder } from '@avalabs/glacier-sdk'

export async function listStakingForAddresses(addrs: string[]) {
    if (!addrs.length) return []

    const netID = ava.getNetworkID()

    const network = isMainnetNetworkID(netID) ? Network.MAINNET : Network.FUJI

    // Cannot use glacier for other networks
    if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) return []


    async function fetchAll(config: ListStakingParams): Promise<PChainTransaction[]> {
        // const res = await GlacierService.listStaking(config)
        const res = await Glacier.primaryNetwork.listActivePrimaryNetworkStakingTransactions({
            ...config,
            addresses: config.addresses.join(','),
        })

        if (res.nextPageToken) {
            const next = await fetchAll({
                ...config,
                pageToken: res.nextPageToken,
            })
            return [...res.transactions, ...next]
        }
        return res.transactions ?? []
    }

    // 64 addresses per call (Glacier's maximum), two calls at a time.
    const results = (
        await mapGlacierBatches(addrs, (batch) =>
            fetchAll({
                addresses: batch,
                pageSize: 100,
                sortOrder: SortOrder.DESC,
                blockchainId: PChainId.P_CHAIN,
                network,
            })
        )
    ).flat()

    return filterDuplicateGlacierTxs(results) as PChainTransaction[]
}
