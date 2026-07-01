<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="unify_page">
        <h1>Unify Chains</h1>
        <p class="desc">
            Consolidate your AVAX onto a single chain. Pick a target chain below and the wizard
            will cross-chain transfer all available AVAX from the other two chains onto it
            (network fees are reserved automatically). P-chain and X-chain assets other than AVAX
            are not affected.
        </p>

        <!-- ── Target chain selector ── -->
        <div class="card">
            <h2>Target Chain</h2>
            <p class="card_desc">All available AVAX from the other two chains will be moved here.</p>

            <div class="chain_select">
                <button
                    v-for="c in allChains"
                    :key="c"
                    type="button"
                    class="chain_btn"
                    :class="{ active: targetChain === c }"
                    :disabled="isRunning"
                    @click="targetChain = c"
                >
                    <span class="chain_badge" :class="'chain_' + c.toLowerCase()">{{ c }}</span>
                    <span class="chain_btn_label">{{ chainLabel(c) }}</span>
                </button>
            </div>

            <!-- ── Balances overview ── -->
            <div class="balances">
                <div
                    v-for="c in allChains"
                    :key="'bal-' + c"
                    class="balance_row"
                    :class="{ is_target: c === targetChain }"
                >
                    <span class="chain_badge" :class="'chain_' + c.toLowerCase()">{{ c }}</span>
                    <span class="balance_chain">{{ chainLabel(c) }}</span>
                    <span class="balance_amt">{{ formatAvax(balanceForChain(c)) }} AVAX</span>
                    <span class="balance_role">
                        <span v-if="c === targetChain" class="role_target">Target</span>
                        <span v-else-if="balanceForChain(c).gt(zero)" class="role_source">
                            → moves to {{ targetChain }}
                        </span>
                        <span v-else class="role_empty">empty</span>
                    </span>
                </div>
            </div>

            <p v-if="!hasMovableFunds && !isRunning && !isDone" class="info_msg">
                No AVAX to move — the other two chains have no spendable balance.
            </p>

            <div class="actions" v-if="!isDone">
                <v-btn
                    class="button_primary"
                    :loading="isRunning"
                    :disabled="isRunning || !hasMovableFunds"
                    @click="runUnify"
                >
                    Unify onto {{ targetChain }}-Chain
                </v-btn>
            </div>
        </div>

        <!-- ── Progress / results ── -->
        <div v-if="operations.length > 0" class="card">
            <h2>Transfers</h2>
            <p class="card_desc" v-if="isRunning">{{ currentLabel }}</p>
            <p class="card_desc" v-else-if="isDone">All transfers processed.</p>

            <div class="op_list">
                <div
                    v-for="(op, i) in operations"
                    :key="i"
                    class="op_row"
                    :class="'status_' + op.status"
                >
                    <span class="op_route">
                        <span class="chain_badge" :class="'chain_' + op.source.toLowerCase()">
                            {{ op.source }}
                        </span>
                        <fa icon="angle-right" class="op_arrow"></fa>
                        <span class="chain_badge" :class="'chain_' + op.target.toLowerCase()">
                            {{ op.target }}
                        </span>
                    </span>
                    <span class="op_amount">{{ op.amount }} AVAX</span>
                    <span class="op_status">
                        <template v-if="op.status === 'skipped'">
                            <span class="skip">→ Skipped</span>
                            <span v-if="op.error" class="op_detail">{{ op.error }}</span>
                        </template>
                        <template v-else>
                            <span class="phase" :class="'phase_' + op.exportStatus">
                                Export {{ phaseGlyph(op.exportStatus) }}
                            </span>
                            <span class="phase" :class="'phase_' + op.importStatus">
                                Import {{ phaseGlyph(op.importStatus) }}
                            </span>
                            <span v-if="op.error" class="op_detail fail">{{ op.error }}</span>
                        </template>
                    </span>
                </div>
            </div>

            <div class="actions" v-if="isDone">
                <v-btn class="button_primary" @click="reset">Done</v-btn>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, shallowRef } from 'vue'
import { useMainStore, useAssetsStore } from '@/stores'
import { avm, pChain } from '@/AVA'
import { BN } from '@/avalanche'
import AvaAsset from '@/js/AvaAsset'
import { ChainIdType } from '@/constants'
import {
    ExportChainsC,
    ExportChainsP,
    ExportChainsX,
    GasHelper,
    avaxCtoX,
    bnToAvaxX,
} from '@/avalanche-wallet-sdk'
import { AvmImportChainType } from '@/js/wallets/types'
import { sortUTxoSetP } from '@/helpers/sortUTXOs'
import { selectMaxUtxoForExportP } from '@/helpers/utxoSelection/selectMaxUtxoForExportP'

// Time for an export tx's UTXOs to land in shared/atomic memory before the
// matching import is attempted (matches ChainTransfer.vue's IMPORT_DELAY).
const IMPORT_DELAY = 5000

type Phase = 'pending' | 'running' | 'success' | 'error'

interface OpRecord {
    source: ChainIdType
    target: ChainIdType
    amount: string
    status: 'pending' | 'running' | 'success' | 'error' | 'skipped'
    exportStatus: Phase
    importStatus: Phase
    exportTxId?: string
    importTxId?: string
    error?: string
}

export default defineComponent({
    name: 'UnifyChains',
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()

        const allChains: ChainIdType[] = ['X', 'P', 'C'] // order: X, P, C
        const zero = new BN(0)

        const targetChain = ref<ChainIdType>('X')
        const isRunning = ref(false)
        const isDone = ref(false)
        const currentLabel = ref('')
        const operations = ref<OpRecord[]>([])

        // C-chain gas base fee, refreshed before a run (used for C export/import fees).
        const baseFee = shallowRef(new BN(0))

        const wallet = computed(() => mainStore.activeWallet)

        const chainLabel = (c: ChainIdType): string => {
            if (c === 'X') return 'X-Chain'
            if (c === 'P') return 'P-Chain'
            return 'C-Chain'
        }

        // ── Balances (all expressed in nAVAX, 9 decimals) ──
        const ava_asset = computed((): AvaAsset | null => assetsStore.AssetAVA)

        const xBalance = computed((): BN => (ava_asset.value ? ava_asset.value.amount : zero))
        const pBalance = computed((): BN => assetsStore.walletPlatformBalance.available)
        const cBalance = computed((): BN => {
            const w = wallet.value
            if (!w) return zero
            return avaxCtoX(w.ethBalance)
        })

        const balanceForChain = (c: ChainIdType): BN => {
            if (c === 'X') return xBalance.value
            if (c === 'P') return pBalance.value
            return cBalance.value
        }

        const hasMovableFunds = computed(() =>
            allChains.some((c) => c !== targetChain.value && balanceForChain(c).gt(zero))
        )

        const formatAvax = (bn: BN): string => bnToAvaxX(bn)

        const phaseGlyph = (p: Phase): string => {
            if (p === 'success') return '✓'
            if (p === 'error') return '✗'
            if (p === 'running') return '…'
            return ''
        }

        // ── Fee helper (returns nAVAX as BN) ──
        // For C chain the fee is gas-based and depends on the *other* chain in
        // the pair (and, for exports, the amount). X/P fees are flat.
        const chainFee = (
            chain: ChainIdType,
            isExport: boolean,
            otherChain: ChainIdType,
            amtForGas: BN
        ): BN => {
            if (chain === 'X') return avm.getTxFee()
            if (chain === 'P') return pChain.getTxFee()

            const w = wallet.value!
            const gas = isExport
                ? GasHelper.estimateExportGasFeeFromMockTx(
                      otherChain as ExportChainsC,
                      amtForGas,
                      w.getEvmAddress(),
                      w.getCurrentAddressPlatform()
                  )
                : GasHelper.estimateImportGasFeeFromMockTx(1, 1)

            // Per-gas price (wei). We use 2× the raw base fee rather than the
            // 1.25× "recommended" value because Avalanche allows the base fee to
            // rise 12.5% per block. Over the ~5 s export→import window (≈4
            // blocks) it can climb ~1.6×; a smaller buffer fails consistently
            // with "import tx flow check failed due to: insufficient funds".
            // Floor: 50 gwei (2× the Avalanche C-chain minimum of 25 gwei).
            const FLOOR_PER_GAS_WEI = new BN('50000000000') // 50 gwei
            const perGasWei = BN.max(baseFee.value.muln(2), FLOOR_PER_GAS_WEI)
            const totFeeWei = perGasWei.mul(new BN(gas))
            // wei (18 decimals) → nAVAX (9 decimals)
            let feeNAvax = avaxCtoX(totFeeWei)

            // The import-into-C leg's fee *is* used directly to build the real
            // import tx (see createImportTxC), so the 2× buffer above is what
            // keeps the node's flow check satisfied. Guard against a rounded-to-
            // zero nAVAX value with a floor (~2× the Avalanche minimum).
            if (!isExport) {
                if (feeNAvax.lten(0)) feeNAvax = new BN(600000)
                return feeNAvax
            }

            // The export-from-C-chain fee param is "legacy" and IGNORED by the
            // underlying @avalanche-sdk/client builder (buildEvmExportTransaction) —
            // it auto-calculates its own gas at broadcast time using a fresh
            // base-fee fetch. This estimate is therefore only a self-imposed
            // budget reservation, not a value that actually caps the real
            // transaction cost. For injected wallets (Core App etc.),
            // exportFromCChain hands the whole sign+broadcast step to the
            // extension, which determines gas on its own and retries with
            // adjusted gas before giving up. A flat floor on top of the 2×
            // buffer keeps gas-price spikes and Core's retry margin from
            // exhausting it.
            const FLOOR_NAVAX = new BN(20_000_000) // 0.02 AVAX
            return BN.max(feeNAvax, FLOOR_NAVAX)
        }

        const updateBaseFee = async () => {
            try {
                // Raw base fee — the 2× buffer is applied in chainFee().
                baseFee.value = await GasHelper.getBaseFee()
            } catch {
                baseFee.value = new BN('25000000000') // 25 gwei fallback
            }
        }

        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

        // Computes the max movable amount from `source` to `target`, after
        // reserving the export and import network fees. Returns nAVAX BN, and
        // the per-leg fees so the caller can pass them to the wallet methods.
        const planTransfer = (source: ChainIdType, target: ChainIdType) => {
            const balance = balanceForChain(source)
            const exportFee = chainFee(source, true, target, balance)
            const importFee = chainFee(target, false, source, balance)

            let amount = balance.sub(exportFee).sub(importFee)

            // P-chain exports are bounded by how many UTXOs fit in one tx.
            if (source === 'P' && wallet.value) {
                const sortedSet = sortUTxoSetP(wallet.value.getPlatformUTXOSet(), false)
                const res = selectMaxUtxoForExportP(sortedSet.getAllUTXOs())
                const cap = res.amount.sub(exportFee).sub(importFee)
                if (cap.lt(amount)) amount = cap
            }

            return { amount, exportFee, importFee }
        }

        const runUnify = async () => {
            const w = wallet.value
            if (!w || isRunning.value) return

            isRunning.value = true
            isDone.value = false
            operations.value = []

            const target = targetChain.value
            const sources = allChains.filter((c) => c !== target)

            for (const source of sources) {
                if (balanceForChain(source).lte(zero)) continue

                // Refresh right before planning each leg (not just once for the
                // whole run) — with a 5s export→import delay per leg, the C-chain
                // base fee can drift noticeably between legs.
                await updateBaseFee()

                const { amount, exportFee, importFee } = planTransfer(source, target)

                if (amount.lte(zero)) {
                    operations.value.push({
                        source,
                        target,
                        amount: formatAvax(balanceForChain(source)),
                        status: 'skipped',
                        exportStatus: 'pending',
                        importStatus: 'pending',
                        error: 'Balance too low to cover the cross-chain fees.',
                    })
                    continue
                }

                const op: OpRecord = {
                    source,
                    target,
                    amount: formatAvax(amount),
                    status: 'running',
                    exportStatus: 'running',
                    importStatus: 'pending',
                }
                operations.value.push(op)

                try {
                    // ── Export phase ──
                    currentLabel.value = `Exporting from ${source}-chain…`
                    let exportTxId: string
                    if (source === 'X') {
                        exportTxId = await w.exportFromXChain(
                            amount,
                            target as ExportChainsX,
                            target === 'C' ? importFee : undefined
                        )
                    } else if (source === 'P') {
                        exportTxId = await w.exportFromPChain(
                            amount,
                            target as ExportChainsP,
                            target === 'C' ? importFee : undefined
                        )
                    } else {
                        exportTxId = await w.exportFromCChain(
                            amount,
                            target as ExportChainsC,
                            exportFee
                        )
                    }
                    op.exportTxId = exportTxId
                    op.exportStatus = 'success'

                    // Wait for the exported UTXOs to surface in atomic memory.
                    op.importStatus = 'running'
                    currentLabel.value = `Importing into ${target}-chain…`
                    await delay(IMPORT_DELAY)

                    // ── Import phase ──
                    let importTxId: string
                    if (target === 'X') {
                        importTxId = await w.importToXChain(source as AvmImportChainType)
                    } else if (target === 'P') {
                        importTxId = await w.importToPlatformChain(source as ExportChainsP)
                    } else {
                        importTxId = await w.importToCChain(source as ExportChainsC, importFee)
                    }
                    op.importTxId = importTxId
                    op.importStatus = 'success'
                    op.status = 'success'
                } catch (e: any) {
                    op.error = e?.message ?? String(e)
                    op.status = 'error'
                    if (op.exportStatus === 'running') op.exportStatus = 'error'
                    else if (op.importStatus === 'running') op.importStatus = 'error'
                }

                // Refresh balances so the next source sees up-to-date numbers.
                try {
                    await assetsStore.updateUTXOs()
                } catch {
                    // non-fatal
                }
            }

            currentLabel.value = ''
            isRunning.value = false
            isDone.value = true
        }

        const reset = () => {
            isDone.value = false
            operations.value = []
            currentLabel.value = ''
        }

        return {
            allChains,
            zero,
            targetChain,
            isRunning,
            isDone,
            currentLabel,
            operations,
            wallet,
            chainLabel,
            balanceForChain,
            hasMovableFunds,
            formatAvax,
            phaseGlyph,
            runUnify,
            reset,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

h1 {
    font-weight: normal;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin: 4px 0 24px;
    max-width: 740px;
    line-height: 1.6;
}

h2 {
    font-weight: 600;
    font-size: 18px;
    margin-bottom: 6px;
}

.card_desc {
    color: var(--primary-color-light);
    font-size: 13px;
    margin-bottom: 18px;
}

.card {
    background-color: var(--bg-light);
    border-radius: 8px;
    padding: 28px;
    max-width: 760px;
    margin-bottom: 20px;
}

/* ── Target chain selector ── */
.chain_select {
    display: flex;
    gap: 12px;
    margin-bottom: 24px;
    flex-wrap: wrap;
}

.chain_btn {
    flex: 1;
    min-width: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 16px;
    border-radius: 6px;
    border: 1px solid var(--bg-body);
    background: var(--bg-body);
    color: var(--primary-color-light);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;

    &:hover:not(:disabled) {
        color: var(--primary-color);
    }

    &.active {
        border-color: var(--secondary-color);
        color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
}

/* ── Balances overview ── */
.balances {
    border: 1px solid var(--bg-body);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 6px;
}

.balance_row {
    display: grid;
    grid-template-columns: 32px 1fr auto auto;
    gap: 12px;
    align-items: center;
    padding: 12px 16px;
    font-size: 13px;

    &:not(:last-child) {
        border-bottom: 1px solid var(--bg-body);
    }

    &.is_target {
        background: color-mix(in srgb, var(--secondary-color) 8%, transparent);
    }
}

.balance_chain {
    color: var(--primary-color);
    font-weight: 600;
}

.balance_amt {
    font-variant-numeric: tabular-nums;
    color: var(--primary-color);
}

.balance_role {
    font-size: 12px;
    min-width: 120px;
    text-align: right;

    .role_target {
        color: var(--secondary-color);
        font-weight: 600;
    }
    .role_source {
        color: var(--primary-color-light);
    }
    .role_empty {
        color: var(--primary-color-light);
        opacity: 0.6;
    }
}

.info_msg {
    color: var(--primary-color-light);
    font-size: 13px;
    margin: 14px 0 0;
}

.actions {
    display: flex;
    gap: 12px;
    margin-top: 22px;
    flex-wrap: wrap;
}

/* ── Chain badge ── */
.chain_badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;

    &.chain_x {
        background: #e3f2fd;
        color: #1565c0;
    }
    &.chain_p {
        background: #fce4ec;
        color: #880e4f;
    }
    &.chain_c {
        background: #e8f5e9;
        color: #2e7d32;
    }
}

@include main.night-mode {
    .chain_badge {
        &.chain_x {
            background: #1a3a5c;
            color: #90caf9;
        }
        &.chain_p {
            background: #4a1020;
            color: #f48fb1;
        }
        &.chain_c {
            background: #1b3a1f;
            color: #a5d6a7;
        }
    }
}

/* ── Operations list ── */
.op_list {
    border: 1px solid var(--bg-body);
    border-radius: 6px;
    overflow: hidden;
}

.op_row {
    display: grid;
    grid-template-columns: 110px 150px 1fr;
    gap: 14px;
    align-items: center;
    padding: 12px 16px;
    font-size: 13px;

    &:not(:last-child) {
        border-bottom: 1px solid var(--bg-body);
    }

    &.status_error {
        border-left: 3px solid var(--error);
    }
    &.status_success {
        border-left: 3px solid #4caf50;
    }
    &.status_skipped {
        border-left: 3px solid var(--primary-color-light);
        opacity: 0.8;
    }
    &.status_running {
        border-left: 3px solid var(--secondary-color);
    }
}

.op_route {
    display: inline-flex;
    align-items: center;
    gap: 6px;

    .op_arrow {
        color: var(--primary-color-light);
        font-size: 0.85em;
    }
}

.op_amount {
    font-variant-numeric: tabular-nums;
    color: var(--primary-color);
}

.op_status {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
}

.phase {
    font-size: 12px;
    color: var(--primary-color-light);

    &.phase_success {
        color: #4caf50;
        font-weight: 600;
    }
    &.phase_error {
        color: var(--error);
        font-weight: 600;
    }
    &.phase_running {
        color: var(--secondary-color);
    }
}

.skip {
    color: var(--primary-color-light);
}

.op_detail {
    width: 100%;
    font-size: 11px;
    color: var(--primary-color-light);
    word-break: break-word;

    &.fail {
        color: var(--error);
    }
}

@include main.mobile-device {
    .op_row {
        grid-template-columns: 90px 1fr;

        .op_status {
            grid-column: 1 / -1;
        }
    }

    .balance_row {
        grid-template-columns: 28px 1fr auto;

        .balance_role {
            grid-column: 1 / -1;
            text-align: left;
            min-width: 0;
        }
    }
}
</style>
