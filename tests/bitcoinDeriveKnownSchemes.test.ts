/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * `HdBitcoinWallet.deriveKnownSchemes` — the "Bitcoin Derived Addresses"
 * comparison tool's actual data source, exercised end to end through the
 * real authorization gate (not just the pure path-builder functions in
 * altSchemes.ts, which bitcoinKeys.test.ts already covers).
 */
import { webcrypto } from 'crypto'
import * as bip39 from 'bip39'
import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'

import { SessionVault } from '@/js/security/SessionVault'
import {
    AuthHandle,
    AuthScope,
    withAuthorization,
    __resetSessionForTests,
    __setPromptForTests,
} from '@/js/security/session'
import { HdBitcoinWallet } from '@/platforms/bitcoin/wallet'
import { deriveAccountNode, addressFromPublicKey, CORE_WALLET_PATH } from '@/bitcoin/keys'
import { electrumPath, bitcoinCoreLegacyPath } from '@/bitcoin/altSchemes'
import { getBitcoinNetworkById } from '@/bitcoin/networks'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
})

const bip32 = BIP32Factory(ecc)
const PASSWORD = 'correct horse battery staple'
const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const mainnet = getBitcoinNetworkById('mainnet')!

const mockPrompt = jest.fn()

beforeEach(() => {
    __resetSessionForTests()
    mockPrompt.mockReset()
    __setPromptForTests(mockPrompt as any)
})

/** Builds a real HdBitcoinWallet with the test mnemonic's seed vaulted under PASSWORD. */
async function makeWallet(): Promise<HdBitcoinWallet> {
    const seed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC))
    const vault = new SessionVault()
    const key = await vault.deriveKey(PASSWORD)
    const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
    await vault.put(auth, 'seed', seed)
    auth.dispose()

    mockPrompt.mockImplementation(async () => vault.deriveKey(PASSWORD))

    const accountNode = deriveAccountNode(
        new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC)),
        'p2wpkh',
        mainnet
    ).neutered()

    return new HdBitcoinWallet({ network: mainnet, addressType: 'p2wpkh', accountNode, vault })
}

/** Independent re-derivation, so the test isn't just checking the code against itself. */
async function addressAt(path: string, type: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr') {
    const seed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC))
    const node = bip32.fromSeed(seed).derivePath(path)
    return addressFromPublicKey(node.publicKey, type, mainnet)
}

/**
 * Drives the low-level session primitive `deriveKnownSchemes` actually
 * depends on (`requireAuth`/`withAuthorization` in js/security/session.ts)
 * rather than the higher-level `authorizeSingle` wrapper in
 * js/security/authorize.ts — that wrapper also touches the offline-signing
 * Pinia store, which needs a full app context this bare unit test doesn't
 * set up. `authorize.test.ts` already covers that wrapper on its own; this
 * test is only about the wallet method's derivation logic.
 */
function derive(wallet: HdBitcoinWallet, customPath?: string) {
    return withAuthorization(
        { scope: AuthScope.SINGLE, reason: 'test', vault: wallet.vault },
        () => wallet.deriveKnownSchemes(customPath)
    )
}

describe('HdBitcoinWallet.deriveKnownSchemes', () => {
    it('requires authorization — throws outside an authorized scope', async () => {
        const wallet = await makeWallet()
        await expect(wallet.deriveKnownSchemes()).rejects.toThrow()
        expect(mockPrompt).not.toHaveBeenCalled()
    })

    it('derives the four standard types matching the official BIP vectors', async () => {
        const wallet = await makeWallet()
        const { rows } = await derive(wallet)

        const byType = Object.fromEntries(rows.map((r) => [`${r.scheme}:${r.addressType}`, r.address]))
        expect(byType['Standard (BIP-44):p2pkh']).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA')
        expect(byType['Standard (BIP-49):p2sh-p2wpkh']).toBe('37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf')
        expect(byType['Standard (BIP-84):p2wpkh']).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
        expect(byType['Standard (BIP-86):p2tr']).toBe(
            'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr'
        )
    })

    it('derives the Core Wallet candidate matching the real Core-compatible address', async () => {
        const wallet = await makeWallet()
        const { rows } = await derive(wallet)

        const core = rows.find((r) => r.scheme.startsWith('Core Wallet'))
        expect(core?.path).toBe(CORE_WALLET_PATH)
        expect(core?.address).toBe('bc1qgsvdpdxec8hsu57lhxg5xem7refr233z2ttx7e')
    })

    it("derives Electrum's Legacy and Native SegWit rows at the SAME path, independently verified", async () => {
        const wallet = await makeWallet()
        const { rows } = await derive(wallet)

        const legacy = rows.find((r) => r.scheme === 'Electrum — Legacy')
        const segwit = rows.find((r) => r.scheme === 'Electrum — Native SegWit')

        expect(legacy?.path).toBe(electrumPath('receive'))
        expect(segwit?.path).toBe(electrumPath('receive'))
        expect(legacy?.path).toBe(segwit?.path) // same key, different encoding

        expect(legacy?.address).toBe(await addressAt(electrumPath('receive'), 'p2pkh'))
        expect(segwit?.address).toBe(await addressAt(electrumPath('receive'), 'p2wpkh'))
    })

    it("derives Bitcoin Core's legacy-wallet rows at the all-hardened path, independently verified", async () => {
        const wallet = await makeWallet()
        const { rows } = await derive(wallet)

        const path = bitcoinCoreLegacyPath('receive')
        expect(path).toBe("m/0'/0'/0'")

        for (const [scheme, type] of [
            ['Bitcoin Core (legacy wallet) — Legacy', 'p2pkh'],
            ['Bitcoin Core (legacy wallet) — Nested SegWit', 'p2sh-p2wpkh'],
            ['Bitcoin Core (legacy wallet) — Native SegWit', 'p2wpkh'],
        ] as const) {
            const row = rows.find((r) => r.scheme === scheme)
            expect(row?.path).toBe(path)
            expect(row?.address).toBe(await addressAt(path, type))
        }
    })

    it('derives a custom path under all four encodings when supplied', async () => {
        const wallet = await makeWallet()
        const customPath = "m/1'/2/3"
        const { rows, customPathError } = await derive(wallet, customPath)

        expect(customPathError).toBeNull()
        const customRows = rows.filter((r) => r.scheme.startsWith('Custom path'))
        expect(customRows).toHaveLength(4)
        for (const row of customRows) {
            expect(row.path).toBe(customPath)
            expect(row.address).toBe(await addressAt(customPath, row.addressType))
        }
    })

    it('reports a malformed custom path as an error without losing the other rows', async () => {
        const wallet = await makeWallet()
        const { rows, customPathError } = await derive(wallet, 'not a path')

        expect(customPathError).not.toBeNull()
        expect(rows.some((r) => r.scheme.startsWith('Custom path'))).toBe(false)
        // The standard/Electrum/Core rows must still be there — one bad
        // custom path must not blank the whole comparison.
        expect(rows.length).toBeGreaterThan(0)
    })

    it('omits custom-path rows entirely when no path is supplied', async () => {
        const wallet = await makeWallet()
        const { rows, customPathError } = await derive(wallet)
        expect(customPathError).toBeNull()
        expect(rows.some((r) => r.scheme.startsWith('Custom path'))).toBe(false)
    })

    it('is deterministic across repeated calls', async () => {
        const wallet = await makeWallet()
        const first = await derive(wallet)
        const second = await derive(wallet)
        expect(first.rows).toEqual(second.rows)
    })
})
