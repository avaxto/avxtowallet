/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * PSAT — Partially Signed Avalanche Transaction (X-chain).
 *
 * An X-chain input spending an M-of-N `SECPTransferOutput` needs M signatures,
 * and no single wallet holds them all. This module is the format and the
 * merge logic that lets a transaction travel between signers, each adding
 * only their own slot.
 *
 * Why this is not just "call unsignedTx.sign() twice":
 *
 *   - `BaseTx.sign()` (avalanche/apis/avm/basetx.ts) looks a key up per
 *     SigIdx and calls `.sign()` on the result with no existence check — a
 *     missing key is a raw `TypeError`, not a partial credential. It is
 *     all-or-nothing by construction.
 *   - Each `.sign()` call builds a brand-new credential array and a brand-new
 *     `Tx`, so a second call discards the first call's signatures entirely
 *     rather than accumulating them.
 *
 * So signing here replicates that loop by hand, substituting a zero-filled
 * 65-byte placeholder wherever this wallet has no key. That is safe to
 * serialize: `Credential.toBuffer`/`fromBuffer` and `NBytes.fromBuffer`
 * validate length only — there is no "is this a real signature" check
 * anywhere on the (de)serialization path — so placeholder slots round-trip
 * losslessly and a later signer overwrites them positionally.
 *
 * The signature hash covers `UnsignedTx.toBuffer()`, which contains no
 * credentials at all, so adding one signature can never invalidate another.
 * That is what makes passing the transaction between signers sound.
 *
 * **The one thing the wire format does not carry:** a `TransferableInput`
 * records the UTXO it spends (txid, output index, assetID, amount) but NOT
 * that UTXO's owner list — and `SigIdx.source` (the 20-byte owner address
 * `BaseTx.sign` keys off) is an in-memory-only field that `Input.fromBuffer`
 * never restores. A decoded transaction therefore knows a slot must be
 * signed by "owner #2" without knowing who owner #2 is. Source UTXOs are
 * carried alongside the transaction in the envelope below to close that gap,
 * and are structurally verified against the inputs before they are trusted.
 */
import createHash from 'create-hash'

import { BN, Buffer } from '@/avalanche'
import {
    SelectCredentialClass,
    Tx as AVMTx,
    UnsignedTx as AVMUnsignedTx,
    UTXO as AVMUTXO,
    AVMConstants,
} from '@/avalanche/apis/avm'
import type {
    AmountOutput,
    BaseTx as AVMBaseTx,
    TransferableInput,
    TransferableOutput,
} from '@/avalanche/apis/avm'
import { Credential, Signature } from '@/avalanche/common/credentials'
import type { OutputOwners } from '@/avalanche/common/output'
import type { StandardAmountInput } from '@/avalanche/common/input'
import { ava, avm, bintools } from '@/AVA'
import { getPreferredHRP } from '@/avalanche/utils'

/** Bytes in one secp256k1 signature slot. */
const SIG_LEN = 65

/** Envelope format version. Bumped only on a breaking change to the shape. */
export const PSAT_VERSION = 1

/**
 * The transport envelope.
 *
 * JSON rather than a bespoke binary format because the extra field is a list
 * of UTXOs whose length varies, and because a human debugging a stuck
 * multi-party signing round can read it.
 */
interface PsatEnvelope {
    v: number
    /** Network id the transaction was built for. */
    net: number
    /** base64 of `Tx.toBuffer()`. */
    tx: string
    /** cb58 of each input's source UTXO, in any order. */
    utxos: string[]
}

/** One signature slot on one input. */
export interface PsatSlot {
    /** Index into the source output's (canonically sorted) address list. */
    addressIdx: number
    /** Owner address this slot must be signed by, or null when unresolved. */
    address: string | null
    signed: boolean
    /** True when this wallet holds the key for `address`. */
    mine: boolean
}

export interface PsatInputSummary {
    utxoId: string
    txId: string
    outputIdx: number
    assetId: string
    amount: BN
    /** Every owner of the spent output, canonically ordered. */
    owners: string[]
    threshold: number
    slots: PsatSlot[]
    /** True when this input is a multisig (threshold > 1) spend. */
    isMultisig: boolean
    /** Signatures still needed on this input. */
    missing: number
}

export interface PsatOutputSummary {
    assetId: string
    amount: BN
    owners: string[]
    threshold: number
    locktime: BN
    isMultisig: boolean
}

export interface PsatSummary {
    networkId: number
    inputs: PsatInputSummary[]
    outputs: PsatOutputSummary[]
    /** Per-asset totals, keyed by cb58 asset id. */
    inputTotals: Record<string, BN>
    outputTotals: Record<string, BN>
    /** Input minus output per asset — the fee, for the AVAX entry. */
    burn: Record<string, BN>
    memo: string
    /** True when every slot on every input carries a signature. */
    complete: boolean
    /** Total slots still unsigned across all inputs. */
    missingSignatures: number
    /** True when this wallet owns at least one still-unsigned slot. */
    canSign: boolean
    /** True when any input's owner list could not be resolved. */
    hasUnresolvedOwners: boolean
}

export interface DecodedPsat {
    tx: AVMTx
    unsignedTx: AVMUnsignedTx
    /** Source UTXOs keyed by utxo id, for owner resolution. */
    sourceUtxos: Map<string, AVMUTXO>
    /** True when the input was a bare envelope-less transaction. */
    rawTransaction: boolean
}

/** A 65-byte slot that has not been signed yet. */
function isEmptySlot(bytes: Buffer): boolean {
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== 0) return false
    }
    return true
}

/**
 * Reads a credential's slots out as raw bytes.
 *
 * Goes through `toBuffer()` rather than reaching for `sigArray`, which is
 * protected: the wire layout is `4-byte count || count × 65 bytes`, so
 * slicing it back apart needs no access to internals.
 */
function credentialSlots(cred: Credential): Buffer[] {
    const buff = cred.toBuffer()
    const count = buff.readUInt32BE(0)
    const slots: Buffer[] = []
    for (let i = 0; i < count; i++) {
        const start = 4 + i * SIG_LEN
        slots.push(bintools.copyFrom(buff, start, start + SIG_LEN))
    }
    return slots
}

/** X-chain address (`X-avax1…`) for a raw 20-byte address buffer. */
export function addressToX(addr: Buffer): string {
    return bintools.addressToString(getPreferredHRP(ava.getNetworkID()), 'X', addr)
}

/**
 * Parses a user-typed X-chain address, or null when it is not a valid one
 * for this network.
 *
 * Uses `parseAddress` (strict — it checks the chain alias) rather than
 * `stringToAddress`, which happily accepts a `P-` address for an X-chain
 * field. It signals failure by returning undefined instead of throwing.
 */
export function parseXAddress(addr: string): Buffer | null {
    try {
        const parsed = bintools.parseAddress(addr.trim(), avm.getBlockchainID(), 'X')
        return parsed ?? null
    } catch {
        return null
    }
}

/** The message every signature on this transaction is made over. */
export function signingHash(unsignedTx: AVMUnsignedTx): Buffer {
    return Buffer.from(createHash('sha256').update(unsignedTx.toBuffer()).digest())
}

/** Wraps a transaction plus its source UTXOs into the shareable base64 string. */
export function encodePsat(tx: AVMTx, sourceUtxos: AVMUTXO[]): string {
    const envelope: PsatEnvelope = {
        v: PSAT_VERSION,
        net: ava.getNetworkID(),
        tx: Buffer.from(tx.toBuffer()).toString('base64'),
        utxos: sourceUtxos.map((u) => bintools.cb58Encode(u.toBuffer())),
    }
    return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64')
}

/** Parses a `Tx` from raw bytes, verifying it re-serializes to what came in. */
function txFromBuffer(bytes: Buffer): AVMTx | null {
    try {
        const tx = new AVMTx()
        tx.fromBuffer(bytes)
        // Re-serializing must reproduce the input exactly. Without this a
        // truncated or trailing-garbage buffer parses "successfully" into a
        // transaction that is not the one the sender meant.
        return tx.toBuffer().equals(bytes) ? tx : null
    } catch {
        return null
    }
}

/**
 * Parses an unsigned transaction and wraps it as a credential-less `Tx`.
 *
 * Accepted so a transaction shared before anyone has signed it still opens.
 */
function unsignedTxFromBuffer(bytes: Buffer): AVMTx | null {
    try {
        const unsigned = new AVMUnsignedTx()
        unsigned.fromBuffer(bytes)
        if (!unsigned.toBuffer().equals(bytes)) return null
        return new AVMTx(unsigned, [])
    } catch {
        return null
    }
}

/**
 * Decodes a pasted PSAT string.
 *
 * Accepts three shapes, in order: the envelope above, a base64 `Tx`, and a
 * base64 `UnsignedTx`. The bare forms are accepted because "the base64
 * transaction" is what another tool is most likely to hand someone — they
 * simply arrive without owner information, which the caller resolves from
 * the wallet's own UTXO set where it can.
 */
export function decodePsat(input: string): DecodedPsat {
    const trimmed = input.trim().replace(/\s+/g, '')
    if (!trimmed) throw new Error('Paste a transaction first.')

    let raw: Buffer
    try {
        raw = Buffer.from(trimmed, 'base64')
    } catch {
        throw new Error('That is not valid base64.')
    }
    if (raw.length === 0) throw new Error('That is not valid base64.')

    // Envelope first: its payload is JSON, which a transaction buffer never is.
    try {
        const parsed = JSON.parse(raw.toString('utf8')) as PsatEnvelope
        if (parsed && typeof parsed === 'object' && typeof parsed.tx === 'string') {
            if (parsed.v !== PSAT_VERSION) {
                throw new Error(
                    `This transaction uses PSAT format v${parsed.v}, but this wallet ` +
                        `understands v${PSAT_VERSION}.`
                )
            }
            const txBytes = Buffer.from(parsed.tx, 'base64')
            const tx = txFromBuffer(txBytes) ?? unsignedTxFromBuffer(txBytes)
            if (!tx) throw new Error('The transaction inside this PSAT could not be parsed.')

            const sourceUtxos = new Map<string, AVMUTXO>()
            for (const encoded of parsed.utxos ?? []) {
                try {
                    const utxo = new AVMUTXO()
                    utxo.fromBuffer(bintools.cb58Decode(encoded))
                    sourceUtxos.set(utxo.getUTXOID(), utxo)
                } catch {
                    // A malformed entry costs owner display for that input,
                    // which degrades to "unresolved" rather than failing the
                    // whole decode.
                }
            }
            return { tx, unsignedTx: tx.getUnsignedTx(), sourceUtxos, rawTransaction: false }
        }
    } catch (e: any) {
        // A version mismatch is a real answer, not a parse miss — surface it
        // rather than falling through to "could not be parsed".
        if (e?.message?.includes('PSAT format')) throw e
    }

    const tx = txFromBuffer(raw) ?? unsignedTxFromBuffer(raw)
    if (!tx) {
        throw new Error(
            'This does not look like an X-chain transaction. Check you copied the whole string.'
        )
    }
    return {
        tx,
        unsignedTx: tx.getUnsignedTx(),
        sourceUtxos: new Map(),
        rawTransaction: true,
    }
}

/**
 * Rejects a transaction built for another network or another chain.
 *
 * Nothing in `fromBuffer` checks either, so without this a Fuji transaction
 * opens cleanly on mainnet and produces signatures that can never be used.
 */
export function assertSameNetwork(unsignedTx: AVMUnsignedTx): void {
    const tx = unsignedTx.getTransaction()
    const networkId = tx.getNetworkID()
    if (networkId !== ava.getNetworkID()) {
        throw new Error(
            `This transaction is for network ${networkId}, but the wallet is connected ` +
                `to network ${ava.getNetworkID()}. Switch networks and try again.`
        )
    }
    const expectedChain = bintools.cb58Decode(avm.getBlockchainID())
    if (!tx.getBlockchainID().equals(expectedChain)) {
        throw new Error('This transaction is not an X-chain transaction.')
    }
}

/**
 * Checks each supplied source UTXO really is the one its input spends.
 *
 * The envelope arrives from whoever sent it, so its UTXOs are untrusted
 * input. Matching id, asset and amount against the transaction's own bytes
 * means a tampered envelope cannot misrepresent what is being spent — and
 * the outputs (where the money actually goes) are read from the transaction
 * itself, never from the envelope, so they cannot be misrepresented at all.
 */
function resolveSourceUtxo(
    input: TransferableInput,
    supplied: Map<string, AVMUTXO>,
    walletUtxo: (utxoId: string) => AVMUTXO | undefined
): AVMUTXO | null {
    const utxoId = input.getUTXOID()

    // The wallet's own scanned set is authoritative when it has the UTXO —
    // it came from the network rather than from the sender.
    const own = walletUtxo(utxoId)
    if (own) return own

    const candidate = supplied.get(utxoId)
    if (!candidate) return null
    if (!candidate.getAssetID().equals(input.getAssetID())) return null

    const output = candidate.getOutput()
    if (output.getOutputID() !== AVMConstants.SECPXFEROUTPUTID) return null
    const declared = ((input.getInput() as unknown) as StandardAmountInput).getAmount()
    if (!(output as AmountOutput).getAmount().eq(declared)) return null

    return candidate
}

/**
 * Builds the full picture of a decoded transaction.
 *
 * `ownedAddresses` is the set of X-chain addresses this wallet controls, used
 * to decide which slots this user can fill.
 */
export function summarizePsat(
    decoded: DecodedPsat,
    ownedAddresses: string[],
    walletUtxo: (utxoId: string) => AVMUTXO | undefined = () => undefined
): PsatSummary {
    const baseTx = decoded.unsignedTx.getTransaction() as AVMBaseTx
    const ins = baseTx.getIns() as TransferableInput[]
    const outs = baseTx.getOuts() as TransferableOutput[]
    const creds = decoded.tx.getCredentials()
    const owned = new Set(ownedAddresses.map((a) => a.trim()))

    const inputTotals: Record<string, BN> = {}
    const outputTotals: Record<string, BN> = {}

    let hasUnresolvedOwners = false
    let missingSignatures = 0
    let canSign = false

    const inputs: PsatInputSummary[] = ins.map((input, i) => {
        const assetId = bintools.cb58Encode(input.getAssetID())
        const amount = ((input.getInput() as unknown) as StandardAmountInput).getAmount()
        inputTotals[assetId] = (inputTotals[assetId] ?? new BN(0)).add(amount)

        const source = resolveSourceUtxo(input, decoded.sourceUtxos, walletUtxo)
        const owners: string[] = source
            ? (((source.getOutput() as unknown) as OutputOwners).getAddresses() as Buffer[]).map(
                  addressToX
              )
            : []
        const threshold = source
            ? ((source.getOutput() as unknown) as OutputOwners).getThreshold()
            : 0
        if (!source) hasUnresolvedOwners = true

        const existing = creds[i] ? credentialSlots(creds[i]) : []
        const sigIdxs = input.getInput().getSigIdxs()

        const slots: PsatSlot[] = sigIdxs.map((sigIdx, j) => {
            const addressIdx = sigIdx.toBuffer().readUInt32BE(0)
            const address = owners[addressIdx] ?? null
            const signed = !!existing[j] && !isEmptySlot(existing[j])
            const mine = !!address && owned.has(address)
            if (!signed) {
                missingSignatures++
                if (mine) canSign = true
            }
            return { addressIdx, address, signed, mine }
        })

        const missing = slots.filter((s) => !s.signed).length

        return {
            utxoId: input.getUTXOID(),
            txId: bintools.cb58Encode(input.getTxID()),
            outputIdx: input.getOutputIdx().readUInt32BE(0),
            assetId,
            amount,
            owners,
            threshold,
            slots,
            isMultisig: threshold > 1,
            missing,
        }
    })

    const outputs: PsatOutputSummary[] = outs.map((out) => {
        const assetId = bintools.cb58Encode(out.getAssetID())
        const output = (out.getOutput() as unknown) as AmountOutput & OutputOwners
        const amount = output.getAmount()
        outputTotals[assetId] = (outputTotals[assetId] ?? new BN(0)).add(amount)
        const threshold = output.getThreshold()
        return {
            assetId,
            amount,
            owners: (output.getAddresses() as Buffer[]).map(addressToX),
            threshold,
            locktime: output.getLocktime(),
            isMultisig: threshold > 1,
        }
    })

    const burn: Record<string, BN> = {}
    for (const assetId of Object.keys(inputTotals)) {
        const diff = inputTotals[assetId].sub(outputTotals[assetId] ?? new BN(0))
        if (diff.gt(new BN(0))) burn[assetId] = diff
    }

    const memoBuff = baseTx.getMemo()

    return {
        networkId: baseTx.getNetworkID(),
        inputs,
        outputs,
        inputTotals,
        outputTotals,
        burn,
        memo: memoBuff && memoBuff.length ? memoBuff.toString('utf8') : '',
        complete: missingSignatures === 0,
        missingSignatures,
        canSign,
        hasUnresolvedOwners,
    }
}

/** Signs one 32-byte hash with the key for one X-chain address. */
export type HashSigner = (address: string, hash: Buffer) => Promise<Buffer>

/**
 * Adds this wallet's signatures to a decoded transaction, leaving every slot
 * it cannot fill untouched.
 *
 * Credentials are rebuilt rather than mutated: `sigArray` is protected and
 * exposes only an append-only `addSignature`, so each credential is
 * constructed fresh, slot by slot, taking the existing signature where there
 * is one and this wallet's where there is not. That also guarantees slot
 * count matches SigIdx count, which nothing in the SDK checks and the node
 * rejects opaquely.
 */
export async function signPsat(
    decoded: DecodedPsat,
    summary: PsatSummary,
    sign: HashSigner
): Promise<AVMTx> {
    const baseTx = decoded.unsignedTx.getTransaction() as AVMBaseTx
    const ins = baseTx.getIns() as TransferableInput[]
    const existingCreds = decoded.tx.getCredentials()
    const hash = signingHash(decoded.unsignedTx)

    const creds: Credential[] = []
    for (let i = 0; i < ins.length; i++) {
        const input = ins[i].getInput()
        const cred = SelectCredentialClass(input.getCredentialID())
        const existing = existingCreds[i] ? credentialSlots(existingCreds[i]) : []
        const slots = summary.inputs[i].slots

        for (let j = 0; j < slots.length; j++) {
            const slot = slots[j]
            const prior = existing[j]

            if (prior && !isEmptySlot(prior)) {
                const sig = new Signature()
                sig.fromBuffer(prior)
                cred.addSignature(sig)
                continue
            }

            if (slot.mine && slot.address) {
                const signed = await sign(slot.address, hash)
                const sig = new Signature()
                sig.fromBuffer(Buffer.from(signed))
                cred.addSignature(sig)
                continue
            }

            // Someone else's slot, or one whose owner could not be resolved —
            // a zero-filled placeholder keeps the positional correspondence
            // the node requires between SigIdxs and signatures.
            cred.addSignature(new Signature())
        }
        creds.push(cred)
    }

    return new AVMTx(decoded.unsignedTx, creds)
}

/** The source UTXOs a decoded transaction still carries, for re-sharing. */
export function sourceUtxoList(decoded: DecodedPsat): AVMUTXO[] {
    return [...decoded.sourceUtxos.values()]
}
