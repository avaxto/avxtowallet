<template>
    <div class="pending_imports">
        <div class="head">
            <h2>{{ $t('advanced.pending.title', 'Pending Imports') }}</h2>
            <button class="refresh_btn" @click="refresh" :disabled="isLoading">
                <fa icon="sync" :class="{ spinning: isLoading }"></fa>
                Refresh
            </button>
        </div>

        <p class="desc">
            Atomic UTXOs in shared memory waiting to be imported into the
            destination chain. Click <b>Import</b> on any row to claim it
            (the action imports every pending UTXO for that source→destination pair
            in a single transaction).
        </p>

        <div v-if="isLoading && rows.length === 0" class="empty">Loading…</div>
        <div v-else-if="rows.length === 0" class="empty">
            No pending imports — nothing in atomic memory across any chain pair.
        </div>

        <div v-else class="table">
            <div class="table_head">
                <span class="col_route">Route</span>
                <span class="col_addr">Address (source / destination)</span>
                <span class="col_amount">AVAX</span>
                <span class="col_tx">Tx ID</span>
                <span class="col_action"></span>
            </div>

            <div
                v-for="(row, i) in rows"
                :key="row.utxoId + '-' + i"
                class="row"
                :class="{ even: i % 2 === 0 }"
            >
                <span class="col_route">
                    <span class="chain_badge" :class="row.source.toLowerCase()">{{ row.source }}</span>
                    <fa icon="angle-right" class="arrow"></fa>
                    <span class="chain_badge" :class="row.dest.toLowerCase()">{{ row.dest }}</span>
                </span>

                <span class="col_addr">
                    <span class="addr_pair">
                        <span class="addr mono" :title="row.sourceAddr">{{ row.sourceAddr }}</span>
                        <Tooltip text="Copy source-chain encoding of the owner address" class="icon_btn">
                            <CopyText :value="row.sourceAddr" />
                        </Tooltip>
                    </span>
                    <span class="addr_pair">
                        <span class="addr mono" :title="row.destAddr">{{ row.destAddr }}</span>
                        <Tooltip text="Copy destination-chain encoding of the owner address" class="icon_btn">
                            <CopyText :value="row.destAddr" />
                        </Tooltip>
                    </span>
                </span>

                <span class="col_amount">{{ row.amountAvax }}</span>

                <span class="col_tx">
                    <span class="addr mono" :title="row.txId">{{ shortTx(row.txId) }}</span>
                    <Tooltip text="Copy transaction ID" class="icon_btn">
                        <CopyText :value="row.txId" />
                    </Tooltip>
                </span>

                <span class="col_action">
                    <button
                        class="import_btn"
                        :disabled="!!row.importing"
                        @click="importRow(row)"
                    >
                        <Spinner v-if="row.importing" class="spinner_inline" />
                        <template v-else>Import</template>
                    </button>
                </span>
            </div>
        </div>

        <div v-if="lastError" class="error">{{ lastError }}</div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, reactive } from 'vue'
import { useMainStore, useNotificationsStore } from '@/stores'
import { Wallet } from '@/js/wallets/AbstractWallet'
import CopyText from '@/components/misc/CopyText.vue'
import Tooltip from '@/components/misc/Tooltip.vue'
import Spinner from '@/components/misc/Spinner.vue'
import { ava, avm, bintools, cChain, pChain } from '@/AVA'
import { BN, Buffer as BufferAvalanche } from '@/avalanche'
import { GasHelper, avaxCtoX } from '@/avalanche-wallet-sdk'
import { Tx as AVMTx } from '@/avalanche/apis/avm/tx'
import { Tx as PlatformTx } from '@/avalanche/apis/platformvm/tx'
import { Tx as EvmTx } from '@/avalanche/apis/evm/tx'

type ChainAlias = 'X' | 'P' | 'C'

interface PendingRow {
    source: ChainAlias
    dest: ChainAlias
    /** Actual sender's address on the source chain (resolved from the export tx). */
    sourceAddr: string
    /** Owner address of the atomic UTXO (the receiver, on the destination chain). */
    destAddr: string
    amountAvax: string
    txId: string
    utxoId: string
    /** Per-row signature count so C-chain fees can be sized correctly. */
    numSigs: number
    importing: boolean
}

export default defineComponent({
    name: 'PendingImports',
    components: { CopyText, Tooltip, Spinner },
    setup() {
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()
        const isLoading = ref(false)
        const lastError = ref('')
        const rows = ref<PendingRow[]>([])

        const wallet = computed((): null | Wallet => {
            return mainStore.activeWallet
        })

        const shortTx = (id: string) =>
            id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id

        const formatAvax = (nAvax: BN): string => {
            // Convert nAVAX (9 decimals) to AVAX string with up to 6 visible decimals.
            const tens = new BN(10).pow(new BN(9))
            const whole = nAvax.div(tens).toString(10)
            const frac = nAvax.mod(tens).toString(10).padStart(9, '0').slice(0, 6).replace(/0+$/, '')
            return frac ? `${whole}.${frac}` : whole
        }

        /** Walk every (source, dest) atomic-UTXO query and flatten into per-UTXO rows. */
        const loadRows = async (): Promise<PendingRow[]> => {
            const w = wallet.value as any
            if (!w) return []

            interface Probe {
                source: ChainAlias
                dest: ChainAlias
                /** Returns a UTXOSet (avm / platform / evm) of atomic UTXOs at the wallet's
                 * dest-chain addresses for the given source chain. */
                fn: () => Promise<any>
            }
            const probes: Probe[] = [
                { source: 'P', dest: 'X', fn: () => w.avmGetAtomicUTXOs('P') },
                { source: 'C', dest: 'X', fn: () => w.avmGetAtomicUTXOs('C') },
                { source: 'X', dest: 'P', fn: () => w.platformGetAtomicUTXOs('X') },
                { source: 'C', dest: 'P', fn: () => w.platformGetAtomicUTXOs('C') },
                { source: 'X', dest: 'C', fn: () => w.evmGetAtomicUTXOs('X') },
                { source: 'P', dest: 'C', fn: () => w.evmGetAtomicUTXOs('P') },
            ]

            const hrp = ava.getHRP()
            const results = await Promise.all(
                probes.map((p) =>
                    p.fn()
                        .then((set: any) => ({ probe: p, utxos: set.getAllUTXOs() as any[] }))
                        .catch((e: any) => {
                            console.warn(`[PendingImports] ${p.source}→${p.dest} query failed`, e)
                            return { probe: p, utxos: [] as any[] }
                        })
                )
            )

            const flat: PendingRow[] = []
            for (const { probe, utxos } of results) {
                for (const u of utxos) {
                    const out = u.getOutput()
                    const ownerBufs = out.getAddresses() as any[]
                    if (ownerBufs.length === 0) continue
                    const ownerBuf = ownerBufs[0]
                    const destAddr = bintools.addressToString(hrp, probe.dest, ownerBuf)
                    const amountBn: BN =
                        typeof out.getAmount === 'function' ? (out.getAmount() as BN) : new BN(0)
                    flat.push({
                        source: probe.source,
                        dest: probe.dest,
                        // Sender resolves asynchronously after the table is rendered
                        // (one source-chain RPC per row).
                        sourceAddr: 'loading…',
                        destAddr,
                        amountAvax: formatAvax(amountBn),
                        txId: u.getTxID ? bintools.cb58Encode(u.getTxID()) : '',
                        utxoId: u.getUTXOID ? u.getUTXOID() : '',
                        numSigs: ownerBufs.length,
                        importing: false,
                    })
                }
            }
            return flat
        }

        /** Fetches the export tx on the source chain and extracts the sender's
         *  address.  For X / P chains this is the change output (where the sender's
         *  leftover funds get returned).  For C chain this is the first EVMInput's
         *  `address` field — the EVM 0x address that funded the atomic export.
         *
         *  Falls back to '—' when the parse can't surface a sender (no change
         *  output, RPC error, codec mismatch). */
        const resolveSender = async (sourceChain: ChainAlias, txId: string): Promise<string> => {
            if (!txId) return '—'
            const hrp = ava.getHRP()
            try {
                if (sourceChain === 'X') {
                    const hex = (await avm.getTx(txId, 'hex')) as string
                    const tx = new AVMTx()
                    tx.fromBuffer(BufferAvalanche.from(hex.replace(/^0x/, ''), 'hex'))
                    const inner = (tx.getUnsignedTx().getTransaction() as any)
                    const outs = inner.getOuts ? inner.getOuts() : []
                    for (const o of outs) {
                        const addrs = o.getOutput?.()?.getAddresses?.() ?? []
                        if (addrs.length > 0) {
                            return bintools.addressToString(hrp, 'X', addrs[0])
                        }
                    }
                    return '—'
                }
                if (sourceChain === 'P') {
                    const hex = (await pChain.getTx(txId, 'hex')) as string
                    const tx = new PlatformTx()
                    tx.fromBuffer(BufferAvalanche.from(hex.replace(/^0x/, ''), 'hex'))
                    const inner = (tx.getUnsignedTx().getTransaction() as any)
                    const outs = inner.getOuts ? inner.getOuts() : []
                    for (const o of outs) {
                        const addrs = o.getOutput?.()?.getAddresses?.() ?? []
                        if (addrs.length > 0) {
                            return bintools.addressToString(hrp, 'P', addrs[0])
                        }
                    }
                    return '—'
                }
                // C-chain: EVMInput carries the sender's EVM 0x address directly.
                const hex = (await cChain.getAtomicTx(txId)) as string
                const tx = new EvmTx()
                tx.fromBuffer(BufferAvalanche.from(hex.replace(/^0x/, ''), 'hex'))
                const inner = (tx.getUnsignedTx().getTransaction() as any)
                const ins = inner.getInputs ? inner.getInputs() : (inner.ins ?? [])
                for (const i of ins) {
                    const addr = i.getAddress ? i.getAddress() : i.address
                    if (addr) {
                        const hexAddr = (addr as any).toString
                            ? (addr as any).toString('hex')
                            : ''
                        if (hexAddr) return '0x' + hexAddr
                    }
                }
                return '—'
            } catch (e) {
                console.warn(
                    `[PendingImports] sender resolve failed for ${sourceChain}/${txId}`,
                    e
                )
                return '—'
            }
        }

        /** Resolves the sender address for every row in parallel.  Updates each
         *  reactive row in place so the table re-renders cell-by-cell as fetches
         *  complete (avoiding a single all-or-nothing wait). */
        const resolveSendersForRows = (list: PendingRow[]): void => {
            const seen = new Map<string, Promise<string>>()
            for (const row of list) {
                const key = `${row.source}:${row.txId}`
                let p = seen.get(key)
                if (!p) {
                    p = resolveSender(row.source, row.txId)
                    seen.set(key, p)
                }
                p.then((addr) => {
                    row.sourceAddr = addr
                }).catch(() => {
                    row.sourceAddr = '—'
                })
            }
        }

        const refresh = async () => {
            if (isLoading.value) return
            isLoading.value = true
            lastError.value = ''
            try {
                const next = await loadRows()
                // Reactive wrappers so per-row updates (importing flag, sourceAddr
                // resolving in the background) re-render just that row.
                const reactiveRows = next.map((r) => reactive(r))
                rows.value = reactiveRows
                // Kick off sender resolution in the background; rows are already
                // visible with sourceAddr = 'loading…' and update as each fetch lands.
                resolveSendersForRows(reactiveRows)
            } catch (e: any) {
                lastError.value = e?.message ?? String(e)
            } finally {
                isLoading.value = false
            }
        }

        /** Resolves the per-gas wei value (with safe fallback) for C-chain imports.
         * Mirrors the fee chain used by ChainImport.vue's atomicImportC. */
        const resolvePerGasWei = async (): Promise<BN> => {
            const MIN_PER_GAS_WEI = new BN('1000000000') // 1 gwei
            const FALLBACK_PER_GAS_WEI = new BN('25000000000') // 25 gwei
            try {
                const bf = await GasHelper.getBaseFeeRecommended()
                if (bf.gte(MIN_PER_GAS_WEI)) return bf
            } catch {
                /* fall through */
            }
            try {
                const gp = await GasHelper.getAdjustedGasPrice()
                if (gp.gte(MIN_PER_GAS_WEI)) return gp
            } catch {
                /* fall through */
            }
            return FALLBACK_PER_GAS_WEI
        }

        const importRow = async (row: PendingRow) => {
            const w = wallet.value as any
            if (!w) return
            row.importing = true
            lastError.value = ''
            try {
                let txId: string
                if (row.dest === 'X') {
                    txId = await w.importToXChain(row.source)
                } else if (row.dest === 'P') {
                    txId = await w.importToPlatformChain(row.source)
                } else {
                    // C-chain — compute a fee like ChainImport.vue does, sized for the
                    // total pending UTXOs in this source→C combination (not just this one
                    // row), because the import claims all of them in a single tx.
                    const sameDirRows = rows.value.filter(
                        (r) => r.source === row.source && r.dest === 'C'
                    )
                    const numIns = sameDirRows.length
                    const numSigs = sameDirRows.reduce((acc, r) => acc + r.numSigs, 0)
                    const gas = GasHelper.estimateImportGasFeeFromMockTx(numIns, numSigs)
                    const perGasWei = await resolvePerGasWei()
                    const totFee = perGasWei.mul(new BN(gas))
                    let feeNAvax = avaxCtoX(totFee)
                    if (feeNAvax.lten(0)) feeNAvax = new BN(100000)
                    txId = await w.importToCChain(row.source, feeNAvax)
                }
                notificationsStore.add({
                    type: 'success',
                    title: `Imported ${row.source}→${row.dest}`,
                    message: txId,
                })
                // Reload list — the claimed UTXOs (potentially multiple) are gone.
                await refresh()
            } catch (e: any) {
                row.importing = false
                lastError.value = e?.message ?? String(e)
                notificationsStore.add({
                    type: 'error',
                    title: `Import ${row.source}→${row.dest} failed`,
                    message: e?.message ?? String(e),
                })
            }
        }

        onMounted(() => {
            refresh()
        })

        return {
            isLoading,
            rows,
            lastError,
            shortTx,
            refresh,
            importRow,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.pending_imports {
    background-color: var(--bg-light);
    border-radius: 4px;
    padding: 20px 24px;
    margin-bottom: 14px;
}

.head {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;

    h2 {
        flex: 1;
        font-weight: 500;
        font-size: 1.1em;
        margin: 0;
    }
}

.refresh_btn {
    background: transparent;
    border: 1px solid var(--bg);
    color: var(--primary-color);
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 0.85em;
    cursor: pointer;

    &:hover:not(:disabled) {
        background-color: var(--bg);
    }

    &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .spinning {
        animation: spin 1s linear infinite;
    }
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.85em;
    margin: 4px 0 16px;
}

.empty {
    color: var(--primary-color-light);
    font-size: 0.9em;
    padding: 16px 0;
    text-align: center;
}

.table {
    display: flex;
    flex-direction: column;
    border-radius: 4px;
    overflow: hidden;
}

.table_head,
.row {
    display: grid;
    grid-template-columns: 120px 1fr 110px 170px 110px;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    font-size: 0.85em;
}

.table_head {
    color: var(--primary-color-light);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--bg);
}

.row {
    &.even {
        background-color: var(--bg);
    }
}

.col_route {
    display: inline-flex;
    align-items: center;
    gap: 6px;

    .arrow {
        color: var(--primary-color-light);
        font-size: 0.85em;
    }
}

.chain_badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    color: #fff;
    font-size: 0.7em;
    font-weight: bold;

    &.x { background-color: #e84142; }
    &.p { background-color: #0a85c2; }
    &.c { background-color: #6c6cff; }
}

.addr_pair {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;

    & + .addr_pair {
        margin-top: 3px;
    }
}

.mono {
    font-family: monospace;
}

.addr {
    color: var(--primary-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
}

.col_amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--primary-color);
}

.col_tx {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}

.col_action {
    display: flex;
    justify-content: flex-end;
}

.import_btn {
    background-color: var(--primary-color);
    color: var(--bg-light);
    border: 0;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;

    &:hover:not(:disabled) {
        background-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
}

.spinner_inline {
    width: 14px;
    height: 14px;
    color: var(--bg-light) !important;
    margin: 0 !important;
}

.icon_btn {
    display: inline-flex;

    :deep(button) {
        background: transparent;
        border: 0;
        padding: 2px 4px;
        color: var(--primary-color);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        line-height: 1;
        border-radius: 3px;

        &:hover {
            background-color: var(--bg-light);
        }
    }

    :deep(.copyBut img) {
        max-height: 12px;
    }

    :deep(svg) {
        font-size: 12px;
    }
}

.error {
    margin-top: 12px;
    padding: 8px 12px;
    color: var(--secondary-color);
    background-color: var(--bg);
    border-radius: 4px;
    font-size: 0.85em;
    word-break: break-all;
}

@include main.mobile-device {
    .table_head,
    .row {
        grid-template-columns: 90px 1fr 90px 110px 90px;
        font-size: 0.78em;
    }
}
</style>
