/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * The actual new behavior this test suite exists for: a balance sitting at
 * one of the "extra candidate" addresses (Electrum, Core Wallet, Bitcoin Core
 * legacy, …) is (1) counted in the wallet's total and (2) genuinely spendable
 * — not just present in a list somewhere.
 *
 * "Spendable" is checked the strict way: after `send()` builds and signs a
 * transaction, the produced scriptSig's public key is independently verified
 * to actually hash to the extra-candidate's own address. A test that only
 * checks "didn't throw" would not catch a wrong-key bug — bitcoinjs happily
 * finalizes a PSBT signed with the wrong key into a structurally valid but
 * unspendable transaction; it does not validate that for you.
 *
 * Mocks at the network boundary (`global.fetch`) rather than spying on
 * `bitcoin/esplora.ts`'s exports: every Esplora function funnels through
 * `fetch`, and mocking there works regardless of which module (discovery.ts,
 * tx.ts, wallet.ts, …) calls it — `jest.spyOn` on a named export did not
 * reliably intercept calls made from a DIFFERENT module's own import of the
 * same function in this project's ts-jest/TypeScript combination, and
 * `jest.mock()`'s hoisting transform hits a separate, pre-existing tooling
 * incompatibility (`ts.getMutableClone is not a function`) — both are
 * sidestepped by mocking one level down, at the actual I/O boundary.
 */
import { webcrypto } from 'crypto'
import * as bip39 from 'bip39'
import * as bitcoin from 'bitcoinjs-lib'
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
import { HdBitcoinWallet, type ExtraCandidate } from '@/platforms/bitcoin/wallet'
import { deriveAccountNode, addressFromPublicKey } from '@/bitcoin/keys'
import { electrumPath } from '@/bitcoin/altSchemes'
import { getBitcoinNetworkById } from '@/bitcoin/networks'

beforeAll(() => {
    if (!globalThis.crypto?.subtle) {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
    }
    bitcoin.initEccLib(ecc)
})

const bip32 = BIP32Factory(ecc)
const PASSWORD = 'correct horse battery staple'
const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const mainnet = getBitcoinNetworkById('mainnet')!

// A different, unrelated well-known address to send to — not this wallet's
// own, so the transfer is a genuine third-party payment.
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

const jsonRes = (body: unknown, ok = true, status = 200) => ({
    ok,
    status,
    text: async () => JSON.stringify(body),
})
const textRes = (body: string, ok = true, status = 200) => ({ ok, status, text: async () => body })

const emptyStats = {
    chain_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
}
const fundedStats = (sats: number) => ({
    chain_stats: { funded_txo_count: 1, funded_txo_sum: sats, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 1 },
    mempool_stats: { funded_txo_count: 0, funded_txo_sum: 0, spent_txo_count: 0, spent_txo_sum: 0, tx_count: 0 },
})

describe('spending from an extra-candidate address', () => {
    const FUNDED_SATS = 50_000
    let electrumAddress: string
    let wallet: HdBitcoinWallet
    let prevTxHex: string
    let prevTxid: string
    let fetchMock: jest.Mock

    beforeEach(async () => {
        __resetSessionForTests()

        const seed = new Uint8Array(await bip39.mnemonicToSeed(MNEMONIC))

        // Primary scheme: standard p2wpkh (BIP-84) — funded with nothing.
        const primarySigning = deriveAccountNode(seed, 'p2wpkh', mainnet)
        const primaryAccountNode = primarySigning.neutered()

        // The one extra candidate under test: Electrum's Legacy (p2pkh)
        // address, at the real Electrum path.
        const electrumRoot = bip32.fromSeed(seed)
        const electrumLeaf = electrumRoot.derivePath(electrumPath('receive'))
        const electrumNode = electrumLeaf.neutered()
        electrumAddress = addressFromPublicKey(electrumNode.publicKey, 'p2pkh', mainnet)

        const extraCandidates: ExtraCandidate[] = [
            {
                scheme: 'Electrum — Legacy',
                path: electrumPath('receive'),
                addressType: 'p2pkh',
                node: electrumNode,
            },
        ]

        const vault = new SessionVault()
        const key = await vault.deriveKey(PASSWORD)
        const auth = new AuthHandle(AuthScope.SINGLE, vault, key)
        await vault.put(auth, 'seed', seed)
        auth.dispose()

        // Without this, an authorized call falls through to the REAL
        // password-prompt UI (a Vue modal awaiting DOM input that will never
        // come here) and hangs until the test times out.
        __setPromptForTests(async () => vault.deriveKey(PASSWORD))

        wallet = new HdBitcoinWallet({
            network: mainnet,
            addressType: 'p2wpkh',
            accountNode: primaryAccountNode,
            vault,
            extraCandidates,
        })

        // A real, well-formed "previous transaction" paying the Electrum
        // address — not a placeholder txid. p2pkh inputs sign via
        // `nonWitnessUtxo` (see tx.ts#addInput), and bitcoinjs verifies that
        // buffer's OWN computed txid matches the input's `hash` before it
        // will use it, so the mocked UTXO's txid has to be this transaction's
        // real id.
        const prevTx = new bitcoin.Transaction()
        prevTx.version = 2
        prevTx.addInput(Buffer.alloc(32, 1), 0)
        const p2pkhScript = bitcoin.payments.p2pkh({
            address: electrumAddress,
            network: mainnet.params,
        }).output!
        prevTx.addOutput(p2pkhScript, BigInt(FUNDED_SATS))
        prevTxHex = prevTx.toHex()
        prevTxid = prevTx.getId()

        fetchMock = jest.fn(async (url: string) => {
            // /address/<addr>
            const statsMatch = url.match(/\/address\/([^/]+)$/)
            if (statsMatch) {
                const addr = statsMatch[1]
                return jsonRes({
                    address: addr,
                    ...(addr === electrumAddress ? fundedStats(FUNDED_SATS) : emptyStats),
                })
            }
            // /address/<addr>/utxo
            const utxoMatch = url.match(/\/address\/([^/]+)\/utxo$/)
            if (utxoMatch) {
                const addr = utxoMatch[1]
                if (addr !== electrumAddress) return jsonRes([])
                return jsonRes([
                    { txid: prevTxid, vout: 0, value: FUNDED_SATS, status: { confirmed: true } },
                ])
            }
            // /tx/<txid>/hex
            const hexMatch = url.match(/\/tx\/([^/]+)\/hex$/)
            if (hexMatch) {
                if (hexMatch[1] !== prevTxid) return textRes('not found', false, 404)
                return textRes(prevTxHex)
            }
            // POST /tx (broadcast)
            if (url.endsWith('/tx')) {
                return textRes('bb'.repeat(32))
            }
            throw new Error(`unexpected fetch: ${url}`)
        }) as unknown as jest.Mock

        global.fetch = fetchMock as unknown as typeof fetch
    })

    afterEach(() => {
        jest.restoreAllMocks()
    })

    it("counts the Electrum address's balance in the wallet total", async () => {
        await wallet.refresh()
        expect(wallet.balanceSats).toBe(FUNDED_SATS)
    })

    it('lists the Electrum address as spendable, labelled with its scheme', async () => {
        await wallet.refresh()
        const utxos = wallet.getSpendableUtxos()
        expect(utxos).toHaveLength(1)
        expect(utxos[0].address).toBe(electrumAddress)
        expect(utxos[0].addressType).toBe('p2pkh')

        const scanned = wallet.getScannedAddresses()
        const electrumEntry = scanned.find((a) => a.address === electrumAddress)
        expect(electrumEntry?.scheme).toBe('Electrum — Legacy')
    })

    it('signs a spend from the Electrum address with the CORRECT key — verified independently', async () => {
        await wallet.refresh()

        const feeRate = 10
        const sendAmount = 10_000

        const txid = await withAuthorization(
            { scope: AuthScope.SINGLE, reason: 'test', vault: wallet.vault },
            () => wallet.send({ to: DESTINATION, amountSats: sendAmount, feeRate })
        )

        expect(txid).toBe('bb'.repeat(32))

        // Pull the broadcast hex out of the mocked fetch call rather than a
        // captured variable, so this genuinely checks what was SENT to the
        // indexer.
        const broadcastCall = fetchMock.mock.calls.find(([url]: [string]) => url.endsWith('/tx'))
        expect(broadcastCall).toBeDefined()
        const broadcastHex = broadcastCall![1].body as string

        // Independent verification: decode the broadcast transaction and
        // confirm the scriptSig's own public key actually hashes to the
        // Electrum address this UTXO came from. If `send()` had derived the
        // wrong key for this UTXO's path, this specific check — not just
        // "did it throw" — is what would catch it.
        const tx = bitcoin.Transaction.fromHex(broadcastHex)
        expect(tx.ins).toHaveLength(1)

        const decompiled = bitcoin.script.decompile(tx.ins[0].script)
        expect(decompiled).not.toBeNull()
        // P2PKH scriptSig is exactly [signature, pubkey].
        const pubkeyFromSig = decompiled![1] as Uint8Array
        const derivedAddress = bitcoin.payments.p2pkh({
            pubkey: pubkeyFromSig,
            network: mainnet.params,
        }).address

        expect(derivedAddress).toBe(electrumAddress)
    })
})
