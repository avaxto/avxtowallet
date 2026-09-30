/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * C → X/P export from a locally-signing wallet (mnemonic, private key).
 *
 * exportFromCChain builds the export with the new Avalanche SDK and re-parses
 * its bytes into an AvalancheJS UnsignedTx for signC. The bytes don't carry
 * which key signs each input, so without restoring that the export was signed
 * with zero signatures and rejected: "incorrect number of signatures (0):
 * want 1, got 0". This reproduces the round trip and pins the fix.
 */
import { BN, Buffer } from '@/avalanche'
import { bintools } from '@/AVA'
import { EVMInput, ExportTx, KeyChain } from '@/avalanche/apis/evm'
import { UnsignedTx } from '@/avalanche/apis/evm/tx'
import { privateToAddress } from 'ethereumjs-util'
import { restoreEvmExportSigners } from '@/js/wallets/evmExportSigners'

const HRP = 'avax'
const PRIVATE_KEY = Buffer.from('56289e99c94b6912bfc12adc093c9b51124f0dc54ac7a766b2bc5ccf558d8027', 'hex')
const AVAX_ASSET = bintools.cb58Decode('FvwEAhmxKfeiG8SnEvq42hc6whRyY3EFYAvebMqDNDGCgxN5Z')

/** The wallet's keychain for C-Chain atomic signing, as signC builds it. */
function walletKeychain() {
    const kc = new KeyChain(HRP, 'C')
    const pair = kc.importKey(Buffer.from(PRIVATE_KEY))
    return { kc, signerBech32: bintools.addressToString(HRP, 'C', pair.getAddress()) }
}

// ethereumjs-util wants Node's own Buffer, not AvalancheJS's polyfill.
const evmHex = privateToAddress(globalThis.Buffer.from(PRIVATE_KEY.toString('hex'), 'hex')).toString('hex')

/** An export from `fromHex`, round-tripped through bytes exactly like exportFromCChain does. */
function roundTrippedExport(fromHex: string) {
    const input = new EVMInput('0x' + fromHex, new BN(1_000_000_000), AVAX_ASSET, new BN(7))
    const exportTx = new ExportTx(1, Buffer.alloc(32, 1), Buffer.alloc(32, 2), [input], [])
    const bytes = new UnsignedTx(exportTx).toBuffer()
    const reparsed = new UnsignedTx()
    reparsed.fromBuffer(bytes)
    return reparsed
}

const signatureCounts = (unsigned: UnsignedTx, kc: KeyChain) =>
    // EVM Tx keeps its credentials in a protected field with no getter.
    ((unsigned.sign(kc) as any).credentials as any[]).map((c) => c.sigArray.length)

it('reproduces the bug: after the bytes round trip, the export is signed with zero signatures', () => {
    const { kc } = walletKeychain()
    expect(signatureCounts(roundTrippedExport(evmHex), kc)).toEqual([0])
})

it("restores the wallet's key as signer, so the export carries one valid signature", () => {
    const { kc, signerBech32 } = walletKeychain()
    const unsigned = roundTrippedExport(evmHex)

    expect(restoreEvmExportSigners(unsigned, '0x' + evmHex, signerBech32)).toBe(1)
    const tx = unsigned.sign(kc)
    const [cred] = (tx as any).credentials as any[]
    expect(cred.sigArray).toHaveLength(1)

    // The signature is over this transaction and recovers the wallet's key.
    const msg = Buffer.from(require('create-hash')('sha256').update(unsigned.toBuffer()).digest())
    const pair = kc.getKey(bintools.stringToAddress(signerBech32))
    const recovered = pair.recover(msg, cred.sigArray[0].toBuffer())
    expect(recovered.toString('hex')).toBe(pair.getPublicKey().toString('hex'))
})

it('leaves inputs from other addresses, and inputs that already have a signer, alone', () => {
    const { signerBech32 } = walletKeychain()
    const foreign = roundTrippedExport('11'.repeat(20))
    expect(restoreEvmExportSigners(foreign, '0x' + evmHex, signerBech32)).toBe(0)

    const unsigned = roundTrippedExport(evmHex)
    restoreEvmExportSigners(unsigned, evmHex, signerBech32)
    expect(restoreEvmExportSigners(unsigned, evmHex, signerBech32)).toBe(0) // no double signer
})
