/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `BitcoinWallet.getScannedAddresses()` — moved from `HdScanningWallet` up to
 * the base class so every Bitcoin wallet kind answers it uniformly (see the
 * doc on the method in platforms/bitcoin/wallet.ts).
 *
 * This is what the new `/wallet/addresses` page (BitcoinAddresses.vue) relies
 * on to render every kind through one path: an HD wallet's real gap-limited
 * receive/change scan (already covered by bitcoinExtraCandidateSpending.test.ts
 * and bitcoinDeriveKnownSchemes.test.ts), and — the part that had NO coverage
 * before this move — a single-key wallet's one-address `refresh()` populating
 * the exact same shape. If a single-key wallet's `scan.addresses` ever drifted
 * from `ScannedAddress`'s shape, the Addresses page would silently render
 * `undefined`s instead of failing loudly; this pins the shape down.
 *
 * Mocks at `global.fetch`, the same boundary bitcoinExtraCandidateSpending.test.ts
 * uses and explains why: every Esplora call funnels through it regardless of
 * which module makes the call, which a spy on the named export does not
 * reliably intercept in this project's ts-jest setup.
 */
import { WifBitcoinWallet, WatchAddressBitcoinWallet } from '@/platforms/bitcoin/wallet'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import { SessionVault } from '@/js/security/SessionVault'

const mainnet = getBitcoinNetworkById('mainnet')!

// A real, independently-known mainnet address (same P2WPKH vector
// bitcoinDeriveKnownSchemes.test.ts checks against published BIP-84 test
// vectors) — real enough that `detectAddressType` and address encoding are
// exercised for real, not against a string this test invented.
const P2WPKH_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

function statsFor(address: string, opts: { funded?: number; spent?: number; txCount?: number } = {}) {
    const funded = opts.funded ?? 0
    const spent = opts.spent ?? 0
    const txCount = opts.txCount ?? 0
    return {
        address,
        chain_stats: {
            funded_txo_count: funded > 0 ? 1 : 0,
            funded_txo_sum: funded,
            spent_txo_count: 0,
            spent_txo_sum: spent,
            tx_count: txCount,
        },
        mempool_stats: {
            funded_txo_count: 0,
            funded_txo_sum: 0,
            spent_txo_count: 0,
            spent_txo_sum: 0,
            tx_count: 0,
        },
    }
}

function installFetchMock(balanceSats: number): jest.Mock {
    const mock = jest.fn(async (url: string) => {
        if (url.endsWith('/utxo')) {
            const address = url.split('/').slice(-2, -1)[0]
            const utxos =
                balanceSats > 0
                    ? [
                          {
                              txid: 'a'.repeat(64),
                              vout: 0,
                              value: balanceSats,
                              status: { confirmed: true },
                          },
                      ]
                    : []
            return { ok: true, text: async () => JSON.stringify(utxos) } as Response
        }
        const address = url.split('/').pop()!
        return {
            ok: true,
            text: async () =>
                JSON.stringify(statsFor(address, { funded: balanceSats, txCount: balanceSats > 0 ? 1 : 0 })),
        } as Response
    })
    global.fetch = mock as unknown as typeof fetch
    return mock
}

describe('a single-key wallet scans to exactly one address', () => {
    it('WifBitcoinWallet.getScannedAddresses() reports its one address at index 0', async () => {
        installFetchMock(150_000)

        const wallet = new WifBitcoinWallet({
            network: mainnet,
            addressType: 'p2wpkh',
            address: P2WPKH_ADDRESS,
            vault: new SessionVault(),
        })

        // Nothing scanned before the first refresh — the Addresses page's
        // "scan on mount if empty" guard depends on this starting empty.
        expect(wallet.getScannedAddresses()).toEqual([])

        await wallet.refresh()
        const scanned = wallet.getScannedAddresses()

        expect(scanned).toHaveLength(1)
        expect(scanned[0]).toMatchObject({
            address: P2WPKH_ADDRESS,
            chain: 'receive',
            index: 0,
            balanceSats: 150_000,
            used: true,
        })
        // No second chain to send change to — see getChangeAddress's note on
        // why a single-key wallet has none. The Addresses page reads exactly
        // this absence to decide whether to render a Change section.
        expect(scanned.some((a) => a.chain === 'change')).toBe(false)
    })

    it('WatchAddressBitcoinWallet.getScannedAddresses() reports the same shape with no balance yet', async () => {
        installFetchMock(0)

        const wallet = new WatchAddressBitcoinWallet({
            network: mainnet,
            address: P2WPKH_ADDRESS,
        })

        await wallet.refresh()
        const scanned = wallet.getScannedAddresses()

        expect(scanned).toHaveLength(1)
        expect(scanned[0]).toMatchObject({
            address: P2WPKH_ADDRESS,
            chain: 'receive',
            index: 0,
            balanceSats: 0,
            used: false,
        })
    })
})
