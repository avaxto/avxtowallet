/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Solana wallets.
 *
 * Three concrete kinds behind one base class:
 *
 *   `InjectedSolanaWallet`  Phantom/Solflare hold the key and approve each
 *                           action. Authorized externally.
 *   `LocalSolanaWallet`     This app holds the key, encrypted in a
 *                           `SessionVault`, and signs locally behind the
 *                           session-password gate.
 *   `WatchSolanaWallet`     An address only. Can never sign.
 *
 * Self-contained by design: nothing here imports `@/AVA`, `@/js/wallets` or
 * the vendored Avalanche SDKs. Those carry UTXO/atomic-chain concepts that
 * have no meaning on Solana, and the whole point of the platform boundary is
 * that a new chain doesn't inherit another chain's model.
 *
 * ## How the signing gate applies here
 *
 * `js/security/authorize.ts` gates every signing operation. It authorizes on
 * one of two things: a `vault` field (prompt for the session password), or a
 * `type` in its externally-authorized set (`ledger`, `injected` — the device
 * or extension prompts instead). Both are satisfied structurally below —
 * `LocalSolanaWallet` exposes `vault`, and the injected wallet's `type` getter
 * returns its access-method id, which is `injected`. A watch-only wallet
 * deliberately satisfies neither, so that gate refuses it by default, which is
 * exactly right for an address the app holds no key for.
 */
import Big from 'big.js'
import bs58 from 'bs58'
import { ed25519 } from '@noble/curves/ed25519'
import {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    type Connection,
} from '@solana/web3.js'

import type { PlatformAddress, PlatformBalance, PlatformWallet } from '../types'
import { SessionVault } from '@/js/security/SessionVault'
import { requireAuth } from '@/js/security/session'
import { wipe } from '@/js/security/memory'
import { LAMPORTS_PER_SOL, SOL_DECIMALS, type SolanaNetwork } from '@/solana/networks'
import { connectionFor, withRpcErrors } from '@/solana/rpc'
import { deriveSolanaSeed, destroySolanaKeypair, isValidSolanaAddress } from '@/solana/keys'
import { readSolBalance, readSplBalances } from '@/solana/tokens'
import type { SolanaProvider } from './provider'

/** Chain label for `PlatformAddress.chain`. Solana has exactly one chain. */
export const SOLANA_CHAIN = 'SOL'

/**
 * Minimum lamports an account needs to exist. Sending less than this to an
 * address that doesn't exist yet fails at the runtime with an
 * "insufficient funds for rent" error that reads like the *sender* is short.
 * Checked up front so the message can say what actually needs fixing.
 *
 * The real value is computed from account size and the rent rate; for a plain
 * system account it has been 890880 lamports (0.00089088 SOL) since rent rates
 * were fixed. `getMinimumBalanceForRentExemption` is consulted at send time —
 * this constant is only the fallback when that call fails.
 */
const FALLBACK_RENT_EXEMPT_LAMPORTS = 890880

/** A transfer's fee, for the balance check. Solana's base fee is 5000 lamports/signature. */
const BASE_FEE_LAMPORTS = 5000

export abstract class SolanaWallet implements PlatformWallet {
    readonly platformId = 'solana'
    abstract readonly accessMethodId: string
    abstract readonly isReadonly: boolean
    abstract readonly native: unknown

    readonly address: string
    /**
     * readonly on purpose: switching cluster builds a NEW wallet rather than
     * reassigning this. The wallet lives in a `shallowRef`, so an in-place
     * change would be invisible to Vue and leave the UI on the old cluster's
     * data — see `rebindWallet` in ./store.ts.
     */
    readonly network: SolanaNetwork

    protected constructor(address: string, network: SolanaNetwork) {
        if (!isValidSolanaAddress(address)) {
            throw new Error(`Not a valid Solana address: ${address}`)
        }
        this.address = address
        this.network = network
    }

    /**
     * Cluster is part of the identity: the same address on mainnet and devnet
     * are different sessions as far as balances and sends are concerned.
     */
    get id(): string {
        return `solana:${this.network.id}:${this.address}`
    }

    /**
     * Duck-typed to match the wallet `.type` field `authorizeWalletOp` reads.
     * See the module note on how the signing gate applies here.
     */
    get type(): string {
        return this.accessMethodId
    }

    getAddresses(): PlatformAddress[] {
        return [{ chain: SOLANA_CHAIN, address: this.address, label: this.network.name }]
    }

    getPrimaryAddress(): string {
        return this.address
    }

    /** Native SOL plus every SPL holding, in the platform-neutral shape. */
    async getBalances(): Promise<PlatformBalance[]> {
        const [sol, spl] = await Promise.all([
            readSolBalance(this.address, this.network),
            readSplBalances(this.address, this.network).catch((e) => {
                // A failed token scan must not hide the SOL balance — the
                // native balance is the one thing that must always render.
                console.warn('[solana/wallet] SPL scan failed:', e)
                return []
            }),
        ])

        return [
            {
                assetId: 'native',
                symbol: this.network.native.symbol,
                name: this.network.native.name,
                decimals: SOL_DECIMALS,
                amount: sol,
                chain: SOLANA_CHAIN,
            },
            ...spl.map((t) => ({
                assetId: t.mint,
                symbol: t.symbol,
                name: t.name,
                decimals: t.decimals,
                amount: t.amount,
                chain: SOLANA_CHAIN,
            })),
        ]
    }

    protected get connection(): Connection {
        return connectionFor(this.network)
    }

    /** Signs an arbitrary message, returning a base58 signature. */
    abstract signMessage(message: string): Promise<string>

    /**
     * Sends SOL. Returns the transaction signature.
     * `amountSol` is a human-scaled amount; conversion to lamports happens here
     * so no caller has to know the scale factor.
     */
    abstract sendSol(to: string, amountSol: Big): Promise<string>

    /**
     * Builds an unsigned SOL transfer with a fresh blockhash.
     *
     * Shared by both signing paths so the transaction they produce is
     * byte-identical in structure — the only difference is who signs it.
     */
    protected async buildTransfer(
        to: string,
        amountSol: Big
    ): Promise<{ tx: Transaction; blockhash: string; lastValidBlockHeight: number }> {
        const recipient = this.parseRecipient(to)
        const lamports = this.toLamports(amountSol)

        await this.assertCanAfford(recipient, lamports)

        const { blockhash, lastValidBlockHeight } = await withRpcErrors(
            'Fetching a recent blockhash',
            () => this.connection.getLatestBlockhash()
        )

        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: new PublicKey(this.address),
                toPubkey: recipient,
                lamports,
            })
        )
        tx.feePayer = new PublicKey(this.address)
        tx.recentBlockhash = blockhash

        return { tx, blockhash, lastValidBlockHeight }
    }

    private parseRecipient(to: string): PublicKey {
        const trimmed = to.trim()
        if (!isValidSolanaAddress(trimmed)) {
            throw new Error('Enter a valid Solana address.')
        }
        if (trimmed === this.address) {
            throw new Error('That is this wallet\'s own address.')
        }
        return new PublicKey(trimmed)
    }

    private toLamports(amountSol: Big): number {
        if (amountSol.lte(0)) throw new Error('Enter an amount greater than zero.')
        const raw = amountSol.times(LAMPORTS_PER_SOL)
        // Big keeps full precision; a fractional lamport means the user typed
        // more than 9 decimal places, which cannot be represented on chain.
        if (!raw.eq(raw.round(0, 0))) {
            throw new Error('SOL amounts cannot have more than 9 decimal places.')
        }
        return Number(raw.toFixed(0))
    }

    /**
     * Rejects a transfer that would fail on chain, with a message naming the
     * actual problem.
     *
     * Two distinct failures both surface as unhelpful runtime errors otherwise:
     * the sender not covering amount + fee, and the *recipient* being a new
     * account left below the rent-exempt minimum (which reads like the sender
     * is short, and is a common first-transfer surprise).
     */
    private async assertCanAfford(recipient: PublicKey, lamports: number): Promise<void> {
        const [balance, recipientInfo, rentExempt] = await Promise.all([
            withRpcErrors('Checking balance', () =>
                this.connection.getBalance(new PublicKey(this.address))
            ),
            withRpcErrors('Checking the recipient account', () =>
                this.connection.getAccountInfo(recipient)
            ),
            this.connection
                .getMinimumBalanceForRentExemption(0)
                .catch(() => FALLBACK_RENT_EXEMPT_LAMPORTS),
        ])

        const needed = lamports + BASE_FEE_LAMPORTS
        if (balance < needed) {
            const short = Big(needed - balance).div(LAMPORTS_PER_SOL)
            throw new Error(
                `Not enough SOL. This transfer needs ${Big(needed)
                    .div(LAMPORTS_PER_SOL)
                    .toString()} SOL including the fee — ${short.toString()} SOL short.`
            )
        }

        if (!recipientInfo && lamports < rentExempt) {
            throw new Error(
                `That address has no account on ${this.network.name} yet, so this transfer ` +
                    `must be at least ${Big(rentExempt)
                        .div(LAMPORTS_PER_SOL)
                        .toString()} SOL to create it (the rent-exempt minimum).`
            )
        }
    }
}

/**
 * A wallet backed by a browser extension.
 *
 * The extension owns the key and prompts for every signature, so nothing here
 * touches key material and `authorizeWalletOp` lets it through without a
 * session password (its `type` is `injected`).
 */
export class InjectedSolanaWallet extends SolanaWallet {
    readonly accessMethodId = 'injected'
    readonly isReadonly = false
    readonly native: SolanaProvider
    /** Which extension this is, for error messages. */
    readonly providerName: string

    constructor(opts: {
        address: string
        network: SolanaNetwork
        provider: SolanaProvider
        providerName: string
    }) {
        super(opts.address, opts.network)
        this.native = opts.provider
        this.providerName = opts.providerName
    }

    async signMessage(message: string): Promise<string> {
        const encoded = new TextEncoder().encode(message)
        // 'utf8' so the approval popup shows readable text rather than hex.
        const { signature } = await this.native.signMessage(encoded, 'utf8')
        return bs58.encode(signature)
    }

    async sendSol(to: string, amountSol: Big): Promise<string> {
        const { tx } = await this.buildTransfer(to, amountSol)
        // The extension signs AND submits — asking it to only sign and then
        // broadcasting here would double-submit on wallets that do both.
        const { signature } = await this.native.signAndSendTransaction(tx)
        return signature
    }
}

/**
 * A wallet whose key this app holds, encrypted at rest in a `SessionVault`.
 *
 * The key exists in plaintext only inside `withSigningSeed`, for the duration
 * of one signature, and is wiped on both the success and error paths. Two
 * secret shapes are supported, mirroring how the wallet was created:
 *
 *   `seed`  a BIP-39 seed — the ed25519 key is re-derived at `derivationPath`
 *           for each signature rather than stored.
 *   `pk`    a raw 32-byte ed25519 seed, from an imported private key.
 *
 * The derivation path is not secret and is held in the clear; it is needed to
 * reproduce the same account and reveals nothing without the seed.
 */
export class LocalSolanaWallet extends SolanaWallet {
    readonly accessMethodId: 'mnemonic' | 'privatekey'
    readonly isReadonly = false
    readonly native = null
    readonly vault: SessionVault
    /** Only set for `mnemonic` wallets. */
    readonly derivationPath: string | null

    constructor(opts: {
        address: string
        network: SolanaNetwork
        vault: SessionVault
        accessMethodId: 'mnemonic' | 'privatekey'
        derivationPath?: string | null
    }) {
        super(opts.address, opts.network)
        this.vault = opts.vault
        this.accessMethodId = opts.accessMethodId
        this.derivationPath = opts.derivationPath ?? null
    }

    /**
     * Materialises the 32-byte ed25519 seed inside an authorized scope, hands
     * it to `fn`, and wipes it however `fn` settles.
     *
     * `requireAuth(this.vault)` is the invariant that keeps this behind the
     * password: reaching a signing primitive outside `authorizeWalletOp`
     * throws rather than silently signing.
     */
    private async withSigningSeed<T>(fn: (seed: Uint8Array) => Promise<T> | T): Promise<T> {
        const auth = requireAuth(this.vault)

        if (this.accessMethodId === 'privatekey') {
            return this.vault.withSecret(auth, 'pk', (seedBytes) => fn(seedBytes))
        }

        const path = this.derivationPath
        if (!path) {
            throw new Error('This wallet is missing its derivation path and cannot sign.')
        }
        return this.vault.withSecret(auth, 'seed', async (bip39Seed) => {
            const seed = await deriveSolanaSeed(bip39Seed, path)
            try {
                return await fn(seed)
            } finally {
                wipe(seed)
            }
        })
    }

    /**
     * Builds the keypair, runs `fn`, then erases the keypair's own copy.
     *
     * `Keypair.fromSeed` copies the seed into its internal secret key, so
     * wiping only the input seed would leave a live copy behind. Note the
     * erasure has to go through `destroySolanaKeypair` — web3.js's public
     * `secretKey` getter hands back a fresh copy each access, so wiping that
     * would zero a throwaway and miss the real one.
     */
    private async withKeypair<T>(fn: (kp: Keypair) => Promise<T> | T): Promise<T> {
        return this.withSigningSeed(async (seed) => {
            const kp = Keypair.fromSeed(seed)
            try {
                return await fn(kp)
            } finally {
                destroySolanaKeypair(kp)
            }
        })
    }

    async signMessage(message: string): Promise<string> {
        const encoded = new TextEncoder().encode(message)
        return this.withSigningSeed((seed) => bs58.encode(ed25519.sign(encoded, seed)))
    }

    async sendSol(to: string, amountSol: Big): Promise<string> {
        const { tx, blockhash, lastValidBlockHeight } = await this.buildTransfer(to, amountSol)

        const raw = await this.withKeypair((kp) => {
            tx.sign(kp)
            return tx.serialize()
        })

        const signature = await withRpcErrors('Broadcasting the transaction', () =>
            this.connection.sendRawTransaction(raw, { preflightCommitment: 'confirmed' })
        )

        // Confirm against the same blockhash the transaction was built on, so
        // a dropped transaction surfaces as an error instead of appearing to
        // succeed and then never landing.
        await withRpcErrors('Confirming the transaction', () =>
            this.connection.confirmTransaction(
                { signature, blockhash, lastValidBlockHeight },
                'confirmed'
            )
        )

        return signature
    }
}

/** Watch-only. Balances render; nothing can be signed. */
export class WatchSolanaWallet extends SolanaWallet {
    readonly accessMethodId = 'watch'
    readonly isReadonly = true
    readonly native = null

    constructor(opts: { address: string; network: SolanaNetwork }) {
        super(opts.address, opts.network)
    }

    async signMessage(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot sign.')
    }

    async sendSol(): Promise<string> {
        throw new Error('This wallet is watch-only and cannot send.')
    }
}

/**
 * Connects the injected extension.
 *
 * `onlyIfTrusted` is deliberately NOT used: this runs from an explicit
 * "Connect" click, so prompting is correct. That option is for silent
 * reconnection on page load, which this app does not do — a wallet session
 * should not survive a reload without the user asking for it.
 */
export async function connectInjectedSolana(
    network: SolanaNetwork,
    detected: { provider: SolanaProvider; name: string }
): Promise<InjectedSolanaWallet> {
    const { publicKey } = await detected.provider.connect()
    const address = publicKey?.toString()
    if (!address) {
        throw new Error(`${detected.name} did not return an account.`)
    }

    return new InjectedSolanaWallet({
        address,
        network,
        provider: detected.provider,
        providerName: detected.name,
    })
}
