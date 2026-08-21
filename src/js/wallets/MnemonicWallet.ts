// A simple wrapper thar combines avalanche.js, bip39 and HDWallet

import {
    KeyPair as AVMKeyPair,
    KeyChain as AVMKeyChain,
    UTXOSet as AVMUTXOSet,
    TransferableInput,
    TransferableOutput,
    BaseTx,
    UnsignedTx as AVMUnsignedTx,
    Tx as AVMTx,
    UTXO as AVMUTXO,
    AssetAmountDestination,
    UTXOSet,
} from '@/avalanche/apis/avm'

import { privateToAddress, importPublic, publicToAddress } from 'ethereumjs-util'

import {
    KeyChain as PlatformVMKeyChain,
    UnsignedTx as PlatformUnsignedTx,
    UTXO as PlatformUTXO,
    Tx as PlatformTx,
} from '@/avalanche/apis/platformvm'

import {
    KeyChain as EVMKeyChain,
    UnsignedTx as EVMUnsignedTx,
    UTXOSet as EVMUTXOSet,
    Tx as EvmTx,
} from '@/avalanche/apis/evm'
import { getPreferredHRP, PayloadBase } from '@/avalanche/utils'

import * as bip39 from 'bip39'
import { BN, Buffer as BufferAvalanche } from '@/avalanche'
import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { AvmExportChainType, AvmImportChainType, IAvaHdWallet } from '@/js/wallets/types'
import HDKey from 'hdkey'
import { ITransaction } from '@/components/wallet/transfer/types'
import { AbstractHdWallet, RequiredKeyIndices } from '@/js/wallets/AbstractHdWallet'
import { hd, hdFromExtendedKey, wipeNode } from '@/js/hdkeyExtras'
import { WalletNameType } from '@/js/wallets/types'
import { digestMessage } from '@/helpers/helper'
import { KeyChain } from '@/avalanche/apis/evm'
import Erc20Token from '@/js/Erc20Token'
import { WalletHelper } from '@/helpers/wallet_helper'
import { Transaction } from '@ethereumjs/tx'
import {
    ExportChainsC,
    ExportChainsP,
    TxHelper,
    UtxoHelper,
    chainIdFromAlias,
} from '@/avalanche-wallet-sdk'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { markRaw } from 'vue'
// Node-style Buffer, as hdkey and bip39 expect. Same import the SDK's Ledger
// wallet uses; `globalThis.Buffer` is only usable as a type here.
import { Buffer as BufferNative } from 'buffer'
import { SessionVault } from '@/js/security/SessionVault'
import { AuthHandle, AuthScope, requireAuth } from '@/js/security/session'
import { secretFromString, secretToString, wipe } from '@/js/security/memory'
import { privateKeyToXPAccount } from '@avalanche-sdk/client/accounts'
import { AVA_ACCOUNT_PATH, ETH_ACCOUNT_PATH, LEDGER_ETH_ACCOUNT_PATH } from '@/js/wallets/constants'

export { AVA_ACCOUNT_PATH, ETH_ACCOUNT_PATH, LEDGER_ETH_ACCOUNT_PATH }

// HD WALLET
// Accounts are not used and the account index is fixed to 0
// m / purpose' / coin_type' / account' / change / address_index

export default class MnemonicWallet extends AbstractHdWallet implements IAvaHdWallet {
    isLoading: boolean
    type: WalletNameType
    ethAddress: string

    /**
     * Holds this wallet's mnemonic and seed as ciphertext. Nothing here can be
     * read without an AuthHandle, which only exists inside withAuthorization.
     * markRaw so Vue's deep reactivity (see stores/main.ts) never proxies the
     * blobs or reaches a CryptoKey.
     */
    readonly vault: SessionVault

    // TODO : Move to hd core class
    onnetworkchange() {
        super.onnetworkchange()
        // No EVM keychain to rebuild — it is derived per signature now. The
        // EVM address is HRP-independent, so nothing else changes.
        this.ethBalance = new BN(0)
    }

    /**
     * Builds a wallet from a mnemonic, encrypting its secrets under the session
     * password before returning.
     *
     * Async because encryption is: the constructor cannot do this itself.
     * Callers must use this rather than `new`.
     */
    static async create(mnemonic: string, password: string): Promise<MnemonicWallet> {
        if (!bip39.validateMnemonic(mnemonic)) {
            throw new Error('Invalid mnemonic phrase.')
        }

        const vault = markRaw(new SessionVault())
        const key = await vault.deriveKey(password)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)

        const seed: globalThis.Buffer = bip39.mnemonicToSeedSync(mnemonic)

        try {
            const wallet = new MnemonicWallet(seed, vault)
            await vault.put(auth, 'mnemonic', secretFromString(mnemonic))
            // put() wipes what it is given, so hand it a copy — `seed` is still
            // needed above and is wiped in the finally.
            await vault.put(auth, 'seed', new Uint8Array(seed))
            return wallet
        } finally {
            wipe(seed)
            auth.dispose()
        }
    }

    /**
     * The X and C receive addresses for a mnemonic, without building a wallet
     * or a vault. For flows that need to show where funds will land (the
     * migration wizard) but never sign with the key.
     *
     * Derives, reads the addresses, and wipes — nothing is retained.
     */
    static deriveReceiveAddresses(
        mnemonic: string
    ): {
        xAddress: string
        pAddress: string
        cAddress: string
    } {
        const seed: globalThis.Buffer = bip39.mnemonicToSeedSync(mnemonic)
        const master = HDKey.fromMasterSeed(seed)
        const account = master.derive(AVA_ACCOUNT_PATH)
        const ethNode = master.derive(ETH_ACCOUNT_PATH + '/0/0')

        try {
            const firstX = account.derive('m/0/0')
            try {
                const pubKeyBuf = BufferAvalanche.from(firstX.publicKey.toString('hex'), 'hex')
                const addrBuf = AVMKeyPair.addressFromPublicKey(pubKeyBuf)
                const hrp = getPreferredHRP(ava.getNetworkID())
                const chainId = avm.getBlockchainAlias() || avm.getBlockchainID()

                // X and P share the m/0/0 key — only the chain prefix differs.
                return {
                    xAddress: bintools.addressToString(hrp, chainId, addrBuf),
                    pAddress: bintools.addressToString(hrp, 'P', addrBuf),
                    cAddress:
                        '0x' + publicToAddress(importPublic(ethNode.publicKey)).toString('hex'),
                }
            } finally {
                wipeNode(firstX)
            }
        } finally {
            wipeNode(ethNode)
            wipeNode(account)
            wipeNode(master)
            wipe(seed)
        }
    }

    /**
     * Private: use MnemonicWallet.create().
     *
     * Retains only public material. The seed is consumed here to derive the
     * account/EVM nodes and is neutered before anything is stored, so a
     * constructed wallet holds no key capable of signing.
     */
    private constructor(seed: globalThis.Buffer, vault: SessionVault) {
        const masterHdKey: HDKey = HDKey.fromMasterSeed(seed)
        const accountHdKey = masterHdKey.derive(AVA_ACCOUNT_PATH)
        const ethAccountKey = masterHdKey.derive(ETH_ACCOUNT_PATH + '/0/0')

        // Neuter before handing to super. Round-tripping the extended public
        // key preserves depth/index/parentFingerprint, so getXpubXP() still
        // reports the real xpub — unlike rebuilding a bare HDKey from
        // publicKey + chainCode.
        const accountPub = hdFromExtendedKey(hd(accountHdKey).publicExtendedKey)
        const ethPub = hdFromExtendedKey(hd(ethAccountKey).publicExtendedKey)

        // isPublic: the HD helpers derive addresses only and will throw if
        // asked for a private key.
        super(accountPub, ethPub, true)

        this.ethAddress = publicToAddress(importPublic(ethAccountKey.publicKey)).toString('hex')
        this.type = 'mnemonic'
        this.vault = vault
        this.isLoading = false

        // The only private material that existed in this scope.
        wipeNode(ethAccountKey)
        wipeNode(accountHdKey)
        wipeNode(masterHdKey)
    }

    /**
     * Rebuilds the BIP32 master node from the vaulted seed for the duration of
     * `fn`, then wipes it. Every signing path goes through here.
     */
    private async withMasterKey<T>(fn: (master: HDKey) => Promise<T> | T): Promise<T> {
        const auth = requireAuth(this.vault)

        return this.vault.withSecret(auth, 'seed', async (seedBytes) => {
            const master = HDKey.fromMasterSeed(BufferNative.from(seedBytes) as globalThis.Buffer)
            try {
                return await fn(master)
            } finally {
                wipeNode(master)
            }
        })
    }

    /** Derives the EVM key for one operation and wipes it after. */
    private async withEvmPrivateKey<T>(
        fn: (privateKey: globalThis.Buffer) => Promise<T> | T
    ): Promise<T> {
        return this.withMasterKey(async (master) => {
            const node = master.derive(ETH_ACCOUNT_PATH + '/0/0')
            try {
                return await fn(node.privateKey)
            } finally {
                wipeNode(node)
            }
        })
    }

    getEvmAddress(): string {
        return this.ethAddress
    }

    async sendEth(to: string, amount: BN, gasPrice: BN, gasLimit: number) {
        return await WalletHelper.sendEth(this, to, amount, gasPrice, gasLimit)
    }

    async estimateGas(to: string, amount: BN, token: Erc20Token): Promise<number> {
        return await WalletHelper.estimateGas(this, to, amount, token)
    }

    async sendERC20(
        to: string,
        amount: BN,
        gasPrice: BN,
        gasLimit: number,
        token: Erc20Token
    ): Promise<string> {
        return await WalletHelper.sendErc20(this, to, amount, gasPrice, gasLimit, token)
    }

    async getUTXOs(): Promise<void> {
        // Latch the spinner for the whole refresh — the scans, the stake and
        // the eth balance — so it can't stop partway and flash a partial
        // balance. See balanceRefreshDepth in AbstractWallet.
        this.balanceRefreshDepth++
        this.isFetchingUtxos = true
        try {
            await this.waitUntilHdScanComplete()

            // UTXO scans first (heavy, sequential to stay under the API rate
            // limit), then the two light balance calls. Everything is awaited so
            // ERC20 token balance updates (triggered by the caller afterwards)
            // only start once X, P and C chain balances are in.
            await super.getUTXOs()
            await Promise.all([this.getStake(), this.getEthBalance()])
        } finally {
            this.balanceRefreshDepth--
            this.updateFetchState()
        }
    }

    /**
     * Returns the mnemonic phrase of this wallet.
     *
     * Requires an open authorization — the phrase is the wallet's root secret,
     * so revealing, printing or exporting it is gated exactly like signing.
     *
     * The returned string cannot be wiped; keep its lifetime as short as
     * possible at the call site.
     */
    async getMnemonic(): Promise<string> {
        const auth = requireAuth(this.vault)
        return this.vault.withSecret(auth, 'mnemonic', (pt) => secretToString(pt))
    }

    /**
     * The C-chain private key as hex, for the "reveal private key" screen.
     * Requires an open authorization. Like getMnemonic, the returned string
     * cannot be wiped — keep its lifetime short.
     */
    async getEvmPrivateKeyHex(): Promise<string> {
        return this.withEvmPrivateKey((privateKey) => privateKey.toString('hex'))
    }

    /**
     * The X/P private key at a derivation index, in AvalancheJS's
     * `PrivateKey-...` form, for the "reveal private key" screen.
     * `change` is 0 for receive/platform addresses (m/0) and 1 for change (m/1).
     */
    async getPrivateKeyStringForIndex(change: 0 | 1, index: number): Promise<string> {
        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            const node = account.derive(`m/${change}/${index}`)
            try {
                const keychain = new AVMKeyChain(getPreferredHRP(ava.getNetworkID()), this.chainId)
                const key = keychain.importKey(BufferAvalanche.from(node.privateKey)) as AVMKeyPair
                return key.getPrivateKeyString()
            } finally {
                wipeNode(node)
                wipeNode(account)
            }
        })
    }

    /**
     * Derives an arbitrary BIP32 path from the master key, for the address
     * derivation tool. Only needed for paths the neutered account node cannot
     * reach (hardened segments, or anything above the account level) — the
     * tool resolves account-relative paths itself without a password.
     *
     * Returns public data only.
     */
    async getPublicKeyForPath(path: string): Promise<globalThis.Buffer> {
        return this.withMasterKey((master) => {
            const node = master.derive(path)
            try {
                return BufferNative.from(node.publicKey) as globalThis.Buffer
            } finally {
                wipeNode(node)
            }
        })
    }

    async issueBatchTx(
        orders: (ITransaction | AVMUTXO)[],
        addr: string,
        memo: BufferAvalanche | undefined
    ): Promise<string> {
        return await WalletHelper.issueBatchTx(this, orders, addr, memo)
    }

    /**
     * The indices to derive when the minimal set can't be resolved: everything
     * the helpers know about. An EVM source address on an X/P transaction also
     * falls back, preserving pre-existing behaviour rather than failing.
     */
    private resolveIndices(
        required: RequiredKeyIndices | null
    ): {
        external: number[]
        internal: number[]
    } {
        if (required && !required.needsEvmKey) return required

        const range = (n: number) => Array.from({ length: n + 1 }, (_, i) => i)
        return {
            external: range(Math.max(this.externalHelper.hdIndex, this.platformHelper.hdIndex)),
            internal: range(this.internalHelper.hdIndex),
        }
    }

    /**
     * Derives the requested indices under `account`, hands the keypairs to
     * `build`, and wipes every derived node afterwards.
     *
     * `m/0` serves both X external and P — they share a derivation path, only
     * the keychain wrapper differs.
     */
    private withDerivedKeys<T>(
        account: HDKey,
        build: (keyFor: (change: 0 | 1, index: number) => globalThis.Buffer) => T
    ): T {
        const nodes: HDKey[] = []
        const keyFor = (change: 0 | 1, index: number): globalThis.Buffer => {
            const node = account.derive(`m/${change}/${index}`)
            nodes.push(node)
            return node.privateKey
        }

        try {
            return build(keyFor)
        } finally {
            for (const node of nodes) wipeNode(node)
        }
    }

    /**
     * Signs one 32-byte hash with the key for a single X-chain address.
     *
     * Exists for multisig co-signing (see js/multisig/psat.ts), which needs
     * to fill exactly one signature slot and leave the rest alone. `signX`
     * cannot do that: it hands a keychain to `BaseTx.sign`, which signs
     * every slot on every input and throws a bare TypeError the moment a key
     * is missing — the normal case when only one of several owners is
     * signing.
     *
     * Derives only the one key the address needs and wipes the node
     * afterwards, so this is no more exposed than `signX` is.
     */
    async signHashForXAddress(address: string, hash: BufferAvalanche): Promise<BufferAvalanche> {
        // Throws when the address is not this wallet's — callers check
        // ownership first, so reaching here with a foreign address is a bug.
        const path = this.getPathFromAddress(address)
        const [changeStr, indexStr] = path.split('/')
        const change = Number(changeStr) as 0 | 1
        const index = Number(indexStr)

        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            try {
                return this.withDerivedKeys(account, (keyFor) => {
                    const keychain = new AVMKeyChain(
                        getPreferredHRP(ava.getNetworkID()),
                        this.chainId
                    )
                    const pair = keychain.importKey(
                        BufferAvalanche.from(keyFor(change, index))
                    ) as AVMKeyPair
                    return pair.sign(hash)
                })
            } finally {
                wipeNode(account)
            }
        })
    }

    async signX(unsignedTx: AVMUnsignedTx): Promise<AVMTx> {
        const indices = this.resolveIndices(this.getRequiredKeyIndices(unsignedTx, 'X'))

        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            try {
                return this.withDerivedKeys(account, (keyFor) => {
                    const keychain = new AVMKeyChain(
                        getPreferredHRP(ava.getNetworkID()),
                        this.chainId
                    )
                    for (const i of indices.external) {
                        keychain.importKey(BufferAvalanche.from(keyFor(0, i)))
                    }
                    for (const i of indices.internal) {
                        keychain.importKey(BufferAvalanche.from(keyFor(1, i)))
                    }
                    return unsignedTx.sign(keychain)
                })
            } finally {
                wipeNode(account)
            }
        })
    }

    async signP(unsignedTx: PlatformUnsignedTx): Promise<PlatformTx> {
        const indices = this.resolveIndices(this.getRequiredKeyIndices(unsignedTx, 'P'))

        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            try {
                return this.withDerivedKeys(account, (keyFor) => {
                    const keychain = new PlatformVMKeyChain(
                        getPreferredHRP(ava.getNetworkID()),
                        'P'
                    )
                    // P addresses share m/0 with X external.
                    for (const i of indices.external) {
                        keychain.importKey(BufferAvalanche.from(keyFor(0, i)))
                    }
                    return unsignedTx.sign(keychain)
                })
            } finally {
                wipeNode(account)
            }
        })
    }

    /**
     * Local XPAccounts for the new AddPermissionlessDelegatorTx signing path
     * (see js/permissionlessDelegate.ts) — one per P-chain index this wallet
     * has scanned (0..platformHelper.hdIndex, same set getAllAddressesP()
     * exposes as addresses), so a delegation can spend from AVAX at any of
     * them, not just index 0.
     *
     * The derived hex strings held by the returned accounts' closures can't
     * be wiped (same tradeoff already accepted for getEvmPrivateKeyHex() /
     * getMnemonic() below) — keep the accounts' lifetime short at the call
     * site.
     */
    protected async getXPAccountsForDelegation() {
        const maxIndex = this.platformHelper.hdIndex
        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            try {
                const accounts = []
                // P addresses share m/0 with X external — see signP() above.
                for (let i = 0; i <= maxIndex; i++) {
                    const node = account.derive(`m/0/${i}`)
                    try {
                        const hex = ('0x' + node.privateKey.toString('hex')) as `0x${string}`
                        accounts.push(privateKeyToXPAccount(hex))
                    } finally {
                        wipeNode(node)
                    }
                }
                return accounts
            } finally {
                wipeNode(account)
            }
        })
    }

    async signC(unsignedTx: EVMUnsignedTx): Promise<EvmTx> {
        return this.withEvmPrivateKey((privateKey) => {
            const keyChain = new KeyChain(ava.getHRP(), 'C')
            keyChain.importKey(
                `PrivateKey-` + bintools.cb58Encode(BufferAvalanche.from(privateKey))
            )
            return unsignedTx.sign(keyChain)
        })
    }

    /**
     * Override of AbstractWallet.exportFromPChain.
     *
     * The parent's `xpAccount` branch uses the new SDK's prepareExportTxn +
     * sendXPTransaction, which signs every input with a single key derived from
     * `xpAccount.publicKey` (the account's primary m/0/0 address).  That fails
     * with "failed verifySpend: failed to verify transfer: invalid signature"
     * whenever the wallet's P-chain UTXOs are spread across multiple HD-derived
     * addresses — which is the normal state for mnemonic wallets that have
     * received funds more than once.
     *
     * Bypass the SDK and use the old AvalancheJS path instead: build the
     * ExportTx with the full set of HD-derived P addresses as `fromAddresses`,
     * and sign with `signP`, whose keychain (via `platformHelper.getKeychain()`)
     * already contains every derived P key 0..hdIndex.  `incrementIndex` and
     * the lot-scan in `HdHelper.updateUtxos` keep that keychain in sync with
     * every used HD index, so any UTXO owner the SDK would normally pull in is
     * already signable here.
     */
    async exportFromPChain(
        amt: BN,
        destinationChain: ExportChainsP,
        importFee?: BN
    ): Promise<string> {
        if (destinationChain === 'C' && !importFee) {
            throw new Error('Exports to C chain must specify an import fee.')
        }

        let amtFee = amt.clone()
        if (importFee) {
            amtFee = amt.add(importFee)
        } else if (destinationChain === 'X') {
            amtFee = amt.add(avm.getTxFee())
        }

        const destinationAddr =
            destinationChain === 'C' ? this.getEvmAddressBech() : this.getCurrentAddressAvm()

        const utxoSet = this.getPlatformUTXOSet()
        const sortedSet = sortUTxoSetP(utxoSet, false)
        const pChangeAddr = this.getCurrentAddressPlatform()
        const fromAddrs = this.getAllAddressesP()

        const exportTx = await TxHelper.buildPlatformExportTransaction(
            sortedSet,
            fromAddrs,
            destinationAddr,
            amtFee,
            pChangeAddr,
            destinationChain
        )

        const tx = await this.signP(exportTx)
        return await this.issueP(tx)
    }

    /**
     * Override of AbstractWallet.importToPlatformChain.
     *
     * Same reasoning as `exportFromPChain` above: the SDK path can only sign
     * for a single primary address.  The old AvalancheJS path uses the full
     * P keychain via `signP`, so atomic UTXOs owned by any HD-derived P
     * address can be claimed in a single tx.
     */
    async importToPlatformChain(sourceChain: ExportChainsP): Promise<string> {
        const utxoSet = await this.platformGetAtomicUTXOs(sourceChain)

        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        const sourceChainId = chainIdFromAlias(sourceChain)
        const pToAddr = this.getCurrentAddressPlatform()
        const hrp = ava.getHRP()
        const ownerAddrs = (utxoSet.getAddresses() as any[]).map((addr: any) =>
            bintools.addressToString(hrp, 'P', addr)
        )

        const unsignedTx = await pChain.buildImportTx(
            utxoSet,
            ownerAddrs,
            sourceChainId,
            [pToAddr],
            [pToAddr],
            [pToAddr],
            undefined,
            undefined
        )

        const tx = await this.signP(unsignedTx)
        return this.issueP(tx)
    }

    /** The bech32-C address derived from the keccak256-based EVM bytes
     *  (i.e. the EVM address re-encoded with the "C-" prefix).  Distinct from
     *  `getEvmAddressBech()` which returns the XP-style ripemd160(sha256(pk))
     *  form.  Older buggy exports landed atomic UTXOs at this variant. */
    private getEvmBytesAddressBech(): string {
        return bintools.addressToString(
            ava.getHRP(),
            'C',
            BufferAvalanche.from(this.ethAddress, 'hex')
        )
    }

    /**
     * Override of AbstractWallet.evmGetAtomicUTXOs.
     *
     * Keeps the current behavior — fetching atomic UTXOs at the canonical
     * XP-style bech32-C address (`getEvmAddressBech()` = ripemd160(sha256(pk)))
     * — and additionally queries the EVM-bytes (keccak256) form of the same
     * underlying EVM address.  An older build of this app (and older Core
     * Extension exports) sent X→C / P→C atomic UTXOs to that second form
     * instead of the canonical one; those UTXOs are stranded under Core
     * Extension's signing API but the mnemonic wallet holds the EVM key and
     * can sign for either form locally.
     */
    async evmGetAtomicUTXOs(sourceChain: ExportChainsC): Promise<EVMUTXOSet> {
        const xpStyleBech = this.getEvmAddressBech()
        const evmBytesBech = this.getEvmBytesAddressBech()
        const addrs = [...new Set([xpStyleBech, evmBytesBech])]
        return await UtxoHelper.evmGetAtomicUTXOs(addrs, sourceChain)
    }

    /**
     * Override of AbstractWallet.createImportTxC.
     *
     * Only advertises the XP-style bech32-C address (`getEvmAddressBech()` =
     * ripemd160(sha256(pk))).  This restricts the SDK's internal re-fetch in
     * `cChain.buildImportTx` to UTXOs at that owner — i.e. the only ones whose
     * signature AvalancheGo's atomic-tx verifier will accept from our key.
     * UTXOs at the EVM-bytes (keccak256) form are deliberately excluded here
     * because including them would cause the entire tx to fail verification
     * with "wrong signature: expected X but got Y" — see importToCChain below
     * for the user-facing detection / warning.
     */
    async createImportTxC(sourceChain: ExportChainsC, utxoSet: EVMUTXOSet, fee: BN) {
        const xpStyleBech = this.getEvmAddressBech()
        const hexAddr = this.getEvmAddress()

        const toAddress = '0x' + hexAddr
        const ownerAddresses = [xpStyleBech]
        const fromAddresses = ownerAddresses
        const sourceChainId = chainIdFromAlias(sourceChain)

        return await cChain.buildImportTx(
            utxoSet,
            toAddress,
            ownerAddresses,
            sourceChainId,
            fromAddresses,
            fee
        )
    }

    /**
     * Override of AbstractWallet.importToCChain.
     *
     * Splits the atomic UTXOs returned by `evmGetAtomicUTXOs` into two buckets:
     *
     *   - Signable: UTXOs owned by the XP-style C-chain bech32
     *     (`getEvmAddressBech()` = ripemd160(sha256(compressed_pk))).
     *     AvalancheGo's atomic-tx verifier recomputes this same hash from the
     *     signature's recovered pubkey and matches — so our EVM private key
     *     can sign these and they import normally.
     *
     *   - Stranded: UTXOs owned by the EVM-bytes (keccak256) form, produced by
     *     a legacy buggy export path.  ripemd160(sha256(pk)) and
     *     keccak256(pk_uncompressed)[12:32] can never match for the same key
     *     (different hash functions on the same input — collision probability
     *     is 2^-160), so AvalancheGo will reject any sig we produce with
     *     "wrong signature: expected X but got Y".  These funds are
     *     PERMANENTLY UNRECOVERABLE.  We surface a console.warn so the user
     *     knows the balance is gone, and proceed with the signable subset
     *     instead of letting the whole import fail.
     */
    async importToCChain(
        sourceChain: ExportChainsC,
        fee: BN,
        utxoSet?: EVMUTXOSet
    ): Promise<string> {
        if (!utxoSet) {
            utxoSet = await this.evmGetAtomicUTXOs(sourceChain)
        }

        if (utxoSet.getAllUTXOs().length === 0) {
            throw new Error('Nothing to import.')
        }

        const hrp = ava.getHRP()
        const xpStyleBech = this.getEvmAddressBech()
        const evmBytesBech = this.getEvmBytesAddressBech()

        let signableCount = 0
        let strandedCount = 0
        let strandedTotal = new BN(0)
        for (const u of utxoSet.getAllUTXOs()) {
            const ownerStrs = (u.getOutput().getAddresses() as any[]).map((a: any) =>
                bintools.addressToString(hrp, 'C', a)
            )
            if (ownerStrs.includes(xpStyleBech)) {
                signableCount++
            } else if (ownerStrs.includes(evmBytesBech)) {
                strandedCount++
                const out = u.getOutput() as any
                if (typeof out.getAmount === 'function') {
                    strandedTotal = strandedTotal.add(out.getAmount() as BN)
                }
            }
        }

        if (strandedCount > 0) {
            const msg =
                `Detected ${strandedCount} stranded atomic UTXO(s) totaling ` +
                `${strandedTotal.toString(10)} nAVAX at the EVM-bytes (keccak256) form of ` +
                `your C-chain address (${evmBytesBech}). These are PERMANENTLY ` +
                `UNRECOVERABLE: AvalancheGo's atomic-tx verifier recomputes ` +
                `ripemd160(sha256(pk)) from the signature, but the UTXO owner is ` +
                `keccak256-derived — no key can hash to both forms. An older build of ` +
                `this app produced this destination on X→C / P→C exports.`
            if (signableCount === 0) {
                throw new Error(msg + ' No signable UTXOs found to import.')
            }
            console.warn('[importToCChain]', msg, '— continuing with signable UTXOs only.')
        }

        if (signableCount === 0) {
            throw new Error('Nothing to import.')
        }

        const unsignedTxFee = await this.createImportTxC(sourceChain, utxoSet, fee)
        const tx = await this.signC(unsignedTxFee)
        return this.issueC(tx)
    }

    async signEvm(tx: Transaction) {
        return this.withEvmPrivateKey((privateKey) => tx.sign(privateKey))
    }

    async signHashByExternalIndex(index: number, hash: BufferAvalanche) {
        // Cheapest signing path: one key, at a known index.
        return this.withMasterKey((master) => {
            const account = master.derive(AVA_ACCOUNT_PATH)
            const node = account.derive(`m/0/${index}`)
            try {
                const keychain = new AVMKeyChain(getPreferredHRP(ava.getNetworkID()), this.chainId)
                const key = keychain.importKey(BufferAvalanche.from(node.privateKey)) as AVMKeyPair
                return bintools.cb58Encode(key.sign(hash))
            } finally {
                wipeNode(node)
                wipeNode(account)
            }
        })
    }

    async createNftFamily(name: string, symbol: string, groupNum: number) {
        return await WalletHelper.createNftFamily(this, name, symbol, groupNum)
    }

    async mintNft(mintUtxo: AVMUTXO, payload: PayloadBase, quantity: number) {
        return await WalletHelper.mintNft(this, mintUtxo, payload, quantity)
    }
}
