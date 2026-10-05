/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * One Avalanche cross-chain transfer (X, P, C in any direction) as a function:
 * export from the source chain, wait for the export's UTXO to reach atomic
 * memory, import on the destination. `amount` is what ARRIVES; both fees are
 * paid on top, from the source chain.
 *
 * The fee rules are the Unify Chains page's (views/wallet/UnifyChains.vue),
 * which carry hard-won detail: C-Chain gas priced at twice the base fee (it
 * can climb ~1.6x over the export→import window), a 50 gwei floor, a 0.02
 * AVAX budget floor for C exports, and the import-into-C fee passed to both
 * legs. Must run inside one authorization scope covering both signatures.
 */
import { BN } from '@/avalanche'
import { avm, pChain } from '@/AVA'
import { GasHelper, avaxCtoX } from '@/avalanche-wallet-sdk'
import { isOfflineTxId } from '@/stores/offlineSigning'
import type { AvalancheChain } from './types'

export const IMPORT_DELAY_MS = 5000
const IMPORT_ATTEMPTS = 4
const FLOOR_PER_GAS_WEI = new BN('50000000000') // 50 gwei
const C_EXPORT_FLOOR_NAVAX = new BN(20_000_000) // 0.02 AVAX
const C_IMPORT_FALLBACK_NAVAX = new BN(600_000)

export interface CrossChainDeps {
    getBaseFee(): Promise<BN>
    xFee(): BN
    pFee(): BN
    estimateExportGas(dst: AvalancheChain, amountNAvax: BN, fromHex: string, toBech: string): number
    estimateImportGas(): number
    sleep(ms: number): Promise<void>
}

const defaultDeps: CrossChainDeps = {
    getBaseFee: () => GasHelper.getBaseFee(),
    xFee: () => avm.getTxFee(),
    pFee: () => pChain.getTxFee(),
    estimateExportGas: (dst, amt, from, to) => GasHelper.estimateExportGasFeeFromMockTx(dst as any, amt, from, to),
    estimateImportGas: () => GasHelper.estimateImportGasFeeFromMockTx(1, 1),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

export interface CrossChainFees {
    /** nAVAX. */
    exportFee: BN
    importFee: BN
}

/** The two fees for moving `amountNAvax` from `src` to `dst`, in nAVAX. */
export async function crossChainFees(
    wallet: any,
    src: AvalancheChain,
    dst: AvalancheChain,
    amountNAvax: BN,
    deps: CrossChainDeps = defaultDeps
): Promise<CrossChainFees> {
    let baseFee: BN
    try {
        baseFee = await deps.getBaseFee()
    } catch {
        baseFee = new BN('25000000000')
    }
    const perGas = BN.max(baseFee.muln(2), FLOOR_PER_GAS_WEI)
    const fee = (chain: AvalancheChain, isExport: boolean, other: AvalancheChain): BN => {
        if (chain === 'X') return deps.xFee()
        if (chain === 'P') return deps.pFee()
        const gas = isExport
            ? deps.estimateExportGas(other, amountNAvax, wallet.getEvmAddress(), wallet.getCurrentAddressPlatform())
            : deps.estimateImportGas()
        let nAvax: BN = avaxCtoX(perGas.mul(new BN(gas)))
        if (isExport) return BN.max(nAvax, C_EXPORT_FLOOR_NAVAX)
        if (nAvax.lten(0)) nAvax = C_IMPORT_FALLBACK_NAVAX
        return nAvax
    }
    return { exportFee: fee(src, true, dst), importFee: fee(dst, false, src) }
}

export interface CrossChainResult {
    exportTxId: string
    importTxId: string
    fees: CrossChainFees
}

/** Export then import. Throws with the export id in the message if the import leg fails, so funds can be found. */
export async function avalancheCrossChain(
    wallet: any,
    src: AvalancheChain,
    dst: AvalancheChain,
    amountNAvax: BN,
    onStep?: (step: 'export' | 'import', state: 'running' | 'done') => void,
    deps: CrossChainDeps = defaultDeps
): Promise<CrossChainResult> {
    const fees = await crossChainFees(wallet, src, dst, amountNAvax, deps)

    onStep?.('export', 'running')
    let exportTxId: string
    if (src === 'X') exportTxId = await wallet.exportFromXChain(amountNAvax, dst, dst === 'C' ? fees.importFee : undefined)
    else if (src === 'P') exportTxId = await wallet.exportFromPChain(amountNAvax, dst, dst === 'C' ? fees.importFee : undefined)
    else exportTxId = await wallet.exportFromCChain(amountNAvax, dst, fees.exportFee)
    if (isOfflineTxId(exportTxId)) throw new Error('The export was captured, not sent — turn off offline signing.')
    onStep?.('export', 'done')

    onStep?.('import', 'running')
    let importTxId = ''
    for (let attempt = 1; ; attempt++) {
        await deps.sleep(IMPORT_DELAY_MS)
        try {
            if (dst === 'X') importTxId = await wallet.importToXChain(src)
            else if (dst === 'P') importTxId = await wallet.importToPlatformChain(src)
            else importTxId = await wallet.importToCChain(src, fees.importFee)
            break
        } catch (e: any) {
            const notYet = /nothing to import/i.test(String(e?.message ?? e))
            if (!notYet || attempt >= IMPORT_ATTEMPTS) {
                throw new Error(
                    `The export (${exportTxId}) went through but the import on ${dst}-Chain failed: ${e?.message ?? e}. ` +
                        `Finish it from Advanced → Import.`
                )
            }
        }
    }
    onStep?.('import', 'done')
    return { exportTxId, importTxId, fees }
}
