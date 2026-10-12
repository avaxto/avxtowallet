import { ava } from '@/AVA'
import { mapGlacierBatches } from '@/js/Glacier/utils'
import Glacier from '@/js/Glacier/Glacier'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { isTestnetNetworkID } from '@/utils/network-utils'
import { Network } from '@avalabs/glacier-sdk'

export async function listChainsForAddresses(addrs: string[]) {
    const netID = ava.getNetworkID()

    // Cannot use glacier for other networks
    if (!isMainnetNetworkID(netID) && !isTestnetNetworkID(netID)) return []
    const network = isMainnetNetworkID(netID) ? Network.MAINNET : Network.FUJI

    // 64 addresses per call (Glacier's maximum), two calls at a time.
    const results = await mapGlacierBatches(addrs, (addresses) =>
        Glacier.primaryNetwork.getChainAddresses({ addresses: addresses.join(','), network })
    )
    const flat = results.map((res) => res.addresses).flat()

    return flat
}
