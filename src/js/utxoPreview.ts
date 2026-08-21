/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Which UTXOs a pending X or P chain transaction will actually consume.
 *
 * Coin selection on the UTXO chains happens inside
 * `UTXOSet.getMinimumSpendable`, deep in the build, at submit time — so until
 * now the user typed an amount and found out afterwards which of their coins
 * had been spent, and how much change came back. On a chain where a "10 AVAX"
 * send can consume a 500 AVAX UTXO and mint 490 of change, that is worth
 * seeing before signing.
 *
 * **The preview runs the real builder.** It does not reimplement selection —
 * it calls the same `buildUnsignedTransaction` / `buildExportTx` the submit
 * path calls and reads the inputs back off the result. Anything less would
 * drift from what actually gets signed, which for a preview of "what am I
 * about to spend" is worse than showing nothing. Both builders are pure:
 * they select against a UTXO set and return an unsigned transaction, mutating
 * neither the set nor the wallet, so calling one per keystroke is safe.
 *
 * The C chain has no equivalent — it is account-based, with a balance rather
 * than coins — which is exactly why this covers X and P only.
 */
import { BN } from '@/avalanche'
import type { Buffer } from '@/avalanche'
import type { StandardAmountInput } from '@/avalanche/common/input'
import type { StandardTransferableInput } from '@/avalanche/common/input'
import type { OutputOwners } from '@/avalanche/common/output'
import { bintools } from '@/AVA'
import { addressToX } from '@/js/multisig/psat'

/** One UTXO a transaction will spend. */
export interface UtxoPreviewRow {
    /** `txid:outputIdx`, the UTXO's own identity. */
    utxoId: string
    txId: string
    outputIdx: number
    assetId: string
    amount: BN
    /** Owners of the spent output, when the UTXO could be resolved. */
    owners: string[]
    /** Signatures the output requires — above 1 means a multisig coin. */
    threshold: number
    locktime: BN
}

export interface UtxoPreview {
    rows: UtxoPreviewRow[]
    /** Per-asset totals of everything being consumed, keyed by cb58 asset id. */
    totals: Record<string, BN>
    /**
     * Per-asset change coming back, keyed by cb58 asset id.
     *
     * Computed as consumed minus sent rather than read off the change
     * outputs, so it stays right regardless of how the builder happened to
     * split them.
     */
    change: Record<string, BN>
}

/** Anything exposing the inputs of a built transaction, for either chain. */
interface HasIns {
    getIns(): StandardTransferableInput[]
}

/** Looks a UTXO up by id — the wallet's own set, for owner information. */
export type UtxoLookup = (utxoId: string) => { getOutput(): unknown } | undefined

/**
 * Reads the selected inputs off a built unsigned transaction.
 *
 * `sending` is the per-asset amount actually leaving the wallet, used only to
 * derive change; pass an empty object to skip that.
 */
export function previewFromTx(
    tx: HasIns,
    lookup: UtxoLookup,
    sending: Record<string, BN> = {}
): UtxoPreview {
    const rows: UtxoPreviewRow[] = []
    const totals: Record<string, BN> = {}

    for (const input of tx.getIns()) {
        const assetId = bintools.cb58Encode(input.getAssetID())
        const amount = ((input.getInput() as unknown) as StandardAmountInput).getAmount()
        totals[assetId] = (totals[assetId] ?? new BN(0)).add(amount)

        // The owner list lives on the source output, not on the input — a
        // TransferableInput carries only txid/index/asset/amount. Missing it
        // costs the owner column and nothing else.
        const utxo = lookup(input.getUTXOID())
        const output = utxo ? (utxo.getOutput() as OutputOwners) : null

        rows.push({
            utxoId: input.getUTXOID(),
            txId: bintools.cb58Encode(input.getTxID()),
            outputIdx: input.getOutputIdx().readUInt32BE(0),
            assetId,
            amount,
            owners: output ? (output.getAddresses() as Buffer[]).map(addressToX) : [],
            threshold: output ? output.getThreshold() : 1,
            locktime: output ? output.getLocktime() : new BN(0),
        })
    }

    // Largest first: the big UTXO is the one whose selection is surprising.
    rows.sort((a, b) => b.amount.cmp(a.amount))

    const change: Record<string, BN> = {}
    for (const assetId of Object.keys(totals)) {
        const out = sending[assetId] ?? new BN(0)
        const diff = totals[assetId].sub(out)
        if (diff.gt(new BN(0))) change[assetId] = diff
    }

    return { rows, totals, change }
}

/** True when a preview has nothing to show. */
export function isEmptyPreview(preview: UtxoPreview | null): boolean {
    return !preview || preview.rows.length === 0
}
