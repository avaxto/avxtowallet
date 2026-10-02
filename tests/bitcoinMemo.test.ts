/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * OP_RETURN memos on Bitcoin sends — how THORChain is told where to deliver a
 * BTC → EVM bridge. The memo must land byte-for-byte in a zero-value output,
 * and the fee must cover the extra bytes.
 */
import * as bitcoin from 'bitcoinjs-lib'
import BIP32Factory from 'bip32'
import * as ecc from 'tiny-secp256k1'

import { buildAndSignTx } from '@/bitcoin/tx'
import { MAX_OP_RETURN_BYTES, opReturnVbytes, selectCoins } from '@/bitcoin/coinSelect'
import { getBitcoinNetworkById } from '@/bitcoin/networks'
import { memoBytes } from '@/platforms/bitcoin/wallet'

beforeAll(() => bitcoin.initEccLib(ecc))

const bip32 = BIP32Factory(ecc)
const mainnet = getBitcoinNetworkById('mainnet')!
const node = bip32.fromSeed(Buffer.alloc(32, 7)).derivePath("m/84'/0'/0'/0/0")
const ownAddress = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(node.publicKey), network: mainnet.params }).address!
const utxo = { txid: 'aa'.repeat(32), vout: 0, value: 200_000, address: ownAddress, addressType: 'p2wpkh' as const, path: 'm/0/0', confirmed: true }
// A stand-in THORChain vault: any valid address that isn't ours.
const VAULT = bitcoin.payments.p2wpkh({
    pubkey: Buffer.from(bip32.fromSeed(Buffer.alloc(32, 9)).derivePath("m/84'/0'/0'/0/0").publicKey),
    network: mainnet.params,
}).address!
const MEMO = '=:AVAX.AVAX:0x4887C61Ee00A4df4191533F3E7Be62bd00Ea2537:0/1/0'

it('puts the memo in a zero-value OP_RETURN output, and the fee covers it', async () => {
    const memo = memoBytes(MEMO)!
    const selection = selectCoins({
        utxos: [utxo],
        targetSats: 50_000,
        feeRate: 5,
        recipientType: 'p2wpkh',
        changeType: 'p2wpkh',
        extraOutputVbytes: opReturnVbytes(memo.length),
    })
    const built = await buildAndSignTx({
        selection,
        toAddress: VAULT,
        changeAddress: ownAddress,
        network: mainnet,
        signerFor: () => node as any,
        opReturn: memo,
    })

    const tx = bitcoin.Transaction.fromHex(built.hex)
    // THORChain's required order: vault, change, OP_RETURN memo.
    expect(tx.outs).toHaveLength(3)
    expect(bitcoin.address.fromOutputScript(tx.outs[0].script, mainnet.params)).toBe(VAULT)
    expect(Number(tx.outs[0].value)).toBe(50_000)

    expect(bitcoin.address.fromOutputScript(tx.outs[1].script, mainnet.params)).toBe(ownAddress)
    const memoOut = tx.outs[2]
    expect(Number(memoOut.value)).toBe(0)
    const decoded = bitcoin.script.decompile(memoOut.script)!
    expect(decoded[0]).toBe(bitcoin.opcodes.OP_RETURN)
    expect(Buffer.from(decoded[1] as Uint8Array).toString('utf8')).toBe(MEMO)

    // The estimate (with the memo's bytes) is what was paid, at or above the target rate.
    expect(built.feeSats).toBe(selection.feeSats)
    expect(built.feeSats / built.vsize).toBeGreaterThanOrEqual(5)
})

it('sizes the memo output, including OP_PUSHDATA1 past 75 bytes', () => {
    expect(opReturnVbytes(10)).toBe(8 + 1 + 1 + 1 + 10)
    expect(opReturnVbytes(80)).toBe(8 + 1 + 1 + 2 + 80)
})

it('refuses a memo Bitcoin would not relay', () => {
    expect(memoBytes(undefined)).toBeNull()
    expect(() => memoBytes('x'.repeat(MAX_OP_RETURN_BYTES + 1))).toThrow(/at most 80/)
})
