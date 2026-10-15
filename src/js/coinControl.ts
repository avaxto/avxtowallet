/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
*/
/**
 * Coin control for X-Chain sends: let the user pick which UTXOs a transfer
 * may spend.
 *
 * Selection itself is left to the real builder (`TxHelper.buildUnsignedTransaction`
 * → `UTXOSet.getMinimumSpendable`), run against a set holding only the
 * picked UTXOs. So the picked UTXOs are the pool the transaction may draw
 * from; the builder uses as few of them as cover the amount and fee, and the
 * transfer page's UTXO preview shows exactly which ones before signing.
 *
 * The P-Chain counterpart lives in js/pChainSend.ts (it builds with the
 * Avalanche SDK, whose UTXO objects differ).
 */
import { BN } from '@/avalanche'
import type { Buffer } from '@/avalanche'
import { AVMConstants, UTXO as AVMUTXO, UTXOSet as AVMUTXOSet } from '@/avalanche/apis/avm'
import type { OutputOwners } from '@/avalanche/common/output'
import { bintools } from '@/AVA'
import { addressToX } from '@/js/multisig/psat'

/** One UTXO in the picker, in a chain-neutral shape (P-Chain rows use it too). */
export interface CoinRow {
    /** The UTXO's own identity: what selections are keyed by. */
    utxoId: string
    /** Creating transaction (cb58) and output index, for display. */
    txId: string
    outputIdx: number
    assetId: string
    amount: BN
    /** Owner addresses, chain-prefixed ("X-avax1…", "P-avax1…"). */
    owners: string[]
    /** The first owner that is this wallet's own address: where "change to the same address" sends it. */
    ownAddress?: string
    threshold: number
    /** Unix seconds; 0 = no lock. */
    locktime: number
    /** Whether this wallet can spend it alone, right now. */
    spendable: boolean
    /** Why not, when `spendable` is false. */
    reason?: string
}

/**
 * Why the wallet can't spend a UTXO on its own, or undefined when it can:
 * still time-locked, or needing more signatures than this wallet's own
 * addresses can give.
 */
export function unspendableReason(owners: string[], threshold: number, locktime: number, ownAddresses: Set<string>, now = Date.now() / 1000): string | undefined {
    if (locktime > now) return `locked until ${new Date(locktime * 1000).toLocaleString()}`
    const mine = owners.filter((o) => ownAddresses.has(o.replace(/^[XPC]-/, ''))).length
    if (mine < threshold) {
        return threshold > 1 ? `multisig: needs ${threshold} of ${owners.length} signatures (use "Spend a multisig balance")` : 'not owned by this wallet'
    }
    return undefined
}

/** The first of `owners` that belongs to the wallet, chain prefix kept. */
export function firstOwn(owners: string[], ownAddresses: Set<string>): string | undefined {
    return owners.find((o) => ownAddresses.has(o.replace(/^[XPC]-/, '')))
}

/**
 * The wallet's fungible X-Chain UTXOs (plain secp256k1 transfer outputs), largest
 * first. NFTs are picked separately on the transfer page and aren't listed.
 */
export function listXCoins(utxoSet: AVMUTXOSet, ownAddresses: string[], now = Date.now() / 1000): CoinRow[] {
    const own = new Set(ownAddresses.map((a) => a.replace(/^[XPC]-/, '')))
    const rows: CoinRow[] = []
    for (const utxo of utxoSet.getAllUTXOs() as AVMUTXO[]) {
        const out = utxo.getOutput()
        if (out.getOutputID() !== AVMConstants.SECPXFEROUTPUTID) continue
        const owners = ((out as unknown as OutputOwners).getAddresses() as Buffer[]).map(addressToX)
        const threshold = (out as unknown as OutputOwners).getThreshold()
        const locktime = Number((out as unknown as OutputOwners).getLocktime().toString())
        const reason = unspendableReason(owners, threshold, locktime, own, now)
        rows.push({
            utxoId: utxo.getUTXOID(),
            txId: bintools.cb58Encode(utxo.getTxID()),
            outputIdx: utxo.getOutputIdx().readUInt32BE(0),
            assetId: bintools.cb58Encode(utxo.getAssetID()),
            amount: (out as any).getAmount() as BN,
            owners,
            ownAddress: firstOwn(owners, own),
            threshold,
            locktime,
            spendable: !reason,
            reason,
        })
    }
    rows.sort((a, b) => b.amount.cmp(a.amount))
    return rows
}

/**
 * A UTXO set holding only the picked UTXOs, plus any `extra` ones the
 * transaction must carry regardless (the NFTs being sent).
 */
export function restrictedSet(utxoSet: AVMUTXOSet, pickedIds: string[], extra: AVMUTXO[] = []): AVMUTXOSet {
    const set = new AVMUTXOSet()
    const picked = utxoSet.getAllUTXOs(pickedIds) as AVMUTXO[]
    set.addArray([...picked, ...extra])
    return set
}

/** Per-asset totals of the picked rows, keyed by asset id. */
export function pickedTotals(rows: CoinRow[], picked: Set<string>): Record<string, BN> {
    const totals: Record<string, BN> = {}
    for (const r of rows) if (picked.has(r.utxoId)) totals[r.assetId] = (totals[r.assetId] ?? new BN(0)).add(r.amount)
    return totals
}
