/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * A wallet on any EVM network.
 *
 * Generalised from the former Robinhood-only wallet: nothing here is specific
 * to one chain, because an EVM wallet's mechanics do not vary by chain — only
 * its parameters do, and those come from an `EvmNetwork` in the registry.
 *
 * Deliberately self-contained: it talks to an EIP-1193 provider and a JSON-RPC
 * endpoint directly and imports nothing from `@/js/wallets`, `@/AVA` or the
 * vendored Avalanche SDKs. Those carry X/P-chain concepts (atomic UTXOs,
 * blockchain aliases, two address formats) that have no meaning here.
 */
import Big from 'big.js'

import type { PlatformAddress, PlatformBalance, PlatformWallet } from '../types'
import { getEvmNetworkByChainId, type EvmNetwork } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'

/** Minimal EIP-1193 surface this wallet needs. */
export interface Eip1193Provider {
    request(args: { method: string; params?: unknown[] | object }): Promise<any>
    on?(event: string, handler: (...args: any[]) => void): void
    removeListener?(event: string, handler: (...args: any[]) => void): void
}

/**
 * Prefers a generic EIP-1193 provider.
 *
 * Unlike the Avalanche side — which needs Core App specifically for its
 * `avalanche_*` RPC methods — any standards-compliant wallet works here, so
 * `window.ethereum` is the primary target and Core is only a fallback for
 * users who have it set as their default provider.
 */
export function getEvmProvider(): Eip1193Provider | null {
    const w = window as any
    return (w.ethereum ?? w.avalanche ?? null) as Eip1193Provider | null
}

function toHexChainId(chainId: number): string {
    return '0x' + chainId.toString(16)
}

function parseChainId(raw: unknown): number | null {
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
        const n = raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10)
        return Number.isFinite(n) ? n : null
    }
    return null
}

/** The chain the extension is currently pointed at, or null if unreadable. */
export async function getProviderChainId(provider: Eip1193Provider): Promise<number | null> {
    try {
        return parseChainId(await provider.request({ method: 'eth_chainId' }))
    } catch {
        return null
    }
}

export class EvmWallet implements PlatformWallet {
    readonly platformId = 'evm'
    readonly accessMethodId: string
    readonly isReadonly: boolean
    readonly native: Eip1193Provider | null
    readonly network: EvmNetwork

    private readonly address: string

    constructor(opts: {
        address: string
        network: EvmNetwork
        provider: Eip1193Provider | null
        accessMethodId: string
        isReadonly?: boolean
    }) {
        this.address = opts.address
        this.network = opts.network
        this.native = opts.provider
        this.accessMethodId = opts.accessMethodId
        this.isReadonly = opts.isReadonly ?? opts.provider === null
    }

    get id(): string {
        // Chain id is part of the identity: the same address on two networks
        // is two different wallet sessions as far as balances and sends go.
        return `evm:${this.network.evmChainId}:${this.address.toLowerCase()}`
    }

    getAddresses(): PlatformAddress[] {
        return [{ chain: 'EVM', address: this.address, label: this.network.name }]
    }

    getPrimaryAddress(): string {
        return this.address
    }

    /**
     * Native balance on this wallet's own network.
     *
     * ERC-20 discovery deliberately does not happen here: it needs the
     * explorer adapters and spans every registry network, not just this one.
     */
    async getBalances(): Promise<PlatformBalance[]> {
        const raw = await web3For(this.network).eth.getBalance(this.address)
        const amount = Big(raw.toString()).div(Big(10).pow(this.network.native.decimals))
        return [
            {
                assetId: 'native',
                symbol: this.network.native.symbol,
                name: this.network.native.name,
                decimals: this.network.native.decimals,
                amount,
                chain: 'EVM',
            },
        ]
    }

    async signMessage(message: string, address?: string): Promise<string> {
        const provider = this.requireProvider()
        const signer = address ?? this.address
        // `personal_sign` takes (message, address); the message goes as a
        // UTF-8 hex string so arbitrary text signs byte-exactly.
        const hexMessage =
            '0x' +
            Array.from(new TextEncoder().encode(message))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('')
        return await provider.request({
            method: 'personal_sign',
            params: [hexMessage, signer],
        })
    }

    private requireProvider(): Eip1193Provider {
        if (!this.native) {
            throw new Error('This wallet is watch-only and cannot sign.')
        }
        return this.native
    }
}

/**
 * Connects the injected wallet.
 *
 * By default this **adopts the chain the extension is already on** when that
 * chain is one the registry knows, rather than pushing the user onto
 * `preferred`. Connecting a wallet is not a request to switch networks: firing
 * an unsolicited "Add/Switch network" prompt the moment someone picks the EVM
 * platform is both startling and usually wrong — they are already on the chain
 * they care about.
 *
 * The switch only happens when the extension is on a chain the registry does
 * not list (nothing sensible to adopt), or when the caller explicitly asks for
 * one via `force` — which is what the network picker does.
 *
 * Returns a wallet bound to the network actually resolved; callers should read
 * `wallet.network` rather than assuming it is `preferred`.
 */
export async function connectInjected(
    preferred: EvmNetwork,
    opts: { force?: boolean } = {}
): Promise<EvmWallet> {
    const provider = getEvmProvider()
    if (!provider) {
        throw new Error('No wallet extension found. Install MetaMask to use this platform.')
    }

    const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
    if (!accounts?.length) {
        throw new Error('No accounts returned from the wallet extension.')
    }

    let network = preferred
    if (opts.force) {
        await ensureChain(provider, preferred)
    } else {
        const current = await getProviderChainId(provider)
        const known = current !== null ? getEvmNetworkByChainId(current) : undefined
        if (known) {
            network = known
        } else {
            // Extension is on a chain the registry has no entry for — there is
            // nothing to adopt, so fall back to moving it to the selected one.
            await ensureChain(provider, preferred)
        }
    }

    return new EvmWallet({
        address: accounts[0],
        network,
        provider,
        accessMethodId: 'injected',
    })
}

/**
 * Switches the extension to `network`, adding it first when unknown.
 *
 * Verifies the result with `eth_chainId` rather than assuming the switch took:
 * `wallet_addEthereumChain` does not guarantee the wallet also *switches* to
 * the chain it just added, and silently continuing on the wrong chain is how
 * a transaction ends up broadcast somewhere the user never intended.
 */
export async function ensureChain(
    provider: Eip1193Provider,
    network: EvmNetwork
): Promise<void> {
    const chainIdHex = toHexChainId(network.evmChainId)

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        })
    } catch (e: any) {
        // 4902 = chain unknown to the wallet. Anything else is a real failure
        // (including 4001, the user rejecting the switch).
        if (e?.code !== 4902) throw e

        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
                {
                    chainId: chainIdHex,
                    chainName: network.name,
                    nativeCurrency: {
                        name: network.native.name,
                        symbol: network.native.symbol,
                        decimals: network.native.decimals,
                    },
                    rpcUrls: [network.rpcUrl],
                    blockExplorerUrls: network.explorerUrl ? [network.explorerUrl] : [],
                },
            ],
        })

        // Adding does not reliably switch — ask explicitly, and let a refusal
        // surface rather than proceeding on the wrong chain.
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        })
    }

    const active = await getProviderChainId(provider)
    if (active !== null && active !== network.evmChainId) {
        throw new Error(
            `Wallet is on chain ${active}, not ${network.name} (${network.evmChainId}). ` +
                'Switch networks in your wallet extension and try again.'
        )
    }
}

/** Watch-only access from a pasted 0x address. */
export function watchAddress(address: string, network: EvmNetwork): EvmWallet {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error('Enter a valid 0x address.')
    }
    return new EvmWallet({
        address,
        network,
        provider: null,
        accessMethodId: 'watch',
        isReadonly: true,
    })
}
