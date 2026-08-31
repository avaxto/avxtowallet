/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Wallets on any EVM network.
 *
 * Generalised from the former Robinhood-only wallet: nothing here is specific
 * to one chain, because an EVM wallet's mechanics do not vary by chain — only
 * its parameters do, and those come from an `EvmNetwork` in the registry.
 *
 * Three concrete kinds behind one base class, the same shape the Solana
 * platform settled on (see platforms/solana/wallet.ts):
 *
 *   `InjectedEvmWallet`  MetaMask/Rabby/Core hold the key, price the gas and
 *                        approve each transaction. Authorized externally.
 *   `LocalEvmWallet`     This app holds the seed, encrypted in a
 *                        `SessionVault`, derives the key for the duration of
 *                        one signature, and signs and broadcasts itself.
 *   `WatchEvmWallet`     An address only. Can never sign.
 *
 * The split replaces a single class where `provider === null` silently meant
 * "watch-only". That worked while there were two states; with a third — a
 * wallet that has no provider *and can sign* — it would have become a lie.
 *
 * Deliberately self-contained: it talks to an EIP-1193 provider and a JSON-RPC
 * endpoint directly and imports nothing from `@/js/wallets`, `@/AVA` or the
 * vendored Avalanche SDKs. Those carry X/P-chain concepts (atomic UTXOs,
 * blockchain aliases, two address formats) that have no meaning here.
 *
 * ## How the signing gate applies here
 *
 * `js/security/authorize.ts` authorizes on one of two things: a `vault` field
 * (prompt for the session password) or a `type` in its externally-authorized
 * set (`ledger`, `injected`). Both are satisfied structurally below —
 * `LocalEvmWallet` exposes `vault`, and the injected wallet's `type` getter
 * returns its access-method id. `WatchEvmWallet` deliberately satisfies
 * neither, so that gate refuses it, which is exactly right for an address the
 * app holds no key for.
 */
import Big from 'big.js'
import { Buffer as BufferNative } from 'buffer'
import { Transaction } from '@ethereumjs/tx'
import { personalSign } from '@metamask/eth-sig-util'

import type { PlatformAddress, PlatformBalance, PlatformWallet } from '../types'
import { BN } from '@/avalanche'
import { commonFor } from '@/evm/common'
import { gasFor } from '@/evm/gas'
import { deriveEvmPrivateKey, isValidEvmAddress } from '@/evm/keys'
import { getEvmNetworkByChainId, type EvmNetwork } from '@/evm/networkRegistry'
import { web3For } from '@/evm/providers'
import { estimateGasWith } from '@/evm/signer'
import { SessionVault } from '@/js/security/SessionVault'
import { requireAuth } from '@/js/security/session'
import { wipe } from '@/js/security/memory'

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

/** UTF-8 text as the 0x-hex string `personal_sign` takes, so it signs byte-exactly. */
function toHexMessage(message: string): string {
    return (
        '0x' +
        Array.from(new TextEncoder().encode(message))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('')
    )
}

/**
 * `transfer(address,uint256)` calldata: the 4-byte selector then two 32-byte
 * words. Encoded by hand rather than through a web3 `Contract`, which binds to
 * the provider of the instance that created it — routing a send through one
 * would reintroduce exactly the "which chain did this actually go to?"
 * ambiguity this platform exists to avoid.
 */
function encodeErc20Transfer(to: string, amountRaw: string): string {
    const paddedTo = to.toLowerCase().replace(/^0x/, '').padStart(64, '0')
    const paddedAmount = BigInt(amountRaw).toString(16).padStart(64, '0')
    return `0xa9059cbb${paddedTo}${paddedAmount}`
}

function assertRecipient(to: string): void {
    if (!isValidEvmAddress(to)) {
        throw new Error('Enter a valid 0x address.')
    }
}

export abstract class EvmWallet implements PlatformWallet {
    readonly platformId = 'evm'
    abstract readonly accessMethodId: string
    abstract readonly isReadonly: boolean
    /** The EIP-1193 provider, for wallets that have one. Null otherwise. */
    abstract readonly native: Eip1193Provider | null

    protected readonly address: string
    /**
     * readonly on purpose: switching network builds a NEW wallet rather than
     * reassigning this. The wallet lives in a `shallowRef`, so an in-place
     * change would be invisible to Vue and leave the UI on the old chain's
     * data — see `rebindWallet` in ./store.ts.
     */
    readonly network: EvmNetwork

    protected constructor(address: string, network: EvmNetwork) {
        if (!isValidEvmAddress(address)) {
            throw new Error(`Not a valid EVM address: ${address}`)
        }
        this.address = address
        this.network = network
    }

    get id(): string {
        // Chain id is part of the identity: the same address on two networks
        // is two different wallet sessions as far as balances and sends go.
        return `evm:${this.network.evmChainId}:${this.address.toLowerCase()}`
    }

    /**
     * Duck-typed to match Avalanche's wallet `.type` field so this wallet
     * plugs straight into `authorizeWalletOp` (`js/security/authorize.ts`)
     * without that gate needing to know about a second wallet hierarchy. See
     * the module note on how the gate applies to each kind.
     */
    get type(): string {
        return this.accessMethodId
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

    /** Sends the network's native asset. `amountWei` is the unscaled integer amount. */
    abstract sendNative(to: string, amountWei: string, data?: string): Promise<string>

    /**
     * Sends an ERC-20. `amountRaw` is the unscaled integer amount — callers
     * scale by the token's verified on-chain decimals (see evm/tokenReader.ts),
     * never by a value an explorer reported.
     */
    abstract sendErc20(tokenAddress: string, to: string, amountRaw: string): Promise<string>

    /** EIP-191 (`personal_sign`) signature over `message`. */
    abstract signMessage(message: string, address?: string): Promise<string>

    /**
     * Throws unless this wallet will really transact on `network`.
     *
     * Called immediately before a send, and meaningful only where the chain can
     * drift out from under the app — see each implementation.
     */
    abstract assertOnChain(): Promise<void>
}

/**
 * A wallet backed by a browser extension.
 *
 * The extension owns the key, prices the gas and prompts for every signature,
 * so nothing here touches key material and `authorizeWalletOp` lets it through
 * without a session password (its `type` is `injected`).
 */
export class InjectedEvmWallet extends EvmWallet {
    readonly accessMethodId: string
    readonly isReadonly = false
    /**
     * Narrowed to non-null, unlike the base. An injected wallet without a
     * provider is not a thing — that state used to mean "watch-only", which is
     * now `WatchEvmWallet`, so the type says so and the null checks that
     * enforced it by hand are gone.
     */
    readonly native: Eip1193Provider

    constructor(opts: {
        address: string
        network: EvmNetwork
        provider: Eip1193Provider
        accessMethodId: string
    }) {
        super(opts.address, opts.network)
        this.native = opts.provider
        this.accessMethodId = opts.accessMethodId
    }

    /**
     * Sends the network's native asset via the injected provider's own
     * `eth_sendTransaction`.
     *
     * Deliberately leaves gas fields unset: this wallet has to work across
     * every registry network — some legacy, some EIP-1559 — and the injected
     * extension already knows how to price and confirm a transaction
     * correctly for whichever chain it is connected to. Setting them here
     * would mean re-implementing per-chain gas rules (see `evm/gas.ts`) for a
     * value the wallet's own confirmation UI shows the user anyway. Leaving
     * `data` unset works the same way when a memo is present: the extension's
     * own `eth_estimateGas` naturally accounts for the extra calldata, so
     * there is nothing to compute here either.
     *
     * `LocalEvmWallet.sendNative` is where the opposite decision had to be
     * made — with no extension there is nobody else to price the transaction.
     */
    async sendNative(to: string, amountWei: string, data?: string): Promise<string> {
        assertRecipient(to)
        return await this.native.request({
            method: 'eth_sendTransaction',
            params: [
                {
                    from: this.address,
                    to,
                    value: '0x' + BigInt(amountWei).toString(16),
                    ...(data ? { data } : {}),
                },
            ],
        })
    }

    async sendErc20(tokenAddress: string, to: string, amountRaw: string): Promise<string> {
        assertRecipient(to)
        if (!isValidEvmAddress(tokenAddress)) {
            throw new Error('Invalid token contract address.')
        }

        return await this.native.request({
            method: 'eth_sendTransaction',
            params: [
                {
                    from: this.address,
                    to: tokenAddress,
                    data: encodeErc20Transfer(to, amountRaw),
                },
            ],
        })
    }

    /**
     * Throws unless the extension is currently on this wallet's network.
     *
     * `eth_sendTransaction` goes to whatever chain the extension happens to be
     * on, and the user can switch it at any moment from inside the extension
     * without the app hearing about it — so anything checked earlier is already
     * stale. Without this, a transfer composed for a token on one chain can be
     * broadcast on another to the same address, which is a silent loss rather
     * than a visible error.
     */
    async assertOnChain(): Promise<void> {
        const current = await getProviderChainId(this.native)
        if (current === null) return // unreadable — let the extension decide
        if (current !== this.network.evmChainId) {
            throw new Error(
                `Your wallet is on chain ${current}, but this transaction is for ` +
                    `${this.network.name} (${this.network.evmChainId}). Switch networks and try again.`
            )
        }
    }

    async signMessage(message: string, address?: string): Promise<string> {
        // `personal_sign` takes (message, address).
        return await this.native.request({
            method: 'personal_sign',
            params: [toHexMessage(message), address ?? this.address],
        })
    }
}

/** One transaction for `LocalEvmWallet.signAndSend`. */
export interface LocalTxRequest {
    /** Omit for a contract creation — an empty `to` is not the same thing to a node. */
    to?: string
    data?: string
    /** Wei. Defaults to zero. */
    value?: BN
    /** Skips estimation. */
    gasLimit?: number
    /** Used when estimation fails, which is routine for contract creations. */
    fallbackGasLimit?: number
    /**
     * Explicit nonce, for sequencing sends that go out back-to-back. Letting
     * each send ask for "the" pending nonce independently is racy.
     */
    nonce?: number
}

/** Fallback gas for a plain value transfer when the node refuses to estimate. */
const NATIVE_TRANSFER_GAS = 21_000
/**
 * Fallback gas for an ERC-20 `transfer`. A cold storage slot costs ~50k and a
 * warm one ~35k; 120k covers tokens with transfer hooks or fee-on-transfer
 * logic. Unused gas is refunded, so the cost of being generous here is only
 * that the balance check below asks for more headroom.
 */
const ERC20_TRANSFER_GAS = 120_000

/**
 * A wallet whose seed this app holds, encrypted at rest in a `SessionVault`.
 *
 * This is what a recovery phrase opens — including from the one-phrase
 * multi-platform unlock (see `unlockWithMnemonic` in platforms/store.ts), which
 * is why it exists: the EVM platform was previously extension-only, so a user
 * opening Bitcoin, Solana and Avalanche from one phrase got no EVM session at
 * all, despite the phrase being a perfectly good credential on every EVM chain.
 *
 * The private key exists in plaintext only inside `withPrivateKey`, for the
 * duration of one signature, and is wiped on both the success and error paths.
 * The vault holds the BIP-39 *seed*; the key is re-derived at `derivationPath`
 * per signature rather than stored. The path is not secret — it is needed to
 * reproduce the same account and reveals nothing without the seed.
 *
 * Unlike the injected wallet, this one owns the whole send: nonce, gas price,
 * gas limit, the EIP-155 signature and the broadcast. See `signAndSend`.
 */
export class LocalEvmWallet extends EvmWallet {
    readonly accessMethodId = 'mnemonic'
    readonly isReadonly = false
    readonly native = null
    readonly vault: SessionVault
    readonly derivationPath: string

    constructor(opts: {
        address: string
        network: EvmNetwork
        vault: SessionVault
        derivationPath: string
    }) {
        super(opts.address, opts.network)
        this.vault = opts.vault
        this.derivationPath = opts.derivationPath
    }

    /**
     * Re-derives the private key inside an authorized scope, hands it to `fn`,
     * and wipes it however `fn` settles.
     *
     * `requireAuth(this.vault)` is the invariant that keeps this behind the
     * password: reaching a signing primitive outside `authorizeWalletOp` throws
     * rather than silently signing.
     */
    private async withPrivateKey<T>(fn: (privateKey: Uint8Array) => Promise<T> | T): Promise<T> {
        const auth = requireAuth(this.vault)

        return this.vault.withSecret(auth, 'seed', async (seed) => {
            const privateKey = deriveEvmPrivateKey(seed, this.derivationPath)
            try {
                return await fn(privateKey)
            } finally {
                wipe(privateKey)
            }
        })
    }

    /**
     * As `withPrivateKey`, for the two libraries that insist on a Node
     * `Buffer` (`@ethereumjs/tx` and `@metamask/eth-sig-util`).
     *
     * The conversion makes a second copy of the key, which `withPrivateKey`
     * knows nothing about and would therefore leave behind. Wiping it is this
     * wrapper's whole reason to exist — it is not a convenience.
     */
    private async withPrivateKeyBuffer<T>(
        fn: (privateKey: globalThis.Buffer) => Promise<T> | T
    ): Promise<T> {
        return this.withPrivateKey(async (privateKey) => {
            const buffer = BufferNative.from(privateKey) as globalThis.Buffer
            try {
                return await fn(buffer)
            } finally {
                wipe(buffer)
            }
        })
    }

    /**
     * Prices, signs and broadcasts one transaction on this wallet's network.
     *
     * The single signing path — `sendNative`, `sendErc20` and `LocalEvmSigner`
     * all funnel through here, so there is exactly one place where a
     * transaction's chain id, nonce and fee are decided.
     *
     * Everything is bound to `this.network`: the gas quote, the chain
     * parameters, the nonce and the broadcast all come from that network's own
     * RPC via `web3For`. Notably NOT `broadcastEvm` (helpers/broadcastEvm.ts),
     * which looks like the obvious reuse and would be a serious bug — it
     * submits through the Avalanche C-Chain singleton, so every send from this
     * platform would go to Avalanche regardless of which chain it was signed
     * for. Skipping it also skips offline-signing capture, which is consistent:
     * this platform declares `offlineSigning: false` because that flow
     * serialises Avalanche transaction types.
     *
     * `commonFor` reads the chain id from the network's own node rather than
     * trusting the registry entry — that id IS the EIP-155 replay protection
     * baked into the signature, so a custom endpoint serving a different chain
     * than the app has on file must produce a signature that node accepts.
     */
    async signAndSend(req: LocalTxRequest): Promise<string> {
        const web3 = web3For(this.network)

        const [gasPrice, nonce, chainParams] = await Promise.all([
            gasFor(this.network),
            req.nonce !== undefined
                ? Promise.resolve(req.nonce)
                : // 'pending' (not the default 'latest') includes this account's
                  // own not-yet-mined transactions.
                  web3.eth.getTransactionCount(this.address, 'pending'),
            commonFor(this.network),
        ])

        const gasLimit =
            req.gasLimit ??
            (await estimateGasWith(
                web3,
                this.address,
                { to: req.to, data: req.data, value: req.value },
                req.fallbackGasLimit ?? NATIVE_TRANSFER_GAS
            ))

        const value = req.value ?? new BN(0)
        await this.assertCanAfford(value, gasPrice, gasLimit)

        const tx = new Transaction(
            {
                nonce,
                gasPrice,
                gasLimit,
                ...(req.to ? { to: req.to } : {}),
                value,
                data: req.data ?? '0x',
            },
            chainParams
        )

        const raw = await this.withPrivateKeyBuffer((privateKey) =>
            tx.sign(privateKey).serialize().toString('hex')
        )

        // Resolves on the RECEIPT, not on broadcast — web3 1.x's own semantics,
        // and the same ones `broadcastEvm` gives every Avalanche send, so a
        // caller's "sent" means the same thing on both platforms.
        const receipt = await web3.eth.sendSignedTransaction('0x' + raw)
        return receipt.transactionHash as string
    }

    /**
     * Rejects a send this account cannot pay for, naming the shortfall.
     *
     * The injected path has no equivalent because the extension does this
     * itself, in its own confirmation screen. Here nobody else will: without
     * it, sending a round number that happens to leave nothing for gas fails
     * inside the node with "insufficient funds for gas * price + value", which
     * reads like a bug in the wallet rather than an amount that needs lowering.
     */
    private async assertCanAfford(value: BN, gasPrice: BN, gasLimit: number): Promise<void> {
        const balance = new BN(
            (await web3For(this.network).eth.getBalance(this.address)).toString()
        )
        const fee = gasPrice.mul(new BN(gasLimit))
        const needed = value.add(fee)
        if (balance.gte(needed)) return

        const decimals = this.network.native.decimals
        const symbol = this.network.native.symbol
        const scale = Big(10).pow(decimals)
        const short = Big(needed.sub(balance).toString()).div(scale)

        throw new Error(
            `Not enough ${symbol}. This transaction needs ${Big(needed.toString())
                .div(scale)
                .toString()} ${symbol} including the ${Big(fee.toString())
                .div(scale)
                .toString()} ${symbol} fee — ${short.toString()} ${symbol} short.`
        )
    }

    async sendNative(to: string, amountWei: string, data?: string): Promise<string> {
        assertRecipient(to)
        return await this.signAndSend({
            to,
            value: new BN(amountWei),
            ...(data ? { data } : {}),
            fallbackGasLimit: NATIVE_TRANSFER_GAS,
        })
    }

    async sendErc20(tokenAddress: string, to: string, amountRaw: string): Promise<string> {
        assertRecipient(to)
        if (!isValidEvmAddress(tokenAddress)) {
            throw new Error('Invalid token contract address.')
        }
        return await this.signAndSend({
            to: tokenAddress,
            data: encodeErc20Transfer(to, amountRaw),
            fallbackGasLimit: ERC20_TRANSFER_GAS,
        })
    }

    async signMessage(message: string): Promise<string> {
        return this.withPrivateKeyBuffer((privateKey) =>
            personalSign({ privateKey, data: toHexMessage(message) })
        )
    }

    /**
     * Nothing to check: this wallet signs with the chain id folded into the
     * signature (EIP-155, via `commonFor` in `signAndSend`), so there is no
     * extension that could have moved to another chain behind the app's back.
     * A mismatch here produces a transaction the node rejects, not one
     * broadcast somewhere the user never intended.
     */
    async assertOnChain(): Promise<void> {
        /* intentionally empty — see the doc above */
    }
}

/** Watch-only. Balances render; nothing can be signed. */
export class WatchEvmWallet extends EvmWallet {
    readonly accessMethodId = 'watch'
    readonly isReadonly = true
    readonly native = null

    constructor(opts: { address: string; network: EvmNetwork }) {
        super(opts.address, opts.network)
    }

    async sendNative(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot send.')
    }

    async sendErc20(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot send.')
    }

    async signMessage(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot sign.')
    }

    async assertOnChain(): Promise<void> {
        /* nothing to drift — this wallet cannot transact at all */
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
): Promise<InjectedEvmWallet> {
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

    return new InjectedEvmWallet({
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
export function watchAddress(address: string, network: EvmNetwork): WatchEvmWallet {
    if (!isValidEvmAddress(address)) {
        throw new Error('Enter a valid 0x address.')
    }
    return new WatchEvmWallet({ address: address.trim(), network })
}
