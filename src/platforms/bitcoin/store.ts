/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin platform session state: the selected network and connected wallet.
 *
 * Separate from `@/stores/main` (Avalanche's) for the same reason the EVM and
 * Solana platforms keep their own — that store models X/P addresses and
 * Avalanche HD key state, none of which apply here.
 */
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef } from 'vue'
import Big from 'big.js'
import * as bip39 from 'bip39'

import router from '@/router'
import type { PlatformWallet } from '../types'
import { useActivePlatformStore } from '../store'
import { SessionVault } from '@/js/security/SessionVault'
import { AuthHandle, AuthScope } from '@/js/security/session'
import { wipe } from '@/js/security/memory'
import {
    DEFAULT_ADDRESS_TYPE,
    SATS_PER_BTC,
    getBitcoinNetworkById,
    getBitcoinNetworks,
    type BitcoinNetwork,
    type BtcAddressType,
} from '@/bitcoin/networks'
import {
    addressFromPublicKey,
    bip32,
    deriveAccountNode,
    destroyNode,
    parseAccountXpub,
    parseWif,
} from '@/bitcoin/keys'
import { pickAddressType, probeAddressTypes } from '@/bitcoin/discovery'
import { getFeeEstimates } from '@/bitcoin/esplora'
import {
    BitcoinWallet,
    HdBitcoinWallet,
    WatchAddressBitcoinWallet,
    WatchBitcoinWallet,
    WifBitcoinWallet,
} from './wallet'

const NETWORK_STORAGE_KEY = 'bitcoin_active_network'
const DEFAULT_NETWORK_ID = 'mainnet'

/**
 * Fallback fee rate in sat/vB, used only when the indexer's estimate is
 * unavailable. Deliberately not 1: a 1 sat/vB transaction can sit unconfirmed
 * for days, and a user who cannot see why would reasonably conclude the wallet
 * is broken.
 */
const FALLBACK_FEE_RATE = 5

/** Confirmation targets offered in the send form, in blocks. */
export const FEE_TARGETS = [
    { blocks: 1, label: 'Fast', detail: '~10 min' },
    { blocks: 6, label: 'Normal', detail: '~1 hour' },
    { blocks: 144, label: 'Economy', detail: '~1 day' },
] as const

let activeWalletRef: BitcoinWallet | null = null
let activeNetworkRef: BitcoinNetwork | null = null

export function peekActiveWallet(): PlatformWallet | null {
    return activeWalletRef
}

export function peekActiveNetwork(): BitcoinNetwork | null {
    return activeNetworkRef ?? resolveInitialNetwork()
}

function resolveInitialNetwork(): BitcoinNetwork {
    let savedId: string | null = null
    try {
        savedId = localStorage.getItem(NETWORK_STORAGE_KEY)
    } catch {
        /* storage unavailable — fall through to the default */
    }
    return (
        (savedId ? getBitcoinNetworkById(savedId) : undefined) ??
        getBitcoinNetworkById(DEFAULT_NETWORK_ID) ??
        getBitcoinNetworks()[0]
    )
}

/**
 * Builds a vault holding one secret. Mirrors the Solana platform's helper —
 * see the note there on why `vault.put` consuming the plaintext means the
 * caller must not reuse the buffer, and why a failure before `put` still has
 * to wipe.
 */
async function vaultWith(
    secretName: 'seed' | 'pk',
    plaintext: Uint8Array,
    password: string
): Promise<SessionVault> {
    const vault = markRaw(new SessionVault())
    let stored = false
    try {
        const key = await vault.deriveKey(password)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
        try {
            await vault.put(auth, secretName, plaintext)
            stored = true
            return vault
        } finally {
            auth.dispose()
        }
    } finally {
        if (!stored) wipe(plaintext)
    }
}

export const useBitcoinStore = defineStore('bitcoin', () => {
    // shallowRef: the wallet holds a SessionVault, and deep reactivity would
    // proxy the CryptoKey inside it, failing WebCrypto's brand check.
    const wallet = shallowRef<BitcoinWallet | null>(null)
    const network = shallowRef<BitcoinNetwork>(resolveInitialNetwork())
    const isConnecting = ref(false)
    const isScanning = ref(false)

    activeNetworkRef = network.value

    const isAuth = computed(() => wallet.value !== null)
    const networks = computed(() => getBitcoinNetworks())

    /** Balance in BTC, for the balance card and send form. */
    const balanceBtc = shallowRef<Big>(Big(0))
    /** Bumped whenever a scan completes, so views re-read the wallet's data. */
    const scanEpoch = ref(0)

    const refreshBalance = async (): Promise<void> => {
        const w = wallet.value
        if (!w) {
            balanceBtc.value = Big(0)
            return
        }
        isScanning.value = true
        try {
            await w.refresh()
            balanceBtc.value = Big(w.balanceSats).div(SATS_PER_BTC)
            scanEpoch.value++
        } catch (e) {
            console.warn('[bitcoin/store] Balance scan failed:', e)
        } finally {
            isScanning.value = false
        }
    }

    const setWallet = (w: BitcoinWallet | null): void => {
        wallet.value = w
        activeWalletRef = w
        useActivePlatformStore().notifyWalletChanged()
        balanceBtc.value = Big(0)
        void refreshBalance()
    }

    const applyNetwork = (next: BitcoinNetwork): void => {
        network.value = next
        activeNetworkRef = next
        try {
            localStorage.setItem(NETWORK_STORAGE_KEY, next.id)
        } catch {
            /* persistence is a convenience, not a requirement */
        }
    }

    // ---- Fee rates ----

    const feeRates = shallowRef<Record<number, number>>({})

    /**
     * Loads current fee estimates.
     *
     * Falls back rather than throwing: a missing estimate must not block a
     * send outright, and the form lets the rate be typed in by hand.
     */
    const refreshFeeRates = async (): Promise<void> => {
        try {
            const estimates = await getFeeEstimates(network.value)
            const out: Record<number, number> = {}
            for (const { blocks } of FEE_TARGETS) {
                const raw = estimates[String(blocks)]
                // Esplora reports sub-1 sat/vB on quiet chains, but the relay
                // floor is 1 — anything lower simply will not propagate.
                out[blocks] = Math.max(1, Number.isFinite(raw) ? raw : FALLBACK_FEE_RATE)
            }
            feeRates.value = out
        } catch (e) {
            console.warn('[bitcoin/store] Fee estimate fetch failed:', e)
            feeRates.value = Object.fromEntries(
                FEE_TARGETS.map((t) => [t.blocks, FALLBACK_FEE_RATE])
            )
        }
    }

    // ---- Access methods ----

    /**
     * Imports a BIP-39 recovery phrase.
     *
     * Probes all four address types before opening the wallet so a phrase set
     * up in a legacy or taproot wallet does not present as empty — the same
     * problem, and the same fix, as the Solana derivation-path scan.
     */
    const accessWithMnemonic = async (
        mnemonic: string,
        sessionPassword: string
    ): Promise<void> => {
        const phrase = mnemonic.trim().replace(/\s+/g, ' ').toLowerCase()
        if (!bip39.validateMnemonic(phrase)) {
            throw new Error(
                'That is not a valid BIP-39 recovery phrase. Check the word list and order.'
            )
        }

        isConnecting.value = true
        const seed = new Uint8Array(await bip39.mnemonicToSeed(phrase))

        try {
            const net = network.value

            const probes = await probeAddressTypes(
                (type) => deriveAccountNode(seed, type, net).neutered(),
                net
            )
            const chosenType = pickAddressType(probes, DEFAULT_ADDRESS_TYPE)

            // Public node only — the wallet scans with this and never needs a
            // private key except inside an authorized signing scope.
            const signing = deriveAccountNode(seed, chosenType, net)
            const accountNode = signing.neutered()
            destroyNode(signing)

            // vaultWith consumes and wipes `seed`.
            const vault = await vaultWith('seed', seed, sessionPassword)

            setWallet(
                new HdBitcoinWallet({
                    network: net,
                    addressType: chosenType,
                    accountNode,
                    vault,
                })
            )
            void refreshFeeRates()
            router.push('/wallet')
        } catch (e) {
            wipe(seed)
            throw e
        } finally {
            isConnecting.value = false
        }
    }

    /** Imports a single WIF private key. */
    const accessWithPrivateKey = async (
        wif: string,
        sessionPassword: string,
        addressType: BtcAddressType = DEFAULT_ADDRESS_TYPE
    ): Promise<void> => {
        isConnecting.value = true
        try {
            const net = network.value
            const pair = parseWif(wif, net)
            const address = addressFromPublicKey(pair.publicKey, addressType, net)

            // Copy out before wiping the pair's own buffer.
            const priv = Uint8Array.from(pair.privateKey!)
            wipe(pair.privateKey as Uint8Array)

            // vaultWith consumes and wipes `priv`.
            const vault = await vaultWith('pk', priv, sessionPassword)

            setWallet(new WifBitcoinWallet({ network: net, addressType, address, vault }))
            void refreshFeeRates()
            router.push('/wallet')
        } finally {
            isConnecting.value = false
        }
    }

    /**
     * Watch-only access from an extended public key (full HD scanning) or a
     * single address.
     */
    const accessWatchOnly = async (
        input: string,
        addressType: BtcAddressType = DEFAULT_ADDRESS_TYPE
    ): Promise<void> => {
        const trimmed = input.trim()
        const net = network.value

        isConnecting.value = true
        try {
            if (/^([xyz]pub|[tuv]pub)/i.test(trimmed)) {
                const accountNode = parseAccountXpub(trimmed, net)
                setWallet(
                    new WatchBitcoinWallet({ network: net, addressType, accountNode })
                )
            } else {
                setWallet(new WatchAddressBitcoinWallet({ network: net, address: trimmed }))
            }
            router.push('/wallet')
        } finally {
            isConnecting.value = false
        }
    }

    // ---- Session ----

    const setNetwork = async (id: string): Promise<void> => {
        const next = getBitcoinNetworkById(id)
        if (!next) throw new Error(`Unknown Bitcoin network: ${id}`)
        if (next.id === network.value.id) return

        applyNetwork(next)

        // Unlike a cluster switch on Solana, a Bitcoin network change moves to
        // an entirely different derivation path (coin type 0 vs 1), so the
        // connected wallet's keys do not carry over. Disconnecting is the
        // honest outcome: silently keeping a mainnet wallet attached while the
        // app reads testnet would show a permanently empty balance.
        if (wallet.value) {
            disconnect()
            return
        }
        void refreshFeeRates()
    }

    const disconnect = (): void => {
        const current = wallet.value
        if (current && 'vault' in current) {
            ;(current as { vault: SessionVault }).vault.clear()
        }
        setWallet(null)
        balanceBtc.value = Big(0)
        window.location.href = '/'
    }

    return {
        wallet,
        network,
        networks,
        isConnecting,
        isScanning,
        isAuth,
        balanceBtc,
        scanEpoch,
        feeRates,
        refreshBalance,
        refreshFeeRates,
        accessWithMnemonic,
        accessWithPrivateKey,
        accessWatchOnly,
        setNetwork,
        disconnect,
    }
})

export { bip32 }
