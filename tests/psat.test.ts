/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * PSAT round-tripping and partial-credential merging.
 *
 * These build real avalanche.js objects rather than mocking them, because
 * every property worth testing here is a property of the SDK's own
 * serialization: that a zero-filled signature slot survives
 * toBuffer/fromBuffer, that credentials stay positionally aligned with
 * SigIdxs, and that adding one signature does not disturb another. A mock
 * would assert my understanding of the SDK rather than the SDK.
 */
import { BN, Buffer } from '@/avalanche'
import {
    BaseTx,
    KeyChain as AVMKeyChain,
    SECPTransferInput,
    SECPTransferOutput,
    SelectCredentialClass,
    TransferableInput,
    TransferableOutput,
    Tx as AVMTx,
    UnsignedTx as AVMUnsignedTx,
    UTXO as AVMUTXO,
} from '@/avalanche/apis/avm'
import { Signature } from '@/avalanche/common/credentials'
import type { Credential } from '@/avalanche/common/credentials'

const SIG_LEN = 65

/** Deterministic 32-byte buffer, so fixtures are reproducible. */
function fill(byte: number, len = 32): Buffer {
    return Buffer.alloc(len, byte)
}

/** Reads a credential's slots the same way psat.ts does, via toBuffer. */
function slotsOf(cred: Credential): Buffer[] {
    const buff = cred.toBuffer()
    const count = buff.readUInt32BE(0)
    const out: Buffer[] = []
    for (let i = 0; i < count; i++) {
        const start = 4 + i * SIG_LEN
        out.push(buff.slice(start, start + SIG_LEN))
    }
    return out
}

function isZeroSlot(b: Buffer): boolean {
    for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false
    return true
}

/**
 * A 2-of-3 transaction: one input spending a multisig UTXO, one output.
 *
 * Built by hand rather than through `buildBaseTx`, exactly as spending a
 * multisig output has to be — `getMinimumSpendable` skips any UTXO whose
 * threshold this wallet cannot meet alone, which for real multisig is
 * always.
 */
function buildFixture() {
    const keychain = new AVMKeyChain('avax', 'X')
    // Three independent owners.
    const a = keychain.makeKey()
    const b = keychain.makeKey()
    const c = keychain.makeKey()

    const assetID = fill(0xaa)
    const txid = fill(0xbb)
    const outputidx = Buffer.alloc(4)
    outputidx.writeUInt32BE(0, 0)
    const amount = new BN(1000)

    const owners = [a.getAddress(), b.getAddress(), c.getAddress()]
    const sourceOutput = new SECPTransferOutput(amount, owners, new BN(0), 2)
    const utxo = new AVMUTXO(0, txid, outputidx, assetID, sourceOutput)

    const input = new SECPTransferInput(amount)
    // Two slots for a 2-of-3, referencing owners by their canonical index.
    const idxA = sourceOutput.getAddressIdx(a.getAddress())
    const idxB = sourceOutput.getAddressIdx(b.getAddress())
    input.addSignatureIdx(idxA, a.getAddress())
    input.addSignatureIdx(idxB, b.getAddress())

    const xferIn = new TransferableInput(txid, outputidx, assetID, input)
    const destOut = new TransferableOutput(
        assetID,
        new SECPTransferOutput(new BN(900), [c.getAddress()], new BN(0), 1)
    )

    const baseTx = new BaseTx(1, fill(0xcc), [destOut], [xferIn])
    const unsignedTx = new AVMUnsignedTx(baseTx)

    return { keychain, a, b, c, utxo, unsignedTx, sourceOutput, idxA, idxB }
}

describe('partial credentials survive serialization', () => {
    it('round-trips a credential with one real and one empty slot', () => {
        const { unsignedTx, keychain, a } = buildFixture()
        const ins = (unsignedTx.getTransaction() as BaseTx).getIns()
        const cred = SelectCredentialClass(ins[0].getInput().getCredentialID())

        // Slot 0: a real signature. Slot 1: still waiting on the other owner.
        const real = new Signature()
        real.fromBuffer(keychain.getKey(a.getAddress()).sign(fill(0x11)))
        cred.addSignature(real)
        cred.addSignature(new Signature())

        const tx = new AVMTx(unsignedTx, [cred])
        const bytes = tx.toBuffer()

        const reopened = new AVMTx()
        reopened.fromBuffer(bytes)

        // Byte-identical round trip is what lets a PSAT travel between
        // signers without the SDK rejecting the half-filled credential.
        expect(reopened.toBuffer().equals(bytes)).toBe(true)

        const slots = slotsOf(reopened.getCredentials()[0])
        expect(slots).toHaveLength(2)
        expect(isZeroSlot(slots[0])).toBe(false)
        expect(isZeroSlot(slots[1])).toBe(true)
        expect(slots[0].equals(real.toBuffer())).toBe(true)
    })

    it('keeps slot count equal to SigIdx count', () => {
        const { unsignedTx } = buildFixture()
        const ins = (unsignedTx.getTransaction() as BaseTx).getIns()
        const sigIdxCount = ins[0].getInput().getSigIdxs().length

        const cred = SelectCredentialClass(ins[0].getInput().getCredentialID())
        cred.addSignature(new Signature())
        cred.addSignature(new Signature())

        const reopened = new AVMTx()
        reopened.fromBuffer(new AVMTx(unsignedTx, [cred]).toBuffer())

        // The node requires 1:1 positional correspondence; nothing in the SDK
        // checks it, so this is the invariant the merge logic has to hold.
        expect(slotsOf(reopened.getCredentials()[0])).toHaveLength(sigIdxCount)
    })
})

describe('signatures merge positionally', () => {
    it('two owners signing separately produce slots that combine', () => {
        const { unsignedTx, keychain, a, b } = buildFixture()
        const ins = (unsignedTx.getTransaction() as BaseTx).getIns()
        const credID = ins[0].getInput().getCredentialID()

        // Both parties sign the SAME message — the hash covers the unsigned
        // transaction, which carries no credentials, so one signature can
        // never invalidate another.
        const hash = fill(0x42)
        const sigA = new Signature()
        sigA.fromBuffer(keychain.getKey(a.getAddress()).sign(hash))
        const sigB = new Signature()
        sigB.fromBuffer(keychain.getKey(b.getAddress()).sign(hash))

        // Owner A's copy: slot 0 filled, slot 1 empty.
        const credFromA = SelectCredentialClass(credID)
        credFromA.addSignature(sigA)
        credFromA.addSignature(new Signature())

        // Owner B receives it and fills slot 1 without touching slot 0 —
        // rebuilt rather than mutated, since sigArray is append-only.
        const priorSlots = slotsOf(credFromA)
        const merged = SelectCredentialClass(credID)
        const restored = new Signature()
        restored.fromBuffer(priorSlots[0])
        merged.addSignature(restored)
        merged.addSignature(sigB)

        const finalSlots = slotsOf(merged)
        expect(finalSlots[0].equals(sigA.toBuffer())).toBe(true)
        expect(finalSlots[1].equals(sigB.toBuffer())).toBe(true)
        expect(finalSlots.every((s) => !isZeroSlot(s))).toBe(true)
    })

    it('the signing hash does not change when a credential is added', () => {
        const { unsignedTx, keychain, a } = buildFixture()
        const before = unsignedTx.toBuffer()

        const cred = SelectCredentialClass(
            (unsignedTx.getTransaction() as BaseTx).getIns()[0].getInput().getCredentialID()
        )
        const sig = new Signature()
        sig.fromBuffer(keychain.getKey(a.getAddress()).sign(fill(0x11)))
        cred.addSignature(sig)
        const tx = new AVMTx(unsignedTx, [cred])

        // Re-reading the unsigned half out of the signed transaction must
        // give the identical bytes, or the second signer would sign a
        // different message than the first.
        const reopened = new AVMTx()
        reopened.fromBuffer(tx.toBuffer())
        expect(reopened.getUnsignedTx().toBuffer().equals(before)).toBe(true)
    })
})

describe('multisig output construction', () => {
    it('sorts owner addresses canonically rather than keeping entry order', () => {
        const keychain = new AVMKeyChain('avax', 'X')
        const k1 = keychain.makeKey()
        const k2 = keychain.makeKey()
        const k3 = keychain.makeKey()

        const entered = [k1.getAddress(), k2.getAddress(), k3.getAddress()]
        const out = new SECPTransferOutput(new BN(1), entered, new BN(0), 2)
        const stored = out.getAddresses()

        // The SDK re-sorts addresses into byte order on construction and on
        // every (de)serialization, so an owner's signature slot index is NOT
        // the position they were typed in — the reason psat.ts resolves
        // owners through getAddressIdx and never through form ordering.
        const sortedEntered = [...entered].sort((x, y) => Buffer.compare(x, y))
        expect(stored.map((s) => s.toString('hex'))).toEqual(
            sortedEntered.map((s) => s.toString('hex'))
        )
    })

    it('records the threshold it was given', () => {
        const keychain = new AVMKeyChain('avax', 'X')
        const owners = [keychain.makeKey(), keychain.makeKey(), keychain.makeKey()].map((k) =>
            k.getAddress()
        )
        const out = new SECPTransferOutput(new BN(1), owners, new BN(0), 2)
        expect(out.getThreshold()).toBe(2)
        expect(out.getAddresses()).toHaveLength(3)
    })

    it('does not reject a threshold above the owner count', () => {
        // Pins why buildMultisigTransaction validates this itself: the SDK's
        // own guard lives in buildBaseTx, which the multisig builder bypasses,
        // so an unchecked threshold here would build a permanently unspendable
        // output that the node still accepts.
        const keychain = new AVMKeyChain('avax', 'X')
        const owners = [keychain.makeKey(), keychain.makeKey()].map((k) => k.getAddress())
        const out = new SECPTransferOutput(new BN(1), owners, new BN(0), 5)
        expect(out.getThreshold()).toBe(5)
        expect(out.getAddresses()).toHaveLength(2)
    })
})

describe('what a decoded transaction can and cannot know', () => {
    it('carries the spent amount and asset on the input itself', () => {
        const { unsignedTx } = buildFixture()
        const reopened = new AVMUnsignedTx()
        reopened.fromBuffer(unsignedTx.toBuffer())

        const input = (reopened.getTransaction() as BaseTx).getIns()[0]
        expect(input.getAssetID().equals(fill(0xaa))).toBe(true)
        expect((input.getInput() as SECPTransferInput).getAmount().toString()).toBe('1000')
        expect(input.getTxID().equals(fill(0xbb))).toBe(true)
    })

    it('loses SigIdx source addresses on deserialization', () => {
        const { unsignedTx } = buildFixture()

        const live = (unsignedTx.getTransaction() as BaseTx).getIns()[0].getInput().getSigIdxs()
        expect(isZeroSlot(live[0].getSource())).toBe(false)

        const reopened = new AVMUnsignedTx()
        reopened.fromBuffer(unsignedTx.toBuffer())
        const parsed = (reopened.getTransaction() as BaseTx).getIns()[0].getInput().getSigIdxs()

        // This is the whole reason the PSAT envelope carries source UTXOs:
        // the wire format keeps the owner INDEX but not the owner ADDRESS,
        // and BaseTx.sign looks keys up by address. Signing a decoded
        // transaction with the SDK's own path would call getKey(20 zero
        // bytes) and crash.
        expect(parsed).toHaveLength(live.length)
        expect(parsed[0].toBuffer().equals(live[0].toBuffer())).toBe(true)
        expect(isZeroSlot(parsed[0].getSource())).toBe(true)
    })

    it('keeps the owner list on the source UTXO, which the input does not', () => {
        const { utxo, sourceOutput } = buildFixture()
        const reopened = new AVMUTXO()
        reopened.fromBuffer(utxo.toBuffer())

        const out = reopened.getOutput() as SECPTransferOutput
        expect(out.getThreshold()).toBe(2)
        expect(out.getAddresses()).toHaveLength(3)
        expect(out.getAddresses().map((a) => a.toString('hex'))).toEqual(
            sourceOutput.getAddresses().map((a) => a.toString('hex'))
        )
    })
})
