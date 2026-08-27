/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The fixed list of "every well-known address this phrase could produce" —
 * one shared source of truth for two different consumers:
 *
 *   - `HdBitcoinWallet.deriveKnownSchemes` (the /wallet/btcderive page):
 *     shows these as a comparison table.
 *   - `HdBitcoinWallet`'s own balance scanning: tracks these as ADDITIONAL
 *     spendable addresses alongside the wallet's own primary HD account, so
 *     a balance sitting at, say, the Electrum-style address for this same
 *     phrase is counted and spendable, not silently invisible.
 *
 * Each entry is a fixed, single (receive-index-0) path — not a full
 * gap-limit-scannable account — matching exactly what the derive page shows.
 * See altSchemes.ts for how the Electrum/Bitcoin-Core-legacy conventions
 * were verified, and keys.ts for the Core Wallet path.
 */
import {
    ADDRESS_TYPES,
    ADDRESS_TYPE_INFO,
    type BitcoinNetwork,
    type BtcAddressType,
    type BtcCandidateId,
} from './networks'
import { addressPath, CORE_WALLET_PATH } from './keys'
import { electrumPath, bitcoinCoreLegacyPath } from './altSchemes'

export interface CandidateSpec {
    /**
     * Set only for the 5 entries that overlap with fund-discovery's own
     * candidate set (the 4 standard types + 'core' — see discovery.ts's
     * `pickAddressType`). Used to exclude whichever ONE of those a wallet
     * already tracks as its primary account, so it is not redundantly
     * double-counted as an "extra" address too. The other 5 entries here
     * (Electrum x2, Bitcoin Core legacy x3) never overlap with a primary
     * scheme and so never need excluding.
     */
    id?: BtcCandidateId
    /** Human label, e.g. "Standard (BIP-84)" or "Electrum — Native SegWit". */
    scheme: string
    path: string
    addressType: BtcAddressType
}

export function knownCandidates(network: BitcoinNetwork): CandidateSpec[] {
    const specs: CandidateSpec[] = []

    for (const type of ADDRESS_TYPES) {
        specs.push({
            id: type,
            scheme: `Standard (BIP-${ADDRESS_TYPE_INFO[type].purpose})`,
            path: addressPath(type, network, 0, 'receive', 0),
            addressType: type,
        })
    }

    specs.push({
        id: 'core',
        scheme: 'Core Wallet (same as Avalanche C-Chain key)',
        path: CORE_WALLET_PATH,
        addressType: 'p2wpkh',
    })

    // Same path, different encodings — see altSchemes.ts.
    const electrumReceive = electrumPath('receive')
    specs.push({ scheme: 'Electrum — Legacy', path: electrumReceive, addressType: 'p2pkh' })
    specs.push({ scheme: 'Electrum — Native SegWit', path: electrumReceive, addressType: 'p2wpkh' })

    const coreLegacyReceive = bitcoinCoreLegacyPath('receive')
    specs.push({
        scheme: 'Bitcoin Core (legacy wallet) — Legacy',
        path: coreLegacyReceive,
        addressType: 'p2pkh',
    })
    specs.push({
        scheme: 'Bitcoin Core (legacy wallet) — Nested SegWit',
        path: coreLegacyReceive,
        addressType: 'p2sh-p2wpkh',
    })
    specs.push({
        scheme: 'Bitcoin Core (legacy wallet) — Native SegWit',
        path: coreLegacyReceive,
        addressType: 'p2wpkh',
    })

    return specs
}
