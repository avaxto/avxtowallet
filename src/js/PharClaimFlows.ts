/*
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.

*/
/**
 * Multi-step reward claims for the PHAR Dashboard, built from the single
 * steps the wallet already has:
 *
 *  - claimAndUnwrap: claim the AutoVault rewards (paid in WAVAX), then unwrap
 *    exactly what the claim paid into C-Chain AVAX — 100% of the rewards and
 *    none of any WAVAX the wallet already held.
 *  - claimToXChain: the above, then send that AVAX to X-Chain: a C→X export of
 *    everything left after the export and import fees, then the import on X —
 *    the same fee rules and sequence as the Cross Chain page.
 *
 * Steps report progress through `onStep`, so the page can show where a long
 * flow is, and which step to look at if one fails after earlier ones landed.
 */
import { BN } from '@/avalanche'
import type { EvmSigner } from '@/evm/signer'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { GasHelper } from '@/avalanche-wallet-sdk'
import { avm } from '@/AVA'
import { isOfflineTxId } from '@/stores/offlineSigning'
import { AUTOVAULT_ADDRESS, claimAutoVaultRewards, type ClaimResult } from '@/js/PharAutoVault'
import { WAVAX_ADDRESS, unwrapWavax } from '@/js/PharSwap'

export type FlowStep = 'claim' | 'unwrap' | 'export' | 'import'
export type StepState = 'running' | 'done'

export interface ClaimUnwrapResult {
    claim: ClaimResult
    unwrapTxHash: string
    /** AVAX unwrapped, in wei (18 decimals). */
    unwrapped: BN
    /** Captured by offline signing rather than broadcast. */
    offline: boolean
}

const lower = (a: string) => a.toLowerCase()

const PREF_ABI = [
    {
        name: 'outputPreference',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [{ name: '', type: 'address' }],
    },
]

/** The payout token the vault will pay `signer` in. */
async function payoutToken(signer: EvmSigner): Promise<string> {
    const v = new (signer.reader().eth.Contract)(PREF_ABI as any, AUTOVAULT_ADDRESS).methods
    return String(await v.outputPreference(signer.address).call())
}

async function wavaxBalance(signer: EvmSigner): Promise<BN> {
    // @ts-ignore - web3 typing for dynamic ABI
    const t = new (signer.reader().eth.Contract)(ERC20Abi.abi as any, WAVAX_ADDRESS).methods
    return new BN(String(await t.balanceOf(signer.address).call()))
}

/**
 * Claims, then unwraps exactly the WAVAX the claim paid. Needs the payout
 * token to be WAVAX. Run inside an authorization scope covering two signatures.
 */
export async function claimAndUnwrap(
    signer: EvmSigner,
    onStep: (step: FlowStep, state: StepState) => void = () => {}
): Promise<ClaimUnwrapResult> {
    // Checked before anything is sent: claiming first and only then finding
    // the rewards aren't WAVAX would leave a claim the user didn't ask for alone.
    if (lower(await payoutToken(signer)) !== lower(WAVAX_ADDRESS)) {
        throw new Error(
            'Your AutoVault rewards are not paid in WAVAX, so they cannot be unwrapped to AVAX. Change your payout token to WAVAX on phar.gg, or use Claim rewards.'
        )
    }
    const before = await wavaxBalance(signer)
    // Offline signing captures both before either is broadcast, so the unwrap
    // is sequenced on the next nonce explicitly.
    const baseNonce = await signer.getNonce()

    onStep('claim', 'running')
    const claim = await claimAutoVaultRewards(signer, { nonce: baseNonce })
    onStep('claim', 'done')

    let amount: BN
    if (claim.offline) {
        // Nothing mined, so no balance change to measure: unwrap what was pending.
        amount = claim.amount
    } else {
        // Exactly what the claim paid — never WAVAX the wallet held before.
        const after = await wavaxBalance(signer)
        amount = after.sub(before)
        if (amount.lte(new BN(0))) throw new Error('The claim paid no WAVAX, so there is nothing to unwrap.')
    }

    onStep('unwrap', 'running')
    const unwrapTxHash = await unwrapWavax(signer, amount, { nonce: claim.offline ? baseNonce + 1 : undefined })
    onStep('unwrap', 'done')
    return { claim, unwrapTxHash, unwrapped: amount, offline: claim.offline }
}

// ─── To X-Chain ────────────────────────────────────────────────────────────

/** The Avalanche wallet surface the C→X transfer needs. */
export interface CrossChainWallet {
    getEvmAddress(): string
    getIndexZeroAddressAvm(): string
    exportFromCChain(amt: BN, destinationChain: 'X', exportFee: BN): Promise<string>
    importToXChain(sourceChain: 'C'): Promise<string>
}

export interface CrossChainDeps {
    /** C-Chain base fee in wei. */
    getBaseFee(): Promise<BN>
    /** Gas the C→X export of `amountNAvax` will use. */
    estimateExportGas(amountNAvax: BN, fromHex: string, toX: string): number
    /** X-Chain import fee, nAVAX. */
    xImportFee(): BN
    sleep(ms: number): Promise<void>
}

const defaultDeps: CrossChainDeps = {
    getBaseFee: () => GasHelper.getBaseFee(),
    estimateExportGas: (amt, from, to) => GasHelper.estimateExportGasFeeFromMockTx('X', amt, from, to),
    xImportFee: () => avm.getTxFee(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
}

/** Wait before importing, as the Cross Chain page does, for the export's UTXO to reach atomic memory. */
export const IMPORT_DELAY_MS = 5000
const IMPORT_ATTEMPTS = 4
const WEI_PER_NAVAX = new BN(1_000_000_000)
/** The Cross Chain page's floor for the base fee used to price an export. */
const MIN_BASE_FEE = new BN('50000000000') // 50 gwei

export interface CrossChainFees {
    /** nAVAX. */
    exportFee: BN
    importFee: BN
    /** What arrives on X-Chain, nAVAX. */
    sent: BN
}

/**
 * Splits `availableNAvax` into what reaches X-Chain and the two fees.
 * The export fee is priced at twice the current base fee, as the Cross Chain
 * page does: the base fee can rise ~1.6x in the blocks between pricing and
 * inclusion, and an underpriced export is rejected.
 */
export async function planCrossChain(
    availableNAvax: BN,
    wallet: CrossChainWallet,
    deps: CrossChainDeps = defaultDeps
): Promise<CrossChainFees> {
    const baseFee = BN.max((await deps.getBaseFee()).muln(2), MIN_BASE_FEE)
    const gas = deps.estimateExportGas(availableNAvax, wallet.getEvmAddress(), wallet.getIndexZeroAddressAvm())
    const feeWei = baseFee.mul(new BN(gas))
    // Round the fee up to whole nAVAX so it is never short.
    const exportFee = feeWei.add(WEI_PER_NAVAX.subn(1)).div(WEI_PER_NAVAX)
    const importFee = deps.xImportFee()
    const sent = availableNAvax.sub(exportFee).sub(importFee)
    return { exportFee, importFee, sent }
}

export interface ClaimToXResult extends ClaimUnwrapResult {
    exportTxId: string
    importTxId: string
    fees: CrossChainFees
}

/**
 * Claim → unwrap → export to X → import on X. Every step must be broadcast and
 * mined before the next, so this refuses to run under offline signing. Run
 * inside an `authorizeCrossChain` scope (four signatures, across the delay).
 */
export async function claimToXChain(
    signer: EvmSigner,
    wallet: CrossChainWallet,
    opts: { offlineSigning: boolean; onStep?: (step: FlowStep, state: StepState) => void; deps?: CrossChainDeps }
): Promise<ClaimToXResult> {
    if (opts.offlineSigning) {
        throw new Error(
            'Claiming to X-Chain broadcasts four transactions in sequence, each needing the last one mined. Turn off offline signing to use it.'
        )
    }
    const onStep = opts.onStep ?? (() => {})
    const deps = opts.deps ?? defaultDeps

    const unwrapped = await claimAndUnwrap(signer, onStep)

    // C-Chain AVAX has 18 decimals, cross-chain amounts 9: the sub-nAVAX dust stays on C.
    const availableNAvax = unwrapped.unwrapped.div(WEI_PER_NAVAX)
    const fees = await planCrossChain(availableNAvax, wallet, deps)
    if (fees.sent.lte(new BN(0))) {
        throw new Error('The claimed rewards are too small to cover the cross-chain fees. They are on C-Chain as AVAX.')
    }

    onStep('export', 'running')
    const exportTxId = await wallet.exportFromCChain(fees.sent, 'X', fees.exportFee)
    if (isOfflineTxId(exportTxId)) throw new Error('The export was captured, not sent — nothing to import yet.')
    onStep('export', 'done')

    onStep('import', 'running')
    let importTxId = ''
    for (let attempt = 1; ; attempt++) {
        await deps.sleep(IMPORT_DELAY_MS)
        try {
            importTxId = await wallet.importToXChain('C')
            break
        } catch (e: any) {
            // The export's UTXO can take a moment to become importable.
            const notYet = /nothing to import/i.test(String(e?.message ?? e))
            if (!notYet || attempt >= IMPORT_ATTEMPTS) throw e
        }
    }
    onStep('import', 'done')

    return { ...unwrapped, exportTxId, importTxId, fees }
}
