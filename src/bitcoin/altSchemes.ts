/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Well-known, non-BIP-44-family derivation conventions, for the "Derived
 * Addresses" comparison tool (views/wallet/BitcoinDerive.vue).
 *
 * Purely informational: nothing here feeds into which key this wallet
 * actually uses to hold funds (see keys.ts / discovery.ts / the store's
 * `accessWithMnemonic` for that — the Core Wallet path is the one exception
 * already wired into fund discovery, and it's imported from keys.ts, not
 * duplicated here). This module exists only so a user can check "does this
 * match what Electrum/Bitcoin Core shows me", the same way walletsrecovery.org
 * exists for exactly that comparison.
 *
 * Both conventions below were confirmed against each project's own source
 * rather than assumed:
 *
 *   Electrum      Its own `bip39_wallet_formats.json` (spesmilo/electrum)
 *                 lists the "Non-standard" BIP-39 import path as a single
 *                 hardened account node, `m/0'`, then unhardened chain/index
 *                 — `m/0'/0/i` (receive), `m/0'/1/i` (change). The SAME path
 *                 regardless of which script type Electrum's UI has you pick
 *                 (legacy / p2sh-segwit / native segwit) — address type is a
 *                 UI choice layered on one path, not a different path per
 *                 type the way BIP-44/49/84 are.
 *
 *                 This is distinct from Electrum's own NATIVE (non-BIP-39)
 *                 12-word seed format, which this app cannot reach at all —
 *                 that format uses a different wordlist checksum and a
 *                 different seed-derivation algorithm entirely, so a phrase
 *                 in that format would not even pass this app's
 *                 `bip39.validateMnemonic` check to be imported.
 *
 *   Bitcoin Core  Its pre-descriptor ("legacy") HD wallet — still what many
 *                 older Core-created wallets use — derives at
 *                 `m/0'/0'/i'` (receive), `m/0'/1'/i'` (change): all THREE
 *                 levels hardened, including the address index itself. That
 *                 last part is why a legacy Core wallet's xpub cannot derive
 *                 further addresses on its own — a hardened child needs the
 *                 private key, not just the public one. Since Core v0.21,
 *                 its now-default descriptor wallets use ordinary BIP-44/49/
 *                 84/86 paths instead (Core's own migration docs: "the BIP
 *                 44, 49, 84, and 86 standard derivation paths will be
 *                 used") — already covered by this app's standard
 *                 candidates, so this entry is specifically for wallets
 *                 created before that migration, or still running as
 *                 "legacy" wallets today.
 */
import type { BtcChain } from './keys'

/** Electrum's "Non-standard" BIP-39 account root. */
export const ELECTRUM_ACCOUNT_PATH = "m/0'"

export function electrumPath(chain: BtcChain, index = 0): string {
    return `${ELECTRUM_ACCOUNT_PATH}/${chain === 'receive' ? 0 : 1}/${index}`
}

/** Bitcoin Core's pre-descriptor ("legacy") HD wallet account root. */
export const BITCOIN_CORE_LEGACY_ACCOUNT_PATH = "m/0'"

export function bitcoinCoreLegacyPath(chain: BtcChain, index = 0): string {
    return `${BITCOIN_CORE_LEGACY_ACCOUNT_PATH}/${chain === 'receive' ? "0'" : "1'"}/${index}'`
}
