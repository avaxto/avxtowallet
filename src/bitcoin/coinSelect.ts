/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Transaction sizing, fee calculation and UTXO selection.
 *
 * This is the part of a Bitcoin wallet where arithmetic mistakes cost real,
 * unrecoverable money, so every number below is stated with its derivation
 * rather than dropped in as a magic constant.
 *
 * Fees are paid per *virtual byte*. Since SegWit, a transaction's size for fee
 * purposes is `(base_size * 3 + total_size) / 4`, which discounts witness data
 * to a quarter weight. That is why a native-SegWit input costs roughly 68 vB
 * while a legacy one costs 148 vB — the signature moved into the witness.
 *
 * The per-input/output figures are the standard worst-case sizes (assuming a
 * 72-byte DER signature, which is the largest low-S signature possible; 71 is
 * typical). Overestimating slightly means the fee is at or just above target,
 * which is the safe direction to be wrong in — underestimating produces a
 * transaction that never confirms.
 */
import type { BtcAddressType } from './networks'

/**
 * Virtual bytes added by one input, per type.
 *
 *   p2pkh        148 = 32 txid + 4 vout + 1 len + ~107 scriptSig + 4 sequence
 *   p2sh-p2wpkh   91 = 32 + 4 + 1 + 23 redeemScript + 4, plus 108/4 witness
 *   p2wpkh        68 = 32 + 4 + 1 + 0 scriptSig + 4, plus 108/4 witness
 *   p2tr          58 = 32 + 4 + 1 + 0 scriptSig + 4, plus 65/4 witness
 *                      (a single 64-byte Schnorr signature — no pubkey needed)
 */
export const INPUT_VBYTES: Record<BtcAddressType, number> = {
    'p2pkh': 148,
    'p2sh-p2wpkh': 91,
    'p2wpkh': 68,
    'p2tr': 58,
}

/**
 * Virtual bytes added by one output, per type. Each is
 * `8 (value) + 1 (script length) + scriptPubKey length`.
 *
 *   p2pkh  34 = 8 + 1 + 25
 *   p2sh   32 = 8 + 1 + 23
 *   p2wpkh 31 = 8 + 1 + 22
 *   p2tr   43 = 8 + 1 + 34
 */
export const OUTPUT_VBYTES: Record<BtcAddressType, number> = {
    'p2pkh': 34,
    'p2sh-p2wpkh': 32,
    'p2wpkh': 31,
    'p2tr': 43,
}

/**
 * Fixed per-transaction overhead: 4 version + 1 input count + 1 output count
 * + 4 locktime = 10, plus 0.5 vB for the SegWit marker and flag (2 bytes at
 * quarter weight) whenever any input is segwit. 11 covers both cases and errs
 * high by half a byte on a legacy-only transaction.
 */
export const TX_OVERHEAD_VBYTES = 11

/**
 * Outputs below this are "dust" — the network will not relay them, because
 * they would cost more to spend than they are worth.
 *
 * The real threshold is per-type (546 sats for P2PKH, 294 for P2WPKH, 330 for
 * P2TR). 546 is the highest of them, so using it uniformly means a transaction
 * this wallet builds is never rejected as dust regardless of output type. The
 * cost is refusing a handful of technically-relayable sub-546 SegWit sends,
 * which is a far better failure than a rejected broadcast.
 */
export const DUST_THRESHOLD_SATS = 546

/** A spendable output, annotated with what it costs to spend. */
export interface SelectableUtxo {
    txid: string
    vout: number
    value: number
    /** Which of the wallet's addresses owns it — decides the input size. */
    address: string
    addressType: BtcAddressType
    /** Derivation path, so the signer can find the key again. */
    path: string
    confirmed: boolean
}

export interface CoinSelectionRequest {
    utxos: SelectableUtxo[]
    /** Amount to send, in satoshis. Ignored when `sendMax` is true. */
    targetSats: number
    feeRate: number // sat/vB
    recipientType: BtcAddressType
    changeType: BtcAddressType
    /** Sweep everything: no change output, fee comes out of the amount. */
    sendMax?: boolean
}

export interface CoinSelectionResult {
    inputs: SelectableUtxo[]
    /** What the recipient actually receives. Equals `targetSats` unless sendMax. */
    outputSats: number
    /** Change back to the wallet, or 0 when there is none. */
    changeSats: number
    feeSats: number
    vbytes: number
}

/** Size of a transaction with these inputs and outputs. */
export function estimateVbytes(
    inputs: { addressType: BtcAddressType }[],
    outputTypes: BtcAddressType[]
): number {
    const inputVb = inputs.reduce((sum, i) => sum + INPUT_VBYTES[i.addressType], 0)
    const outputVb = outputTypes.reduce((sum, t) => sum + OUTPUT_VBYTES[t], 0)
    return TX_OVERHEAD_VBYTES + inputVb + outputVb
}

/**
 * Chooses which UTXOs to spend.
 *
 * Strategy is **largest-first accumulation**. It is not the most
 * privacy-preserving or the most UTXO-set-friendly choice — branch-and-bound
 * would find changeless solutions more often — but it is deterministic, easy
 * to reason about, and reliably minimises the *number* of inputs, which is
 * what keeps the fee down. Given this is a wallet's first Bitcoin
 * implementation, a selection algorithm whose output can be predicted by
 * reading it is worth more than a cleverer one that is hard to verify.
 *
 * Confirmed UTXOs are preferred over unconfirmed ones: spending an
 * unconfirmed output chains transactions, and if the parent is evicted the
 * child dies with it.
 */
export function selectCoins(req: CoinSelectionRequest): CoinSelectionResult {
    const { utxos, feeRate, recipientType, changeType, sendMax } = req

    if (feeRate <= 0) throw new Error('Fee rate must be greater than zero.')
    if (utxos.length === 0) throw new Error('This wallet has no spendable outputs.')

    // Confirmed first, then largest first within each group.
    const sorted = [...utxos].sort((a, b) => {
        if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1
        return b.value - a.value
    })

    if (sendMax) {
        return selectAll(sorted, feeRate, recipientType)
    }

    const targetSats = Math.floor(req.targetSats)
    if (targetSats <= 0) throw new Error('Enter an amount greater than zero.')
    if (targetSats < DUST_THRESHOLD_SATS) {
        throw new Error(
            `Amount is below the dust limit (${DUST_THRESHOLD_SATS} sats). ` +
                'The network would not relay it.'
        )
    }

    const chosen: SelectableUtxo[] = []
    let total = 0

    for (const utxo of sorted) {
        chosen.push(utxo)
        total += utxo.value

        // Cost if we finish here WITH a change output...
        const withChangeVb = estimateVbytes(chosen, [recipientType, changeType])
        const withChangeFee = Math.ceil(withChangeVb * feeRate)
        const change = total - targetSats - withChangeFee

        if (change >= DUST_THRESHOLD_SATS) {
            return {
                inputs: chosen,
                outputSats: targetSats,
                changeSats: change,
                feeSats: withChangeFee,
                vbytes: withChangeVb,
            }
        }

        // ...and if we finish here WITHOUT one, letting the would-be dust
        // change go to the miner instead. Creating a sub-dust change output is
        // not an option — the network would reject the transaction — so the
        // choice is between donating it and adding another input.
        const noChangeVb = estimateVbytes(chosen, [recipientType])
        const noChangeFee = Math.ceil(noChangeVb * feeRate)
        if (total >= targetSats + noChangeFee && change < DUST_THRESHOLD_SATS) {
            return {
                inputs: chosen,
                outputSats: targetSats,
                changeSats: 0,
                // Everything not going to the recipient is the fee, by
                // definition — an unspent remainder would be burned.
                feeSats: total - targetSats,
                vbytes: noChangeVb,
            }
        }
    }

    // Ran out of UTXOs. Report the shortfall against the cheapest possible
    // completion so the number shown is achievable rather than pessimistic.
    const finalVb = estimateVbytes(sorted, [recipientType])
    const needed = targetSats + Math.ceil(finalVb * feeRate)
    throw new Error(
        `Not enough BTC. This transfer needs ${formatSats(needed)} including the fee, ` +
            `but only ${formatSats(total)} is spendable.`
    )
}

/** Sweep: every UTXO in, one output out, fee deducted from the amount. */
function selectAll(
    utxos: SelectableUtxo[],
    feeRate: number,
    recipientType: BtcAddressType
): CoinSelectionResult {
    const total = utxos.reduce((sum, u) => sum + u.value, 0)
    const vbytes = estimateVbytes(utxos, [recipientType])
    const feeSats = Math.ceil(vbytes * feeRate)
    const outputSats = total - feeSats

    if (outputSats < DUST_THRESHOLD_SATS) {
        throw new Error(
            `After a ${formatSats(feeSats)} fee there would be ${formatSats(
                Math.max(outputSats, 0)
            )} left, which is below the dust limit. There is not enough to send.`
        )
    }

    return { inputs: utxos, outputSats, changeSats: 0, feeSats, vbytes }
}

function formatSats(sats: number): string {
    return `${sats.toLocaleString('en-US')} sats`
}
