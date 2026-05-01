import { UTXOSet as AVMUTXOSet } from '@/avalanche/apis/avm/utxos'
import { UTXOSet as PlatformUTXOSet } from '@/avalanche/apis/platformvm/utxos'
import { avm, pChain } from '@/AVA'
import { BN } from '@/avalanche'

export async function getStakeForAddresses(addrs: string[]): Promise<BN> {
    if (addrs.length <= 256) {
        const stakeData = await pChain.getStake(addrs)
        return stakeData.staked
    } else {
        //Break the list in to 1024 chunks
        const chunk = addrs.slice(0, 256)
        const remainingChunk = addrs.slice(256)

        const stakeData = await pChain.getStake(chunk)
        const chunkStake = stakeData.staked
        return chunkStake.add(await getStakeForAddresses(remainingChunk))
    }
}

export async function avmGetAllUTXOs(addrs: string[]): Promise<AVMUTXOSet> {
    if (addrs.length <= 1024) {
        const utxos = await avmGetAllUTXOsForAddresses(addrs)
        console.log(`Fetched ONESET ${utxos.getAllUTXOs().length} UTXOs for ${addrs.length} addresses`)
        return utxos
    } else {
        //Break the list in to 1024 chunks
        const chunk = addrs.slice(0, 1024)
        const remainingChunk = addrs.slice(1024)

        const newSet = await avmGetAllUTXOsForAddresses(chunk)
        const retSet = newSet.merge(await avmGetAllUTXOs(remainingChunk))
        console.log(`Fetched RETSET ${retSet.getAllUTXOs().length} UTXOs for ${addrs.length} addresses`)
        return retSet
    }
}

export async function avmGetAllUTXOsForAddresses(
    addrs: string[],
    endIndex: any = undefined
): Promise<AVMUTXOSet> {
    if (addrs.length > 1024) throw new Error('Maximum length of addresses is 1024')
    let response
    if (!endIndex) {
        response = await avm.getUTXOs(addrs)
    } else {
        response = await avm.getUTXOs(addrs, undefined, 0, endIndex)
    }

    const utxoSet = response.utxos
    const utxos = utxoSet.getAllUTXOs()
    const nextEndIndex = response.endIndex
    const len = response.numFetched

    if (len >= 1024) {
        const subUtxos = await avmGetAllUTXOsForAddresses(addrs, nextEndIndex)
        return utxoSet.merge(subUtxos)
    }
    return utxoSet
}

// helper method to get utxos for more than 1024 addresses
export async function platformGetAllUTXOs(addrs: string[]): Promise<PlatformUTXOSet> {
    if (addrs.length <= 1024) {
        const newSet = await platformGetAllUTXOsForAddresses(addrs)
        return newSet
    } else {
        //Break the list in to 1024 chunks
        const chunk = addrs.slice(0, 1024)
        const remainingChunk = addrs.slice(1024)

        const newSet = await platformGetAllUTXOsForAddresses(chunk)

        return newSet.merge(await platformGetAllUTXOs(remainingChunk))
    }
}

export async function platformGetAllUTXOsForAddresses(
    addrs: string[],
    endIndex: any = undefined
): Promise<PlatformUTXOSet> {
    let response
    if (!endIndex) {
        response = await pChain.getUTXOs(addrs)
    } else {
        response = await pChain.getUTXOs(addrs, undefined, 0, endIndex)
    }

    const utxoSet = response.utxos
    const nextEndIndex = response.endIndex
    const len = response.numFetched

    if (len >= 1024) {
        const subUtxos = await platformGetAllUTXOsForAddresses(addrs, nextEndIndex)
        return utxoSet.merge(subUtxos)
    }

    return utxoSet
}
