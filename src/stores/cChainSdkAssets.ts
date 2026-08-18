/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { Avalanche } from '@avalanche-sdk/chainkit'
import { getErc20History, getActiveNetworkConfig } from '@/avalanche-wallet-sdk'
import { web3 } from '@/evm'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { findRegistryToken, isSpoofedToken } from '@/platforms/avalanche/tokenRegistry'

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

/**
 * C-chain assets discovered via the Glacier/chainkit SDK ("All Assets" —
 * tokens the user holds that aren't in the app's own "Default Assets" list).
 *
 * A Pinia store, not a plain composable, because it used to be one: every call
 * site (`Fungibles.vue`, `useHeldErc20Tokens` — itself used by Swap and the
 * transfer/EVM token pickers) created its OWN local `ref` state, so a refresh
 * triggered from one (e.g. Swap.vue after a swap) never reached any of the
 * others. Worse, several of those call sites live behind `<keep-alive>`
 * (Portfolio and Swap both are — see Wallet.vue), so they don't even remount
 * and refetch on their own when navigated back to. A single shared store
 * means one `refresh()` call updates every screen showing this data,
 * regardless of which one triggered it or whether the others are currently
 * mounted.
 */

/**
 * Discovers ERC-20 tokens via the C-chain block explorer (Snowtrace) rather
 * than the chainkit SDK: Etherscan-family explorers have no "list current
 * token balances" endpoint, only a transfer-history one, so this walks that
 * history to find every contract address the wallet has ever received a
 * transfer from, and reads the CURRENT balance directly off each contract
 * (never trusting a balance figure the explorer itself reports).
 *
 * Registry-gated the same way as the chainkit path in `fetch()` below: a
 * candidate claiming a symbol the registry knows about at the wrong address
 * is dropped as a spoof, and one matching a known address gets the
 * registry's canonical name/symbol. `alreadyFound` skips addresses the
 * chainkit SDK already discovered, so a token both sources see isn't listed
 * twice.
 */
async function fetchErc20FromExplorer(
    address: string,
    chainId: number,
    alreadyFound: Set<string>
): Promise<CChainSdkAsset[]> {
    const out: CChainSdkAsset[] = []
    try {
        const history = await getErc20History(address, getActiveNetworkConfig())

        // One entry per contract — this is transfer history, so the same
        // token can appear many times; only its reported symbol/name/
        // decimals are needed, and the first occurrence is as good as any.
        const candidates = new Map<string, { symbol: string; name: string; decimals: number }>()
        for (const tx of history) {
            const addr = tx.contractAddress.toLowerCase()
            if (!candidates.has(addr)) {
                candidates.set(addr, {
                    symbol: tx.tokenSymbol,
                    name: tx.tokenName,
                    decimals: parseInt(tx.tokenDecimal, 10) || 18,
                })
            }
        }

        for (const [addr, meta] of candidates) {
            if (alreadyFound.has(addr)) continue
            if (isSpoofedToken(meta.symbol, addr, chainId)) continue

            try {
                //@ts-ignore
                const contract = new web3.eth.Contract(ERC20Abi.abi, addr)
                const rawBalance: string = await contract.methods.balanceOf(address).call()
                if (!rawBalance || rawBalance === '0') continue

                const raw = BigInt(rawBalance)
                const divisor = BigInt(10 ** meta.decimals)
                const whole = raw / divisor
                const frac = raw % divisor
                const fracStr = frac.toString().padStart(meta.decimals, '0').replace(/0+$/, '')
                const humanBal = fracStr ? `${whole}.${fracStr}` : `${whole}`

                const registryEntry = findRegistryToken(addr, chainId)
                out.push({
                    type: 'erc20',
                    address: addr,
                    name: registryEntry?.name ?? meta.name,
                    symbol: registryEntry?.symbol ?? meta.symbol,
                    balance: humanBal,
                    decimals: meta.decimals,
                })
            } catch (e) {
                // One bad contract (e.g. a non-standard balanceOf) shouldn't
                // drop every other explorer-discovered token.
                console.warn(`[cChainSdkAssets] explorer balanceOf failed for ${addr}:`, e)
            }
        }
    } catch (e) {
        // Explorer discovery is a supplement, not the only source (chainkit
        // above already ran) — its failure shouldn't fail the whole fetch.
        console.warn('[cChainSdkAssets] explorer-based token discovery failed:', e)
    }
    return out
}

export const useCChainSdkAssetsStore = defineStore('cChainSdkAssets', () => {
    const assets = ref<CChainSdkAsset[]>([])
    const loading = ref(false)
    const error = ref<string | null>(null)

    // Remembered so refresh() (called from send/swap success handlers and the
    // C-chain poller, none of which know the address/chainId a view is
    // currently watching) can re-run the same fetch without them passing it.
    let lastAddress: string | null = null
    let lastChainId: number | null = null

    const fetch = async (address: string | null, chainId: number | null): Promise<void> => {
        lastAddress = address
        lastChainId = chainId

        if (!address || !chainId) {
            assets.value = []
            return
        }

        loading.value = true
        error.value = null

        const result: CChainSdkAsset[] = []
        // Collected rather than thrown immediately: ERC-20, ERC-721 and
        // ERC-1155 discovery are independent SDK calls, and a failure in one
        // (a transient listErc721/listErc1155 hiccup, say) must not discard
        // asset types that already discovered successfully — the whole
        // `assets.value` used to be replaced only on total success, so any one
        // of these throwing wiped out every token already found, including a
        // wallet's ordinary ERC-20 balances. Same isolation principle as
        // `fetchErc20FromExplorer`'s own internal catch below.
        const errors: string[] = []

        try {
            const sdk = new Avalanche({ chainId: String(chainId), enableTelemetry: false })

            // ERC-20 — checked against the Avalanche platform's token
            // registry (see platforms/avalanche/tokenRegistry/index.ts):
            // this SDK auto-discovers every
            // contract the address has ever interacted with, so a discovered
            // token claiming a symbol the registry knows (AVXTO, AVAX, …) at
            // an address that isn't the real one is dropped as a spoof.
            // Anything else discovered is shown as before — the registry
            // doesn't restrict discovery, only catches impostors of known
            // symbols. For a token that IS a registry-known address, its
            // name/symbol are used instead of whatever the SDK reported,
            // same as the "Default Assets" path in stores/assets.ts.
            try {
                const erc20Pages = await sdk.data.evm.address.balances.listErc20({ address })
                for await (const page of erc20Pages) {
                    for (const token of page.result.erc20TokenBalances) {
                        if (isSpoofedToken(token.symbol, token.address, chainId)) continue
                        const registryEntry = findRegistryToken(token.address, chainId)

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
                            name: registryEntry?.name ?? token.name,
                            symbol: registryEntry?.symbol ?? token.symbol,
                            logoUri: token.logoUri,
                            balance: humanBal,
                            decimals,
                        })
                    }
                }
            } catch (e: any) {
                errors.push(e?.message ?? 'ERC-20 discovery failed')
                console.warn('[cChainSdkAssets] chainkit ERC-20 listing failed:', e)
            }

            // A second, independent ERC-20 discovery source: the C-chain
            // block explorer (Snowtrace). The chainkit SDK above is Ava
            // Labs' own indexer; this instead derives "what tokens does this
            // address hold" from the explorer's public transfer-history API,
            // then confirms each candidate's CURRENT balance directly from
            // the contract rather than trusting the explorer's own balance
            // figures. Same registry/spoof check as above, and duplicates
            // against what chainkit already found are skipped.
            const alreadyFound = new Set(
                result.filter((a) => a.type === 'erc20').map((a) => a.address.toLowerCase())
            )
            result.push(...(await fetchErc20FromExplorer(address, chainId, alreadyFound)))

            // ERC-721
            try {
                const erc721Pages = await sdk.data.evm.address.balances.listErc721({ address })
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
            } catch (e: any) {
                errors.push(e?.message ?? 'ERC-721 discovery failed')
                console.warn('[cChainSdkAssets] chainkit ERC-721 listing failed:', e)
            }

            // ERC-1155
            try {
                const erc1155Pages = await sdk.data.evm.address.balances.listErc1155({ address })
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
            } catch (e: any) {
                errors.push(e?.message ?? 'ERC-1155 discovery failed')
                console.warn('[cChainSdkAssets] chainkit ERC-1155 listing failed:', e)
            }

            assets.value = result
            error.value = errors.length > 0 ? errors.join('; ') : null
        } catch (e: any) {
            // Something outside the per-type isolation above (e.g. the SDK
            // constructor itself) — still surface whatever was collected
            // rather than discarding it.
            assets.value = result
            error.value = e?.message ?? 'Failed to fetch C-chain balances'
            console.error('useCChainSdkAssetsStore fetch error:', e)
        } finally {
            loading.value = false
        }
    }

    /** Re-runs the last `fetch()` — a no-op (clears to empty) if none has happened yet. */
    const refresh = async (): Promise<void> => {
        await fetch(lastAddress, lastChainId)
    }

    return { assets, loading, error, fetch, refresh }
})
