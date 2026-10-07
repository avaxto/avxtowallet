/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Electrum on the Bitcoin platform, end to end through the real store:
 *
 *  - Electrum's own seed format (what Electrum generates for a new wallet):
 *    recognised, derived exactly as Electrum does — checked against
 *    Electrum's published test vectors — and opened as a spendable wallet.
 *  - A BIP-39 phrase used in Electrum (its "non-standard" m/0' layout): all
 *    three script types scanned as whole accounts, so funds past address 0
 *    and on change addresses are found and spendable.
 *  - A phrase valid in BOTH formats: its Electrum-format addresses are
 *    scanned too, and their coins are signed with the Electrum-format seed —
 *    verified by checking the signing key hashes to the funded address.
 *
 * Only the network (fetch) and the router are faked.
 */
import { webcrypto } from 'crypto'
import * as bip39 from 'bip39'
import * as bitcoin from 'bitcoinjs-lib'
import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'
import { createPinia, setActivePinia } from 'pinia'

jest.mock('@/router', () => ({ __esModule: true, default: { push: jest.fn() } }))

import { AuthScope, withAuthorization, __resetSessionForTests, __setPromptForTests } from '@/js/security/session'
import {
    ELECTRUM_ACCOUNTS,
    electrumSeedFromPhrase,
    electrumSeedPath,
    electrumSeedType,
    normalizeElectrumText,
} from '@/bitcoin/electrumSeed'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import { addressFromPublicKey } from '@/bitcoin/keys'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import { HdBitcoinWallet, ELECTRUM_SEED_PATH_PREFIX } from '@/platforms/bitcoin/wallet'

const bip32 = BIP32Factory(ecc)
const mainnet = getBitcoinNetworkById('mainnet')!
const PASSWORD = 'session password'
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

// Electrum's own test vectors (electrum/tests/test_wallet_vertical.py).
const STANDARD = 'cycle rocket west magnet parrot shuffle foot correct salt library feed song'
const STANDARD_XPRV = 'xprv9s21ZrQH143K32jECVM729vWgGq4mUDJCk1ozqAStTphzQtCTuoFmFafNoG1g55iCnBTXUzz3zWnDb5CVLGiFvmaZjuazHDL8a81cPQ8KL6'
const STANDARD_RECEIVE0 = '1NNkttn1YvVGdqBW4PR6zvc3Zx3H5owKRf'
const STANDARD_CHANGE0 = '1KSezYMhAJMWqFbVFB2JshYg69UpmEXR4D'
const SEGWIT = 'bitter grass shiver impose acquire brush forget axis eager alone wine silver'
const SEGWIT_RECEIVE0 = 'bc1q3g5tmkmlvxryhh843v4dz026avatc0zzr6h3af'
const SEGWIT_CHANGE0 = 'bc1qdy94n2q5qcp0kg7v9yzwe6wvfkhnvyzje7nx2p'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    bitcoin.initEccLib(ecc)
})

// ── the network ──
const stats = (sats: number, txs = sats > 0 ? 1 : 0) => ({
    chain_stats: { funded_txo_count: txs, funded_txo_sum: sats, spent_txo_count: 0, spent_txo_sum: 0, tx_count: txs },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
})
const json = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })
const text = (body: string, ok = true, status = 200) => ({ ok, status, text: async () => body })

/** address → sats, with a fake txid per funded address. */
let funded: Map<string, number>
let broadcasts: string[]
const txidFor = (address: string) => Buffer.from(bitcoin.crypto.sha256(Buffer.from(address))).toString('hex')

function installFetch() {
    broadcasts = []
    global.fetch = jest.fn(async (url: string, init?: any) => {
        const utxo = url.match(/\/address\/([^/]+)\/utxo$/)
        if (utxo) {
            const sats = funded.get(utxo[1])
            return json(sats ? [{ txid: txidFor(utxo[1]), vout: 0, value: sats, status: { confirmed: true } }] : [])
        }
        const addr = url.match(/\/address\/([^/]+)$/)
        if (addr) return json(Object.assign({ address: addr[1] }, stats(funded.get(addr[1]) ?? 0)))
        if (url.endsWith('/fee-estimates')) return json({ '1': 5, '3': 4, '6': 3 })
        if (url.endsWith('/tx') && init?.method === 'POST') {
            broadcasts.push(String(init.body))
            return text('cc'.repeat(32))
        }
        return text('not found', false, 404)
    }) as any
}

async function open(phrase: string): Promise<HdBitcoinWallet> {
    const store = useBitcoinStore()
    await store.accessWithMnemonic(phrase, PASSWORD, { navigate: false })
    const w = store.wallet
    if (!(w instanceof HdBitcoinWallet)) throw new Error('not an HD wallet')
    __setPromptForTests(async () => (w as any).vault.deriveKey(PASSWORD))
    return w
}

const authorized = <T>(w: HdBitcoinWallet, fn: () => Promise<T>) =>
    withAuthorization({ scope: AuthScope.SINGLE, reason: 'test', vault: (w as any).vault }, fn)

/** The public key that signed each segwit input of a broadcast transaction. */
function witnessPubkeys(hex: string): string[] {
    const tx = bitcoin.Transaction.fromHex(hex)
    return tx.ins.map((i) => Buffer.from(i.witness[1]).toString('hex'))
}

/** First BIP-39 phrase (from a counter as entropy) whose Electrum reading is `type`. */
function bip39PhraseThatIsAlsoElectrum(type: 'standard' | 'segwit'): string {
    for (let i = 0; i < 200_000; i++) {
        const entropy = Buffer.alloc(16)
        entropy.writeUInt32BE(i, 12)
        const phrase = bip39.entropyToMnemonic(entropy)
        if (electrumSeedType(phrase) === type) return phrase
    }
    throw new Error('none found')
}

beforeEach(() => {
    setActivePinia(createPinia())
    __resetSessionForTests()
    funded = new Map()
    installFetch()
})

describe('Electrum seed format', () => {
    it('recognises seed types exactly as Electrum does, and derives Electrum’s addresses', () => {
        expect(electrumSeedType(STANDARD)).toBe('standard')
        expect(electrumSeedType(SEGWIT)).toBe('segwit')
        expect(bip39.validateMnemonic(STANDARD)).toBe(false)
        expect(electrumSeedType('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')).toBeNull()

        const root = bip32.fromSeed(Buffer.from(electrumSeedFromPhrase(STANDARD)))
        expect(root.toBase58()).toBe(STANDARD_XPRV)
        const std = ELECTRUM_ACCOUNTS.standard
        expect(addressFromPublicKey(root.derivePath(electrumSeedPath(std, 0, 0)).publicKey, 'p2pkh', mainnet)).toBe(STANDARD_RECEIVE0)
        expect(addressFromPublicKey(root.derivePath(electrumSeedPath(std, 1, 0)).publicKey, 'p2pkh', mainnet)).toBe(STANDARD_CHANGE0)

        const sroot = bip32.fromSeed(Buffer.from(electrumSeedFromPhrase(SEGWIT)))
        const sw = ELECTRUM_ACCOUNTS.segwit
        expect(addressFromPublicKey(sroot.derivePath(electrumSeedPath(sw, 0, 0)).publicKey, 'p2wpkh', mainnet)).toBe(SEGWIT_RECEIVE0)
        expect(addressFromPublicKey(sroot.derivePath(electrumSeedPath(sw, 1, 0)).publicKey, 'p2wpkh', mainnet)).toBe(SEGWIT_CHANGE0)
    })

    it('normalizes like Electrum: case, spacing and accents do not matter', () => {
        expect(normalizeElectrumText('  Cycle   ROCKET\nwest ')).toBe('cycle rocket west')
        expect(normalizeElectrumText('café')).toBe('cafe')
        expect(electrumSeedType(STANDARD.toUpperCase().split(' ').join('   '))).toBe('standard')
    })
})

describe('opening an Electrum seed', () => {
    it('opens a standard seed as Electrum Legacy, at Electrum’s own addresses', async () => {
        const w = await open(STANDARD)
        expect(w.electrumSeedType).toBe('standard')
        expect(w.addressTypeLabel).toBe('Electrum seed — Legacy')
        expect(w.getReceiveAddress()).toBe(STANDARD_RECEIVE0)
        expect((w as any).getChangeAddress()).toBe(STANDARD_CHANGE0)
    })

    it('opens a segwit seed as Electrum Native SegWit, finds funds past address 0 and spends them', async () => {
        const sroot = bip32.fromSeed(Buffer.from(electrumSeedFromPhrase(SEGWIT)))
        const node = sroot.derivePath("m/0'/0/2")
        const third = addressFromPublicKey(node.publicKey, 'p2wpkh', mainnet)
        funded.set(third, 80_000)

        const w = await open(SEGWIT)
        await w.refresh()
        expect(w.balanceSats).toBe(80_000)
        expect(w.getReceiveAddress()).toBe(SEGWIT_RECEIVE0)
        expect(w.getScannedAddresses().find((a) => a.address === third)?.path).toBe("m/0'/0/2")

        await authorized(w, () => w.send({ to: DESTINATION, amountSats: 30_000, feeRate: 2 }))
        expect(witnessPubkeys(broadcasts[0])).toEqual([Buffer.from(node.publicKey).toString('hex')])
    })

    it('lists Electrum’s receive and change addresses on the derive page', async () => {
        const w = await open(STANDARD)
        const res = await authorized(w, () => w.deriveKnownSchemes())
        expect(res.rows.map((r) => [r.scheme, r.path, r.address])).toEqual([
            ['Electrum seed — Legacy (receive)', 'm/0/0', STANDARD_RECEIVE0],
            ['Electrum seed — Legacy (change)', 'm/1/0', STANDARD_CHANGE0],
        ])
    })

    it('refuses two-factor seeds and phrases in neither format', async () => {
        // Twelve words picked from a hash of a counter: about 1 in 4096 is a 2FA seed.
        let twoFa = ''
        const words = bip39.wordlists.english
        for (let i = 0; i < 200_000 && !twoFa; i++) {
            const h = Buffer.from(bitcoin.crypto.sha256(Buffer.from(String(i))))
            const phrase = Array.from({ length: 12 }, (_, k) => words[h.readUInt16BE(k * 2) % words.length]).join(' ')
            if (electrumSeedType(phrase) === '2fa' && !bip39.validateMnemonic(phrase)) twoFa = phrase
        }
        expect(twoFa).not.toBe('')
        await expect(useBitcoinStore().accessWithMnemonic(twoFa, PASSWORD, { navigate: false })).rejects.toThrow(/two-factor \(TrustedCoin\)/)
        await expect(useBitcoinStore().accessWithMnemonic('not a real phrase at all here', PASSWORD, { navigate: false })).rejects.toThrow(
            /not a valid BIP-39 recovery phrase or Electrum seed/
        )
    })
})

describe('a BIP-39 phrase used in Electrum', () => {
    const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

    it('scans all three Electrum script types as whole accounts — change and later addresses too — and spends from them', async () => {
        const root = bip32.fromSeed(Buffer.from(await bip39.mnemonicToSeed(PHRASE)))
        const recv3 = root.derivePath("m/0'/0/3")
        const change1 = root.derivePath("m/0'/1/1")
        const nested0 = root.derivePath("m/0'/0/0")
        funded.set(addressFromPublicKey(recv3.publicKey, 'p2wpkh', mainnet), 40_000)
        funded.set(addressFromPublicKey(change1.publicKey, 'p2wpkh', mainnet), 15_000)
        funded.set(addressFromPublicKey(nested0.publicKey, 'p2sh-p2wpkh', mainnet), 5_000)

        const w = await open(PHRASE)
        await w.refresh()
        expect(w.balanceSats).toBe(60_000)
        const rows = w.getScannedAddresses().filter((a) => a.balanceSats > 0)
        expect(rows.map((a) => [a.scheme, a.path]).sort()).toEqual([
            ['Electrum — Native SegWit', "m/0'/0/3"],
            ['Electrum — Native SegWit', "m/0'/1/1"],
            ['Electrum — Nested SegWit', "m/0'/0/0"],
        ])
        // The single-address Electrum candidates are gone — no double counting.
        expect(w.getScannedAddresses().filter((a) => a.scheme?.startsWith('Electrum') && a.balanceSats > 0)).toHaveLength(3)

        await authorized(w, () => w.send({ to: DESTINATION, amountSats: 50_000, feeRate: 2 }))
        const used = witnessPubkeys(broadcasts[0]).sort()
        expect(used).toEqual(
            [recv3, change1].map((n) => Buffer.from(n.publicKey).toString('hex')).sort()
        )
    })

    it('shows all three Electrum encodings on the derive page', async () => {
        const w = await open(PHRASE)
        const res = await authorized(w, () => w.deriveKnownSchemes())
        expect(res.rows.filter((r) => r.scheme.startsWith('Electrum')).map((r) => r.scheme)).toEqual([
            'Electrum — Legacy',
            'Electrum — Nested SegWit',
            'Electrum — Native SegWit',
        ])
    })
})

describe('a phrase valid as BIP-39 AND as an Electrum seed', () => {
    it('also scans its Electrum-format addresses, and signs those coins with the Electrum-format seed', async () => {
        const phrase = bip39PhraseThatIsAlsoElectrum('segwit')
        expect(bip39.validateMnemonic(phrase)).toBe(true)

        const eroot = bip32.fromSeed(Buffer.from(electrumSeedFromPhrase(phrase)))
        const eNode = eroot.derivePath("m/0'/0/1")
        const eAddress = addressFromPublicKey(eNode.publicKey, 'p2wpkh', mainnet)
        // Same path under the BIP-39 seed is a different address — the prefix is what tells them apart.
        const bip39Root = bip32.fromSeed(Buffer.from(await bip39.mnemonicToSeed(phrase)))
        expect(addressFromPublicKey(bip39Root.derivePath("m/0'/0/1").publicKey, 'p2wpkh', mainnet)).not.toBe(eAddress)
        funded.set(eAddress, 70_000)

        const w = await open(phrase)
        expect((w as any).vault.has('electrumSeed')).toBe(true)
        await w.refresh()
        expect(w.balanceSats).toBe(70_000)
        const row = w.getScannedAddresses().find((a) => a.address === eAddress)
        expect(row).toMatchObject({ scheme: 'Electrum seed — Native SegWit', path: `${ELECTRUM_SEED_PATH_PREFIX}m/0'/0/1` })

        await authorized(w, () => w.send({ to: DESTINATION, amountSats: 20_000, feeRate: 2 }))
        expect(witnessPubkeys(broadcasts[0])).toEqual([Buffer.from(eNode.publicKey).toString('hex')])

        const res = await authorized(w, () => w.deriveKnownSchemes())
        expect(res.rows.find((r) => r.scheme === 'Electrum seed — Native SegWit (receive)')?.path).toBe("m/0'/0/0")
    })
})
