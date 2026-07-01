/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
import { AbstractWallet } from '@/js/wallets/AbstractWallet'
import { useStatusBarStore } from '@/stores/statusbar'
import { ava, bintools } from '@/AVA'

interface PendingImport {
    dest: 'X' | 'P' | 'C'
    source: string
    count: number
}

/**
 * Checks atomic memory on X, P, and C chains for UTXOs waiting to be imported.
 * If any are found, emits a single combined warning via the status bar.
 * All six source→destination combinations are checked in parallel.
 */
export async function checkPendingImports(wallet: AbstractWallet): Promise<void> {
    const checks: Promise<PendingImport | null>[] = [
        // X-chain: waiting imports from P or C
        wallet
            .avmGetAtomicUTXOs('P')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'X' as const, source: 'P', count: n } : null
            })
            .catch(() => null),
        wallet
            .avmGetAtomicUTXOs('C')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'X' as const, source: 'C', count: n } : null
            })
            .catch(() => null),

        // P-chain: waiting imports from X or C
        wallet
            .platformGetAtomicUTXOs('X')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'P' as const, source: 'X', count: n } : null
            })
            .catch(() => null),
        wallet
            .platformGetAtomicUTXOs('C')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'P' as const, source: 'C', count: n } : null
            })
            .catch(() => null),

        // C-chain: waiting imports from X or P
        wallet
            .evmGetAtomicUTXOs('X')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'C' as const, source: 'X', count: n } : null
            })
            .catch(() => null),
        wallet
            .evmGetAtomicUTXOs('P')
            .then((set) => {
                const n = set.getAllUTXOs().length
                return n > 0 ? { dest: 'C' as const, source: 'P', count: n } : null
            })
            .catch(() => null),
    ]




    const results = await Promise.all(checks)
    console.log('Pending import check results:', results)
    const pending = results.filter((r): r is PendingImport => r !== null)
    console.log('Pending imports found:', pending)

    if (pending.length === 0) {
        useStatusBarStore().clear()
        return
    }

    const parts = pending.map(
        (p) =>
            `${p.count} UTXO${p.count > 1 ? 's' : ''} on ${p.dest}-Chain from ${p.source}-Chain`
    )

    const message =
        pending.length === 1
            ? `Pending import: ${parts[0]}. Visit Advanced → Import to claim.`
            : `Pending imports: ${parts.join(', ')}. Visit Advanced → Import to claim.`

    useStatusBarStore().warning(message)
}
