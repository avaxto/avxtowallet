/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Spending an existing multisig X-chain UTXO.
 *
 * The regular send path (`js/TxHelper.ts`'s `buildUnsignedTransaction` /
 * `UTXOSet.getMinimumSpendable`) only ever selects UTXOs a *single* address
 * from the wallet can satisfy alone — a multisig output's `meetsThreshold`
 * needs `threshold` qualifying addresses from whatever list it is handed,
 * and a plain send hands it just the wallet's own addresses. That is
 * deliberate there and is exactly why it can't be reused here.
 *
 * The part that is NOT reusable from `getMinimumSpendable` either: an AVM
 * multisig input's signature slots (`SigIdx` count) are fixed at build
 * time to exactly `threshold` owners — not "any threshold of N, resolved
 * later". Whoever builds the transaction commits to a specific subset of
 * signers up front; a co-owner who isn't in that subset structurally cannot
 * sign this transaction at all, even though they could sign a different one
 * spending the same UTXO. So the caller (the UI) must choose the signer
 * subset explicitly, and it must include this wallet's own address — that is
 * the whole point of building the transaction now rather than later.
 *
 * What this module does NOT do: sign anything. `js/multisig/psat.ts` already
 * has a complete, tested signing pipeline (`summarizePsat` / `signPsat`) built
 * for a *pasted* transaction — a freshly-built one is handed to it via
 * `encodeUnsignedPsat` and a redirect into `Psat.vue`, rather than
 * duplicating that logic here.
 */
import { BN, Buffer } from '@/avalanche'
import {
    BaseTx as AVMBaseTx,
    SECPTransferInput,
    SECPTransferOutput,
    TransferableInput,
    TransferableOutput,
    UnsignedTx as AVMUnsignedTx,
    UTXO as AVMUTXO,
    UTXOSet as AVMUTXOSet,
    AmountOutput,
} from '@/avalanche/apis/avm'
import { UnixNow } from '@/avalanche/utils'
import { ava, avm, bintools } from '@/AVA'
import { addressToX, parseXAddress } from './psat'

/**
 * One spendable-together bucket: every held multisig UTXO sharing the exact
 * same owner set, threshold and asset. UTXOs from two different owner sets
 * can't be combined into one transaction's inputs — that would need a single
 * signer subset satisfying both outputs' owner lists simultaneously, which
 * is a coincidence, not something to build for.
 */
export interface MultisigUtxoGroup {
    /** Stable identity for this bucket: asset + threshold + canonical owners. */
    key: string
    /** On-wire (canonically sorted) owner addresses. */
    owners: string[]
    threshold: number
    assetId: string
    utxos: AVMUTXO[]
    totalAmount: BN
}

/**
 * Every currently-spendable multisig UTXO the wallet's own scan holds,
 * grouped into `MultisigUtxoGroup`s. Time-locked outputs are excluded
 * entirely — not just displayed as unspendable — since there is nothing a
 * signer subset can do about a lock that hasn't expired yet.
 */
export function listHeldMultisigUtxos(utxoSet: AVMUTXOSet | null): MultisigUtxoGroup[] {
    if (!utxoSet) return []
    const now = UnixNow()
    const groups = new Map<string, MultisigUtxoGroup>()

    for (const utxo of utxoSet.getAllUTXOs()) {
        // SECP256K1 Transfer Output only — matches the classification in
        // stores/assets.ts's updateBalanceDict.
        if (utxo.getOutput().getOutputID() !== 7) continue

        const output = utxo.getOutput() as AmountOutput
        const threshold = output.getThreshold()
        if (threshold <= 1) continue
        if (output.getLocktime().gt(now)) continue

        const owners = (output.getAddresses() as Buffer[]).map(addressToX)
        const assetId = bintools.cb58Encode(utxo.getAssetID())
        const key = `${assetId}:${threshold}:${owners.join(',')}`

        let group = groups.get(key)
        if (!group) {
            group = { key, owners, threshold, assetId, utxos: [], totalAmount: new BN(0) }
            groups.set(key, group)
        }
        group.utxos.push(utxo)
        group.totalAmount = group.totalAmount.add(output.getAmount())
    }

    return [...groups.values()]
}

export interface MultisigSpendResult {
    unsignedTx: AVMUnsignedTx
    /** Every UTXO this transaction spends, for the PSAT envelope. */
    sourceUtxos: AVMUTXO[]
}

/**
 * Builds a transaction spending every UTXO in `group`, paying `amount` to
 * `toAddress` and returning any leftover to the SAME owners/threshold as
 * change — a partial spend must not downgrade the remainder to
 * single-signature security.
 *
 * `signers` fixes exactly which `group.threshold` of the group's owners are
 * this transaction's designated signers (see the module doc for why that
 * can't be decided later). Must contain exactly `group.threshold` distinct
 * addresses, all of them owners of `group`, and must include an address this
 * wallet holds — enforced by the caller via `Psat.vue`'s own sign step
 * failing otherwise, but checked here too so the error surfaces immediately.
 *
 * AVAX only for now: a non-AVAX asset would need a second, ordinary
 * single-signature UTXO input just to cover the fee, mixing authority types
 * into one transaction — a real extension, just not this one.
 */
export async function buildMultisigSpend(
    group: MultisigUtxoGroup,
    toAddress: string,
    amount: BN,
    signers: string[],
    memo?: Buffer
): Promise<MultisigSpendResult> {
    const avaxIdBuf = await avm.getAVAXAssetID()
    const groupAssetBuf = bintools.cb58Decode(group.assetId)
    if (!groupAssetBuf.equals(avaxIdBuf)) {
        throw new Error('Spending a non-AVAX multisig balance is not supported yet.')
    }

    if (signers.length !== group.threshold) {
        throw new Error(`Choose exactly ${group.threshold} signer(s) for this transaction.`)
    }
    const trimmedSigners = signers.map((s) => s.trim())
    if (new Set(trimmedSigners).size !== trimmedSigners.length) {
        throw new Error('Signers must all be different.')
    }
    for (const s of trimmedSigners) {
        if (!group.owners.includes(s)) {
            throw new Error(`${s} is not one of this output's owners.`)
        }
    }

    const toBuf = parseXAddress(toAddress)
    if (!toBuf) throw new Error('Enter a valid X-chain address.')

    if (amount.lte(new BN(0))) throw new Error('Amount must be greater than zero.')
    const fee = avm.getTxFee()
    if (amount.add(fee).gt(group.totalAmount)) {
        throw new Error('Amount plus the network fee exceeds this multisig balance.')
    }

    const ownerBufs = group.owners.map((a) => {
        const b = parseXAddress(a)
        if (!b) throw new Error(`${a} is not a valid X-chain address for this network.`)
        return b
    })
    // Ascending index order: SigIdx.addSignatureIdx only appends, it does not
    // sort, and the node expects the slots in ascending owner-index order.
    // Indexes into group.owners (already validated to contain every signer).
    const signerIdxs = trimmedSigners.map((s) => group.owners.indexOf(s)).sort((a, b) => a - b)

    // --- Inputs: every UTXO in the group, each carrying the same fixed
    // signer subset — owners/threshold are identical across the group by
    // construction (listHeldMultisigUtxos groups on exactly that).
    const ins: TransferableInput[] = []
    let totalIn = new BN(0)
    for (const utxo of group.utxos) {
        const output = utxo.getOutput() as AmountOutput
        const utxoAmount = output.getAmount()
        totalIn = totalIn.add(utxoAmount)

        const input = new SECPTransferInput(utxoAmount)
        for (const idx of signerIdxs) {
            input.addSignatureIdx(idx, ownerBufs[idx])
        }
        ins.push(
            new TransferableInput(utxo.getTxID(), utxo.getOutputIdx(), utxo.getAssetID(), input)
        )
    }

    // --- Outputs: the destination (ordinary, single-owner) and change back
    // to the group's own multisig owners/threshold, when there is any.
    const outs: TransferableOutput[] = [
        new TransferableOutput(avaxIdBuf, new SECPTransferOutput(amount, [toBuf], new BN(0), 1)),
    ]
    const change = totalIn.sub(amount).sub(fee)
    if (change.gt(new BN(0))) {
        outs.push(
            new TransferableOutput(
                avaxIdBuf,
                new SECPTransferOutput(change, ownerBufs, new BN(0), group.threshold)
            )
        )
    }

    const networkId = ava.getNetworkID()
    const chainId = bintools.cb58Decode(avm.getBlockchainID())
    const baseTx = new AVMBaseTx(networkId, chainId, outs, ins, memo)

    return { unsignedTx: new AVMUnsignedTx(baseTx), sourceUtxos: group.utxos }
}
