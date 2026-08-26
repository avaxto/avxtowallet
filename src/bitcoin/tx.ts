/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Building and signing Bitcoin transactions, via PSBT.
 *
 * The four address types this wallet derives need four different things in a
 * PSBT input, which is the main reason this file exists rather than a few
 * lines inline:
 *
 *   `p2wpkh`       `witnessUtxo` — just the output being spent. SegWit commits
 *                  to the input value in the signature, so the previous
 *                  transaction is not needed.
 *   `p2sh-p2wpkh`  `witnessUtxo` plus `redeemScript` (the wrapped P2WPKH
 *                  program), which is what the scriptSig reveals.
 *   `p2pkh`        `nonWitnessUtxo` — the ENTIRE previous transaction. Legacy
 *                  signatures do not commit to the input value, so a signer
 *                  cannot verify the amount without it; bitcoinjs enforces
 *                  this, and it is the reason spending legacy inputs needs an
 *                  extra fetch per input.
 *   `p2tr`         `witnessUtxo` plus `tapInternalKey`, and the key itself
 *                  must be tweaked before signing (BIP-341).
 *
 * Every signing path here expects to run inside an authorized scope — the
 * caller derives keys from a vaulted seed and is responsible for wiping them.
 */
import * as bitcoin from 'bitcoinjs-lib'

import { ECPair, scriptForAddress } from './keys'
import { getTxHex } from './esplora'
import type { BitcoinNetwork } from './networks'
import type { CoinSelectionResult, SelectableUtxo } from './coinSelect'

/**
 * The minimum a signing key has to provide.
 *
 * Deliberately structural rather than `BIP32Interface`: an HD wallet signs
 * with a derived BIP32 node, but a single imported WIF key is an ECPair with
 * no derivation behind it, and both satisfy this. `privateKey` is required
 * only by the taproot path, which has to tweak the key rather than use it
 * directly.
 */
export interface TxSigner {
    publicKey: Uint8Array
    privateKey?: Uint8Array | null
    sign(hash: Uint8Array): Uint8Array
}

export interface BuildTxRequest {
    selection: CoinSelectionResult
    toAddress: string
    /** Where change goes. Ignored when the selection produced none. */
    changeAddress: string
    network: BitcoinNetwork
    /**
     * Resolves the signing key for one of the wallet's derivation paths.
     * Returning the key object rather than raw bytes lets the taproot path
     * tweak it (see `tweakForTaproot`).
     */
    signerFor: (path: string) => TxSigner
}

/**
 * Adds the type-specific fields one input needs.
 *
 * `nonWitnessUtxo` is fetched lazily and only for legacy inputs — it is a full
 * transaction, often several kilobytes, and every other type does without it.
 */
async function addInput(
    psbt: bitcoin.Psbt,
    utxo: SelectableUtxo,
    network: BitcoinNetwork,
    signerPubkey: Uint8Array
): Promise<void> {
    const script = scriptForAddress(utxo.address, network)

    const base = {
        hash: utxo.txid,
        index: utxo.vout,
        // Opt in to RBF. Signalling it costs nothing and leaves the option to
        // fee-bump a stuck transaction; the alternative is a transaction that
        // can only be waited out.
        sequence: 0xfffffffd,
    }

    switch (utxo.addressType) {
        case 'p2pkh': {
            const hex = await getTxHex(utxo.txid, network)
            psbt.addInput({
                ...base,
                nonWitnessUtxo: Buffer.from(hex, 'hex'),
            })
            break
        }

        case 'p2sh-p2wpkh': {
            const p2wpkh = bitcoin.payments.p2wpkh({
                pubkey: signerPubkey,
                network: network.params,
            })
            psbt.addInput({
                ...base,
                witnessUtxo: { script, value: BigInt(utxo.value) },
                redeemScript: p2wpkh.output!,
            })
            break
        }

        case 'p2wpkh': {
            psbt.addInput({
                ...base,
                witnessUtxo: { script, value: BigInt(utxo.value) },
            })
            break
        }

        case 'p2tr': {
            psbt.addInput({
                ...base,
                witnessUtxo: { script, value: BigInt(utxo.value) },
                tapInternalKey: bitcoin.toXOnly(signerPubkey),
            })
            break
        }
    }
}

/**
 * BIP-341 key tweaking for a taproot key-path spend.
 *
 * A taproot output commits to `internalKey + H(internalKey)G`, not to the
 * internal key itself, so the signature must come from the correspondingly
 * tweaked private key. Signing with the untweaked key produces a valid-looking
 * signature that the network rejects.
 */
function tweakForTaproot(node: TxSigner) {
    if (!node.privateKey) {
        throw new Error('Cannot sign a taproot input without a private key.')
    }
    return ECPair.fromPrivateKey(Buffer.from(node.privateKey), {
        network: undefined,
    }).tweak(
        Buffer.from(bitcoin.crypto.taggedHash('TapTweak', Buffer.from(bitcoin.toXOnly(node.publicKey))))
    )
}

export interface BuiltTx {
    hex: string
    txid: string
    vsize: number
    /** Fee the built transaction actually pays, recomputed from its own bytes. */
    feeSats: number
}

/**
 * Builds, signs, finalises and verifies a transaction.
 *
 * The final fee is recomputed from the *real* signed size rather than trusted
 * from the estimate — `coinSelect` deliberately overestimates input sizes, so
 * the actual rate paid is at or slightly above target, and reporting the
 * estimate would misstate it.
 */
export async function buildAndSignTx(req: BuildTxRequest): Promise<BuiltTx> {
    const { selection, toAddress, changeAddress, network, signerFor } = req
    const psbt = new bitcoin.Psbt({ network: network.params })

    // Resolve every signing key up front so an input can be described with its
    // own public key (P2SH-P2WPKH and P2TR both need it before signing).
    const nodes = new Map<string, TxSigner>()
    for (const utxo of selection.inputs) {
        if (!nodes.has(utxo.path)) nodes.set(utxo.path, signerFor(utxo.path))
    }

    for (const utxo of selection.inputs) {
        const node = nodes.get(utxo.path)!
        await addInput(psbt, utxo, network, node.publicKey)
    }

    psbt.addOutput({ address: toAddress, value: BigInt(selection.outputSats) })
    if (selection.changeSats > 0) {
        psbt.addOutput({ address: changeAddress, value: BigInt(selection.changeSats) })
    }

    // Sign each input with the key that owns it.
    selection.inputs.forEach((utxo, i) => {
        const node = nodes.get(utxo.path)!
        if (utxo.addressType === 'p2tr') {
            psbt.signTaprootInput(i, tweakForTaproot(node))
        } else {
            psbt.signInput(i, {
                publicKey: Buffer.from(node.publicKey),
                sign: (hash: Buffer) => Buffer.from(node.sign(hash)),
            })
        }
    })

    psbt.finalizeAllInputs()

    const tx = psbt.extractTransaction()

    // psbt.getFee() cross-checks inputs against outputs from the PSBT's own
    // record of input values — a mismatch here would mean the transaction pays
    // a different fee than intended, which is exactly the mistake worth
    // catching before broadcast rather than after.
    const feeSats = Number(psbt.getFee())

    return {
        hex: tx.toHex(),
        txid: tx.getId(),
        vsize: tx.virtualSize(),
        feeSats,
    }
}

/**
 * Sanity limit on the fee a single transaction may pay, as a multiple of what
 * was intended. Guards against a sizing bug quietly handing the difference to
 * a miner — an overpaid fee is as unrecoverable as sending to a wrong address.
 */
export const MAX_FEE_OVERSHOOT = 3

export function assertFeeSane(actualFee: number, expectedFee: number): void {
    if (actualFee > expectedFee * MAX_FEE_OVERSHOOT) {
        throw new Error(
            `Refusing to broadcast: the built transaction pays ${actualFee.toLocaleString()} sats ` +
                `in fees, far more than the ${expectedFee.toLocaleString()} sats expected. ` +
                'This is a bug — nothing has been sent.'
        )
    }
}
