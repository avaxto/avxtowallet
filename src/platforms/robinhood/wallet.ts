/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Robinhood Chain wallet — a plain EIP-1193 / EVM wallet.
 *
 * Deliberately self-contained: it talks to the injected provider and a JSON-RPC
 * endpoint directly and imports nothing from `@/js/wallets`, `@/AVA` or the
 * vendored Avalanche SDKs. That is the point of the platform boundary — the
 * Avalanche implementation carries X/P chain concepts (atomic UTXOs, blockchain
 * aliases, HD paths for two address formats) that have no meaning here, and
 * inheriting from it would drag all of that in.
 *
 * Because Robinhood Chain uses ETH as its native gas token and is a standard
 * Arbitrum L2, everything here is ordinary EVM: 0x addresses, an account nonce,
 * `eth_*` RPC calls and ERC-20 `balanceOf`.
 */
import Big from 'big.js'

import type { PlatformAddress, PlatformBalance, PlatformNetwork, PlatformWallet } from '../types'

/** Minimal EIP-1193 surface this wallet needs. */
interface Eip1193Provider {
    request(args: { method: string; params?: unknown[] | object }): Promise<any>
    on?(event: string, handler: (...args: any[]) => void): void
    removeListener?(event: string, handler: (...args: any[]) => void): void
}

/**
 * Prefers a generic EIP-1193 provider.
 *
 * Unlike the Avalanche side — which needs Core App specifically for
 * `avalanche_*` RPC methods — any standards-compliant wallet works here, so
 * `window.ethereum` is the primary target and Core is only a fallback for users
 * who have it as their default provider.
 */
export function getEvmProvider(): Eip1193Provider | null {
    const w = window as any
    return (w.ethereum ?? w.avalanche ?? null) as Eip1193Provider | null
}

/** Converts a hex/decimal wei-style value to a decimal-scaled Big. */
function scaledFromHex(hexOrDec: string, decimals: number): Big {
    const raw = hexOrDec?.startsWith?.('0x')
        ? BigInt(hexOrDec).toString(10)
        : String(hexOrDec ?? '0')
    return Big(raw).div(Big(10).pow(decimals))
}

function toHexChainId(chainId: number): string {
    return '0x' + chainId.toString(16)
}

export class RobinhoodWallet implements PlatformWallet {
    readonly platformId = 'robinhood'
    readonly accessMethodId: string
    readonly isReadonly: boolean
    readonly native: Eip1193Provider | null

    private readonly address: string
    private readonly network: PlatformNetwork

    constructor(opts: {
        address: string
        network: PlatformNetwork
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
        return `robinhood:${this.address.toLowerCase()}`
    }

    getAddresses(): PlatformAddress[] {
        return [{ chain: 'RH', address: this.address, label: this.network.name }]
    }

    getPrimaryAddress(): string {
        return this.address
    }

    /**
     * Native ETH balance.
     *
     * ERC-20 discovery is intentionally not attempted here: there is no indexer
     * for this chain wired into the app yet, and enumerating tokens without one
     * would mean guessing contract addresses. Tokens the user adds explicitly
     * flow through the existing custom-token path.
     */
    async getBalances(): Promise<PlatformBalance[]> {
        const hex = await this.rpc('eth_getBalance', [this.address, 'latest'])
        return [
            {
                assetId: 'native',
                symbol: this.network.nativeSymbol,
                name: 'Ether',
                decimals: this.network.nativeDecimals,
                amount: scaledFromHex(hex, this.network.nativeDecimals),
                chain: 'RH',
            },
        ]
    }

    async signMessage(message: string, address?: string): Promise<string> {
        const provider = this.requireProvider()
        const signer = address ?? this.address
        // `personal_sign` takes (message, address); the message is passed as a
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

    /**
     * Reads go over plain HTTP JSON-RPC rather than through the injected
     * provider, so balances still refresh when the extension is pointed at a
     * different network than the one selected in this app.
     */
    private async rpc(method: string, params: unknown[]): Promise<any> {
        const res = await fetch(this.network.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
        if (!res.ok) {
            throw new Error(`Robinhood Chain RPC ${method} failed: HTTP ${res.status}`)
        }
        const json = await res.json()
        if (json.error) {
            throw new Error(`Robinhood Chain RPC ${method} failed: ${json.error.message}`)
        }
        return json.result
    }

    private requireProvider(): Eip1193Provider {
        if (!this.native) {
            throw new Error('This Robinhood Chain wallet is watch-only and cannot sign.')
        }
        return this.native
    }
}

/**
 * Connects the injected wallet and ensures it is pointed at Robinhood Chain.
 *
 * The chain is added to the extension when unknown (`4902`), because an L2 this
 * new will not be preconfigured in any wallet — without this the connect flow
 * dead-ends with an unhelpful provider error.
 */
export async function connectInjected(network: PlatformNetwork): Promise<RobinhoodWallet> {
    const provider = getEvmProvider()
    if (!provider) {
        throw new Error('No wallet extension found. Install MetaMask to use Robinhood Chain.')
    }

    const accounts: string[] = await provider.request({ method: 'eth_requestAccounts' })
    if (!accounts?.length) {
        throw new Error('No accounts returned from the wallet extension.')
    }

    await ensureChain(provider, network)

    return new RobinhoodWallet({
        address: accounts[0],
        network,
        provider,
        accessMethodId: 'injected',
    })
}

async function ensureChain(provider: Eip1193Provider, network: PlatformNetwork): Promise<void> {
    if (!network.evmChainId) return
    const chainIdHex = toHexChainId(network.evmChainId)

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: chainIdHex }],
        })
        return
    } catch (e: any) {
        // 4902 = chain not known to the wallet; anything else is a real failure
        // (including 4001, the user rejecting the switch).
        if (e?.code !== 4902) throw e
    }

    await provider.request({
        method: 'wallet_addEthereumChain',
        params: [
            {
                chainId: chainIdHex,
                chainName: network.name,
                nativeCurrency: {
                    name: 'Ether',
                    symbol: network.nativeSymbol,
                    decimals: network.nativeDecimals,
                },
                rpcUrls: [network.rpcUrl],
                blockExplorerUrls: network.explorerUrl ? [network.explorerUrl] : [],
            },
        ],
    })
}

/** Watch-only access from a pasted 0x address. */
export function watchAddress(address: string, network: PlatformNetwork): RobinhoodWallet {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
        throw new Error('Enter a valid 0x address.')
    }
    return new RobinhoodWallet({
        address,
        network,
        provider: null,
        accessMethodId: 'watch',
        isReadonly: true,
    })
}
