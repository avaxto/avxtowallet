import { ref, watch, type Ref } from 'vue'
import { Avalanche } from '@avalanche-sdk/chainkit'

export type CChainSdkAsset = {
    type: 'erc20' | 'erc721' | 'erc1155'
    address: string
    name: string
    symbol: string
    logoUri?: string
    balance: string
    decimals?: number
    tokenId?: string
}

export function useCChainSdkBalances(address: Ref<string | null>, chainId: Ref<number>) {
    const assets = ref<CChainSdkAsset[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    const fetchBalances = async () => {
        const addr = address.value
        const cid = chainId.value
        if (!addr || !cid) {
            assets.value = []
            return
        }

        loading.value = true
        error.value = null

        try {
            const sdk = new Avalanche({ chainId: String(cid) })
            const result: CChainSdkAsset[] = []

            // ERC-20
            const erc20Pages = await sdk.data.evm.address.balances.listErc20({ address: addr })
            for await (const page of erc20Pages) {
                for (const token of page.result.erc20TokenBalances) {
                    const decimals = token.decimals ?? 18
                    const raw = BigInt(token.balance)
                    const divisor = BigInt(10 ** decimals)
                    const whole = raw / divisor
                    const frac = raw % divisor
                    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
                    const humanBal = fracStr ? `${whole}.${fracStr}` : `${whole}`
                    result.push({
                        type: 'erc20',
                        address: token.address,
                        name: token.name,
                        symbol: token.symbol,
                        logoUri: token.logoUri,
                        balance: humanBal,
                        decimals,
                    })
                }
            }

            // ERC-721
            const erc721Pages = await sdk.data.evm.address.balances.listErc721({ address: addr })
            for await (const page of erc721Pages) {
                for (const token of page.result.erc721TokenBalances) {
                    result.push({
                        type: 'erc721',
                        address: token.address,
                        name: token.metadata?.name ?? token.name,
                        symbol: token.symbol,
                        logoUri: token.metadata?.imageUri,
                        balance: '1',
                        tokenId: token.tokenId,
                    })
                }
            }

            // ERC-1155
            const erc1155Pages = await sdk.data.evm.address.balances.listErc1155({ address: addr })
            for await (const page of erc1155Pages) {
                for (const token of page.result.erc1155TokenBalances) {
                    result.push({
                        type: 'erc1155',
                        address: token.address,
                        name: token.metadata?.name ?? `Token #${token.tokenId}`,
                        symbol: `#${token.tokenId}`,
                        logoUri: token.metadata?.imageUri,
                        balance: token.balance,
                        tokenId: token.tokenId,
                    })
                }
            }

            assets.value = result
        } catch (e: any) {
            error.value = e?.message ?? 'Failed to fetch C-chain balances'
            console.error('useCChainSdkBalances error:', e)
        } finally {
            loading.value = false
        }
    }

    watch([address, chainId], fetchBalances, { immediate: true })

    return { assets, loading, error, fetchBalances }
}
