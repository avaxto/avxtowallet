/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Bitcoin networks and address types.
 *
 * Bitcoin has no public JSON-RPC the way Solana does — a node's RPC is
 * authenticated and not exposed to the internet — so balances, UTXOs, fees and
 * broadcast all go through an **Esplora** REST endpoint (Blockstream's
 * reference implementation, which mempool.space also serves). That is the
 * closest thing to a standard public read API Bitcoin has.
 */
import * as bitcoin from 'bitcoinjs-lib'

/**
 * The four address encodings this wallet derives.
 *
 * All four are the *same key* presented differently, but each has its own
 * BIP-44-style purpose, so they derive at different paths and produce
 * different addresses. A wallet that knows only one shows an empty account to
 * anyone whose funds are on another — see ./discovery.ts.
 *
 *   `p2wpkh`       BIP84, `bc1q…`  Native SegWit. The modern default: cheapest
 *                                  to spend and supported everywhere by now.
 *   `p2sh-p2wpkh`  BIP49, `3…`     SegWit wrapped in P2SH, for compatibility
 *                                  with software that never learned bech32.
 *   `p2pkh`        BIP44, `1…`     Legacy. Most expensive to spend.
 *   `p2tr`         BIP86, `bc1p…`  Taproot.
 */
export type BtcAddressType = 'p2wpkh' | 'p2sh-p2wpkh' | 'p2pkh' | 'p2tr'

/** Every type, in the order the UI should prefer them. */
export const ADDRESS_TYPES: BtcAddressType[] = ['p2wpkh', 'p2sh-p2wpkh', 'p2pkh', 'p2tr']

export const ADDRESS_TYPE_INFO: Record<
    BtcAddressType,
    { label: string; shortLabel: string; purpose: number; example: string }
> = {
    'p2wpkh': {
        label: 'Native SegWit',
        shortLabel: 'SegWit',
        purpose: 84,
        example: 'bc1q…',
    },
    'p2sh-p2wpkh': {
        label: 'Nested SegWit',
        shortLabel: 'Nested',
        purpose: 49,
        example: '3…',
    },
    'p2pkh': {
        label: 'Legacy',
        shortLabel: 'Legacy',
        purpose: 44,
        example: '1…',
    },
    'p2tr': {
        label: 'Taproot',
        shortLabel: 'Taproot',
        purpose: 86,
        example: 'bc1p…',
    },
}

/** The default for a brand-new wallet with no history to discover. */
export const DEFAULT_ADDRESS_TYPE: BtcAddressType = 'p2wpkh'

/** BTC is always 8 decimals — 1 BTC = 100,000,000 satoshis. */
export const SATS_PER_BTC = 100_000_000
export const BTC_DECIMALS = 8

export interface BitcoinNetwork {
    id: string
    name: string
    isTestnet: boolean
    /** Esplora REST base, no trailing slash. May be a user override. */
    esploraUrl: string
    /** The default endpoint, kept so the UI can show what an override replaced. */
    defaultEsploraUrl: string
    /** Block explorer base for building tx/address links. */
    explorerUrl: string
    /**
     * SLIP-44 coin type. 0 for mainnet, 1 for ALL testnets — this is what puts
     * testnet keys on a different derivation path so a phrase cannot
     * accidentally control real funds at the same indices.
     */
    coinType: number
    /** bitcoinjs-lib's network parameters (address version bytes, bech32 hrp). */
    params: bitcoin.Network
    native: { symbol: string; name: string; decimals: number }
}

const ESPLORA_OVERRIDE_PREFIX = 'bitcoin_esplora_'

const BASE_NETWORKS: readonly BitcoinNetwork[] = [
    {
        id: 'mainnet',
        name: 'Mainnet',
        isTestnet: false,
        esploraUrl: 'https://blockstream.info/api',
        defaultEsploraUrl: 'https://blockstream.info/api',
        explorerUrl: 'https://blockstream.info',
        coinType: 0,
        params: bitcoin.networks.bitcoin,
        native: { symbol: 'BTC', name: 'Bitcoin', decimals: BTC_DECIMALS },
    },
    {
        id: 'testnet',
        name: 'Testnet',
        isTestnet: true,
        esploraUrl: 'https://blockstream.info/testnet/api',
        defaultEsploraUrl: 'https://blockstream.info/testnet/api',
        explorerUrl: 'https://blockstream.info/testnet',
        coinType: 1,
        params: bitcoin.networks.testnet,
        native: { symbol: 'tBTC', name: 'Test Bitcoin', decimals: BTC_DECIMALS },
    },
]

function readOverride(id: string): string | null {
    try {
        const raw = localStorage.getItem(ESPLORA_OVERRIDE_PREFIX + id)
        if (!raw) return null
        const url = new URL(raw)
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
        return raw.replace(/\/+$/, '')
    } catch {
        return null
    }
}

export function getBitcoinNetworks(): BitcoinNetwork[] {
    return BASE_NETWORKS.map((n) => {
        const override = readOverride(n.id)
        return override ? { ...n, esploraUrl: override } : { ...n }
    })
}

export function getBitcoinNetworkById(id: string): BitcoinNetwork | undefined {
    return getBitcoinNetworks().find((n) => n.id === id)
}

/** Points a network at a different Esplora endpoint. null restores the default. */
export function setEsploraOverride(id: string, url: string | null): void {
    if (!BASE_NETWORKS.some((n) => n.id === id)) {
        throw new Error(`Unknown Bitcoin network: ${id}`)
    }
    try {
        if (url === null) {
            localStorage.removeItem(ESPLORA_OVERRIDE_PREFIX + id)
            return
        }
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            throw new Error('Endpoint must be an http(s) URL.')
        }
        localStorage.setItem(ESPLORA_OVERRIDE_PREFIX + id, url.replace(/\/+$/, ''))
    } catch (e) {
        if (e instanceof TypeError) throw new Error('That is not a valid URL.')
        throw e
    }
}

export function getBitcoinTxUrl(txid: string, network: BitcoinNetwork): string {
    return `${network.explorerUrl}/tx/${txid}`
}

export function getBitcoinAddressUrl(address: string, network: BitcoinNetwork): string {
    return `${network.explorerUrl}/address/${address}`
}
