<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="iceberg_page">
        <h1>Iceberg Order</h1>
        <p class="desc">
            Split one large swap into smaller chunks executed one after another, reducing price
            impact. Routing uses the ArenaTrade / Odos aggregator (same engine as Token Swap).
            Keep this screen open while the order runs — the order lives only in this tab, so
            closing the wallet or leaving the page cancels it and you must start over.
        </p>

        <!-- ── Configuration ── -->
        <div class="card">
            <h2>Order Setup</h2>

            <!-- From -->
            <div class="token_block">
                <div class="token_head">
                    <label>Source token (you pay)</label>
                    <span v-if="tokenIn" class="balance">
                        Balance: {{ balanceOf(tokenIn) }} {{ tokenIn.symbol }}
                    </span>
                </div>
                <select v-model="tokenInAddr" class="token_select full" :disabled="isLocked">
                    <option v-if="!heldTokens.length" :value="''" disabled>No tokens held</option>
                    <option v-for="t in heldTokens" :key="'in-' + t.address" :value="t.address">
                        {{ t.symbol }}
                    </option>
                </select>
            </div>

            <!-- To -->
            <div class="token_block">
                <div class="token_head">
                    <label>Target token (you receive)</label>
                    <span v-if="tokenOut" class="balance">
                        {{ tokenOut.symbol }} · {{ tokenOut.decimals }} decimals
                    </span>
                </div>
                <div class="target_row">
                    <input
                        v-model="tokenOutAddr"
                        type="text"
                        class="address_input"
                        placeholder="Token address (0x…) or symbol (e.g. USDC)"
                        spellcheck="false"
                        :disabled="isLocked"
                        @input="onTargetChange"
                    />
                    <span v-if="isResolving" class="resolve_state">Resolving…</span>
                    <span v-else-if="tokenOut" class="resolve_state ok">✓ {{ tokenOut.symbol }}</span>
                    <span v-else-if="targetError" class="resolve_state err">{{ targetError }}</span>
                </div>
            </div>

            <!-- Chunk mode -->
            <div class="mode_row">
                <label class="mode_opt">
                    <input type="radio" value="chunks" v-model="mode" :disabled="isLocked" />
                    Equal chunks
                </label>
                <label class="mode_opt">
                    <input type="radio" value="custom" v-model="mode" :disabled="isLocked" />
                    Custom amounts
                </label>
            </div>

            <!-- Equal chunks: total + count -->
            <template v-if="mode === 'chunks'">
                <div class="field_grid">
                    <div class="field">
                        <label>Total amount ({{ tokenIn ? tokenIn.symbol : '—' }})</label>
                        <input
                            v-model="totalAmount"
                            type="text"
                            class="text_input"
                            placeholder="0.0"
                            :disabled="isLocked"
                        />
                    </div>
                    <div class="field">
                        <label>Number of chunks</label>
                        <input
                            v-model.number="numChunks"
                            type="number"
                            class="text_input"
                            min="1"
                            max="100"
                            step="1"
                            :disabled="isLocked"
                        />
                    </div>
                </div>
                <p v-if="perChunkPreview" class="hint">
                    ≈ {{ perChunkPreview }} {{ tokenIn ? tokenIn.symbol : '' }} per chunk
                </p>
            </template>

            <!-- Custom amounts -->
            <template v-else>
                <div class="field">
                    <label>Individual amounts (one per line or comma-separated)</label>
                    <textarea
                        v-model="customAmountsRaw"
                        class="amounts_area"
                        placeholder="e.g.&#10;10&#10;25&#10;25&#10;40"
                        :disabled="isLocked"
                    ></textarea>
                </div>
                <p v-if="parsedChunks.length" class="hint">
                    {{ parsedChunks.length }} chunks · total
                    {{ totalAmountDisplay }} {{ tokenIn ? tokenIn.symbol : '' }}
                </p>
                <p v-if="customParseError" class="hint err">{{ customParseError }}</p>
            </template>

            <!-- Slippage -->
            <div class="slippage_row">
                <label>Max slippage per chunk</label>
                <div class="slippage_options">
                    <button
                        v-for="s in [0.5, 1, 2]"
                        :key="s"
                        type="button"
                        class="slip_btn"
                        :class="{ active: slippage === s }"
                        :disabled="isLocked"
                        @click="slippage = s"
                    >
                        {{ s }}%
                    </button>
                    <input
                        v-model.number="slippage"
                        type="number"
                        class="slip_input"
                        min="0.1"
                        max="50"
                        step="0.1"
                        :disabled="isLocked"
                    />
                    <span class="pct">%</span>
                </div>
            </div>

            <!-- Fee summary -->
            <div class="fee_box">
                <div class="fee_row">
                    <span>Chunks</span>
                    <span>{{ chunkCount }}</span>
                </div>
                <div class="fee_row">
                    <span>Gas price</span>
                    <span>{{ gasPriceGwei }} nAVAX</span>
                </div>
                <div class="fee_row">
                    <span>Est. total gas budget</span>
                    <span>{{ estFeeAvax }} AVAX</span>
                </div>
                <div class="fee_row" v-if="tokenIn">
                    <span>Available AVAX</span>
                    <span>{{ avaxBalanceDisplay }} AVAX</span>
                </div>
                <p v-if="feeError" class="fee_error">{{ feeError }}</p>
            </div>

            <div class="actions" v-if="!started">
                <button
                    type="button"
                    class="action_btn"
                    :disabled="!canSubmit"
                    @click="startOrder"
                >
                    Start Iceberg Order
                </button>
            </div>
        </div>

        <!-- ── Progress ── -->
        <div v-if="started" class="card">
            <div class="progress_head">
                <h2>
                    Progress
                    <span class="prog_badge" :class="'badge_' + orderStatus">{{ orderStatusLabel }}</span>
                </h2>
                <div class="prog_actions">
                    <button
                        v-if="running"
                        type="button"
                        class="ghost_btn danger"
                        @click="abortOrder"
                    >
                        Abort
                    </button>
                    <button
                        v-else
                        type="button"
                        class="ghost_btn"
                        @click="resetOrder"
                    >
                        Start New Order
                    </button>
                </div>
            </div>

            <div class="stats_grid">
                <div class="stat">
                    <span class="stat_label">Completed</span>
                    <span class="stat_value">{{ completedCount }} / {{ chunkCount }}</span>
                </div>
                <div class="stat">
                    <span class="stat_label">Chunks to go</span>
                    <span class="stat_value">{{ chunksToGo }}</span>
                </div>
                <div class="stat">
                    <span class="stat_label">Est. time to go</span>
                    <span class="stat_value">{{ etaDisplay }}</span>
                </div>
                <div class="stat">
                    <span class="stat_label">Avg price</span>
                    <span class="stat_value">
                        {{ avgPriceDisplay }}
                        <template v-if="avgPriceDisplay !== '—' && tokenOut && tokenIn">
                            {{ tokenOut.symbol }}/{{ tokenIn.symbol }}
                        </template>
                    </span>
                </div>
                <div class="stat">
                    <span class="stat_label">Total received (est.)</span>
                    <span class="stat_value">
                        {{ totalReceivedDisplay }}
                        <template v-if="tokenOut">{{ tokenOut.symbol }}</template>
                    </span>
                </div>
                <div class="stat">
                    <span class="stat_label">Spent</span>
                    <span class="stat_value">
                        {{ totalSpentDisplay }}
                        <template v-if="tokenIn">{{ tokenIn.symbol }}</template>
                    </span>
                </div>
            </div>

            <div class="progress_bar">
                <div class="progress_fill" :style="{ width: progressPct + '%' }"></div>
            </div>

            <!-- Chunk-by-chunk TX summary -->
            <div class="tx_table">
                <div class="tx_header">
                    <span>#</span>
                    <span>Amount</span>
                    <span>Received (est.)</span>
                    <span>Price</span>
                    <span>Status</span>
                </div>
                <div
                    v-for="row in rows"
                    :key="row.index"
                    class="tx_row"
                    :class="'row_' + row.status"
                >
                    <span>{{ row.index + 1 }}</span>
                    <span>{{ row.amountDisplay }} {{ tokenIn ? tokenIn.symbol : '' }}</span>
                    <span>{{ row.outDisplay || '—' }}</span>
                    <span>{{ row.priceDisplay || '—' }}</span>
                    <span class="tx_status">
                        <template v-if="row.status === 'done'">
                            <a
                                :href="txUrl(row.txHash)"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="tx_link"
                            >
                                ✓ {{ shortHash(row.txHash) }} ↗
                            </a>
                        </template>
                        <template v-else-if="row.status === 'error'">
                            <span class="err_text">✗ {{ row.error }}</span>
                        </template>
                        <template v-else-if="row.status === 'quoting'">Quoting…</template>
                        <template v-else-if="row.status === 'swapping'">Swapping…</template>
                        <template v-else-if="row.status === 'approving'">Approving…</template>
                        <template v-else>Pending</template>
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, shallowRef, computed, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useMainStore, useAssetsStore, useNotificationsStore } from '@/stores'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { GasHelper } from '@/avalanche-wallet-sdk'
import { bnToBig } from '@/helpers/helper'
import { toBaseUnits } from '@/js/TokenLauncher'
import {
    getQuote,
    executeSwap,
    approveRouter,
    getAllowance,
    getRouterAddress,
    isNativeToken,
    resolveTargetToken,
    cChainExplorerTxUrl,
    NATIVE_TOKEN_ADDRESS,
    SwapToken,
} from '@/js/ArenaSwap'
import { AvaWalletCore } from '@/js/wallets/types'

// Gas budget assumptions (units). A single aggregator swap rarely exceeds
// ~500k gas; the approval (ERC20 inputs only) is a one-time ~80k. The reserve
// check multiplies by a buffer because gas price can drift over the (possibly
// long) lifetime of an iceberg order.
const SWAP_GAS_UNITS = 500_000
const APPROVAL_GAS_UNITS = 80_000
const GAS_BUFFER_NUM = 3 // 1.5× buffer expressed as a fraction to stay in BN math
const GAS_BUFFER_DEN = 2

// Pause between chunks so nonces/receipts settle and the order paces the market.
const INTER_CHUNK_DELAY = 2500

const NATIVE_AVAX: SwapToken = {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'AVAX',
    name: 'Avalanche',
    decimals: 18,
}

type RowStatus = 'pending' | 'quoting' | 'approving' | 'swapping' | 'done' | 'error'

interface ChunkRow {
    index: number
    amount: BN // base units of tokenIn
    amountDisplay: string
    status: RowStatus
    txHash: string
    outRaw: BN | null // base units of tokenOut (estimated from quote)
    outDisplay: string
    priceDisplay: string
    error: string
}

export default defineComponent({
    // name is referenced by <keep-alive exclude> in Wallet.vue so this view is
    // never cached — leaving the page fully destroys any in-flight order.
    name: 'iceberg',
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const wallet = computed(() => mainStore.activeWallet as AvaWalletCore | null)

        // ── Source token list: held tokens only (native + positive ERC20) ──
        const heldTokens = computed<SwapToken[]>(() => {
            const out: SwapToken[] = []
            if ((wallet.value?.ethBalance || new BN(0)).gt(new BN(0))) out.push(NATIVE_AVAX)
            const erc20 = [
                ...(assetsStore.erc20Tokens || []),
                ...(assetsStore.erc20TokensCustom || []),
            ]
            const seen = new Set<string>([NATIVE_AVAX.address.toLowerCase()])
            for (const t of erc20 as any[]) {
                const k = t.data.address.toLowerCase()
                if (seen.has(k)) continue
                if (!t.balanceBN || t.balanceBN.lten(0)) continue
                seen.add(k)
                out.push({
                    address: t.data.address,
                    symbol: t.data.symbol,
                    name: t.data.name,
                    decimals: parseInt(t.data.decimals as string) || 18,
                })
            }
            return out
        })

        // ── Config state ──
        const tokenInAddr = ref('')
        const tokenOutAddr = ref('')
        const tokenOut = ref<SwapToken | null>(null)
        const isResolving = ref(false)
        const targetError = ref('')
        let resolveTimer: ReturnType<typeof setTimeout> | undefined

        const mode = ref<'chunks' | 'custom'>('chunks')
        const totalAmount = ref('')
        const numChunks = ref(4)
        const customAmountsRaw = ref('')
        const slippage = ref(1)

        const tokenIn = computed(
            () => heldTokens.value.find((t) => t.address === tokenInAddr.value) || null
        )

        // ── Execution state ──
        const started = ref(false)
        const running = ref(false)
        const aborted = ref(false)
        const rows = ref<ChunkRow[]>([])
        const startTime = ref(0)
        const nowTick = ref(Date.now())
        let tickTimer: ReturnType<typeof setInterval> | undefined

        // ── Gas price (wei), refreshed live ──
        const gasPriceWei = shallowRef(new BN('25000000000'))
        let gasTimer: ReturnType<typeof setInterval> | undefined
        const refreshGasPrice = async () => {
            try {
                gasPriceWei.value = await GasHelper.getAdjustedGasPrice()
            } catch {
                /* keep last known */
            }
        }
        const gasPriceGwei = computed(() =>
            gasPriceWei.value.div(new BN('1000000000')).toString(10)
        )

        // Inputs are locked once the order has started (so config can't change
        // mid-run) and until the user resets.
        const isLocked = computed(() => started.value)

        // ── Chunk math (all in tokenIn base units) ──
        const customParseError = ref('')

        const parsedChunks = computed<BN[]>(() => {
            customParseError.value = ''
            if (mode.value !== 'custom' || !tokenIn.value) return []
            const parts = customAmountsRaw.value
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0)
            const out: BN[] = []
            for (const p of parts) {
                try {
                    const bn = toBaseUnits(p, tokenIn.value.decimals)
                    if (bn.lten(0)) continue
                    out.push(bn)
                } catch (e: any) {
                    customParseError.value = `Invalid amount: "${p}"`
                    return []
                }
            }
            return out
        })

        // The chunk amounts that will actually be executed.
        const chunkAmounts = computed<BN[]>(() => {
            if (!tokenIn.value) return []
            if (mode.value === 'custom') return parsedChunks.value

            // Equal-chunks mode: split the total into n near-equal parts, with
            // any remainder folded into the last chunk.
            const n = Math.floor(numChunks.value || 0)
            if (n < 1) return []
            let total: BN
            try {
                total = toBaseUnits((totalAmount.value || '').trim(), tokenIn.value.decimals)
            } catch {
                return []
            }
            if (total.lten(0)) return []
            const base = total.div(new BN(n))
            if (base.lten(0)) return []
            const remainder = total.mod(new BN(n))
            const arr: BN[] = []
            for (let i = 0; i < n; i++) {
                arr.push(i === n - 1 ? base.add(remainder) : base.clone())
            }
            return arr
        })

        const chunkCount = computed(() => chunkAmounts.value.length)

        const totalAmountRaw = computed<BN>(() =>
            chunkAmounts.value.reduce((sum, c) => sum.add(c), new BN(0))
        )

        const totalAmountDisplay = computed(() =>
            tokenIn.value ? bnToBig(totalAmountRaw.value, tokenIn.value.decimals).toFixed(6) : '0'
        )

        const perChunkPreview = computed(() => {
            if (mode.value !== 'chunks' || !tokenIn.value || chunkAmounts.value.length === 0)
                return ''
            return bnToBig(chunkAmounts.value[0], tokenIn.value.decimals).toFixed(6)
        })

        // ── Balances ──
        const tokenInBalanceRaw = computed<BN>(() => {
            if (!tokenIn.value) return new BN(0)
            if (isNativeToken(tokenIn.value.address)) return wallet.value?.ethBalance || new BN(0)
            const found = [
                ...(assetsStore.erc20Tokens || []),
                ...(assetsStore.erc20TokensCustom || []),
            ].find((e: any) => e.data.address.toLowerCase() === tokenIn.value!.address.toLowerCase())
            return found ? (found as any).balanceBN : new BN(0)
        })

        const avaxBalanceRaw = computed<BN>(() => wallet.value?.ethBalance || new BN(0))
        const avaxBalanceDisplay = computed(() => bnToBig(avaxBalanceRaw.value, 18).toFixed(4))

        const balanceOf = (t: SwapToken): string => {
            if (isNativeToken(t.address)) return bnToBig(avaxBalanceRaw.value, 18).toFixed(4)
            const found = [
                ...(assetsStore.erc20Tokens || []),
                ...(assetsStore.erc20TokensCustom || []),
            ].find((e: any) => e.data.address.toLowerCase() === t.address.toLowerCase())
            return found ? (found as any).balanceBig.toFixed(4) : '0'
        }

        // ── Fee estimate & sufficiency ──
        const estFeeWei = computed<BN>(() => {
            const n = chunkCount.value
            if (n < 1) return new BN(0)
            const isNative = tokenIn.value ? isNativeToken(tokenIn.value.address) : true
            const units = SWAP_GAS_UNITS * n + (isNative ? 0 : APPROVAL_GAS_UNITS)
            return gasPriceWei.value
                .mul(new BN(units))
                .muln(GAS_BUFFER_NUM)
                .divn(GAS_BUFFER_DEN)
        })

        const estFeeAvax = computed(() => bnToBig(estFeeWei.value, 18).toFixed(4))

        // Returns an error string when the wallet can't cover the order, else ''.
        const feeError = computed<string>(() => {
            if (!tokenIn.value || chunkCount.value < 1) return ''
            const isNative = isNativeToken(tokenIn.value.address)

            if (isNative) {
                // Native input: balance must cover both the swapped amount AND gas.
                const needed = totalAmountRaw.value.add(estFeeWei.value)
                if (avaxBalanceRaw.value.lt(needed)) {
                    const shortBig = bnToBig(needed.sub(avaxBalanceRaw.value), 18).toFixed(4)
                    return `Insufficient AVAX: the ${chunkCount.value} chunks plus gas need about ${bnToBig(
                        needed,
                        18
                    ).toFixed(4)} AVAX. You are short ~${shortBig} AVAX.`
                }
                return ''
            }

            // ERC20 input: token balance must cover the amount, AVAX must cover gas.
            if (tokenInBalanceRaw.value.lt(totalAmountRaw.value)) {
                return `Insufficient ${tokenIn.value.symbol}: order needs ${totalAmountDisplay.value} ${tokenIn.value.symbol}.`
            }
            if (avaxBalanceRaw.value.lt(estFeeWei.value)) {
                const shortBig = bnToBig(
                    estFeeWei.value.sub(avaxBalanceRaw.value),
                    18
                ).toFixed(4)
                return `Insufficient AVAX for gas across ${chunkCount.value} chunks: need ~${estFeeAvax.value} AVAX, short ~${shortBig} AVAX.`
            }
            return ''
        })

        const canSubmit = computed(() => {
            return (
                !!wallet.value &&
                !!tokenIn.value &&
                !!tokenOut.value &&
                tokenInAddr.value.toLowerCase() !== (tokenOut.value?.address || '').toLowerCase() &&
                chunkCount.value >= 1 &&
                totalAmountRaw.value.gt(new BN(0)) &&
                !customParseError.value &&
                !feeError.value &&
                !running.value
            )
        })

        // ── Target token resolution (address or symbol) ──
        const resolveTarget = async () => {
            const raw = tokenOutAddr.value.trim()
            targetError.value = ''
            tokenOut.value = null
            if (!raw) return
            isResolving.value = true
            try {
                const known = [
                    ...(assetsStore.erc20Tokens || []),
                    ...(assetsStore.erc20TokensCustom || []),
                ].find(
                    (e: any) =>
                        e.data.address.toLowerCase() === raw.toLowerCase() ||
                        (e.data.symbol || '').toLowerCase() === raw.toLowerCase()
                )
                const resolved: SwapToken = known
                    ? {
                          address: (known as any).data.address,
                          symbol: (known as any).data.symbol,
                          name: (known as any).data.name,
                          decimals: parseInt((known as any).data.decimals as string) || 18,
                      }
                    : await resolveTargetToken(raw)

                if (resolved.address.toLowerCase() === tokenInAddr.value.toLowerCase()) {
                    targetError.value = 'Target must differ from source'
                    return
                }
                tokenOut.value = resolved
            } catch (e: any) {
                targetError.value = e?.message || 'Could not resolve token'
            } finally {
                isResolving.value = false
            }
        }

        const onTargetChange = () => {
            tokenOut.value = null
            targetError.value = ''
            if (resolveTimer) clearTimeout(resolveTimer)
            resolveTimer = setTimeout(resolveTarget, 400)
        }

        // ── Progress / stats ──
        const completedCount = computed(() => rows.value.filter((r) => r.status === 'done').length)
        const chunksToGo = computed(() => Math.max(chunkCount.value - completedCount.value, 0))
        const progressPct = computed(() =>
            chunkCount.value ? Math.round((completedCount.value / chunkCount.value) * 100) : 0
        )

        const totalReceivedRaw = computed<BN>(() =>
            rows.value.reduce((sum, r) => (r.outRaw ? sum.add(r.outRaw) : sum), new BN(0))
        )
        const totalSpentRaw = computed<BN>(() =>
            rows.value.reduce((sum, r) => (r.status === 'done' ? sum.add(r.amount) : sum), new BN(0))
        )

        const totalReceivedDisplay = computed(() =>
            tokenOut.value ? bnToBig(totalReceivedRaw.value, tokenOut.value.decimals).toFixed(6) : '0'
        )
        const totalSpentDisplay = computed(() =>
            tokenIn.value ? bnToBig(totalSpentRaw.value, tokenIn.value.decimals).toFixed(6) : '0'
        )

        const avgPriceDisplay = computed(() => {
            if (!tokenIn.value || !tokenOut.value) return '—'
            const inBig = bnToBig(totalSpentRaw.value, tokenIn.value.decimals)
            const outBig = bnToBig(totalReceivedRaw.value, tokenOut.value.decimals)
            if (inBig.lte(0)) return '—'
            return outBig.div(inBig).toFixed(6)
        })

        const etaDisplay = computed(() => {
            if (!running.value) return completedCount.value ? 'done' : '—'
            const done = completedCount.value
            if (done < 1) return 'calculating…'
            const elapsed = nowTick.value - startTime.value
            const perChunk = elapsed / done
            const remainingMs = perChunk * chunksToGo.value
            return formatDuration(remainingMs)
        })

        const orderStatus = computed(() => {
            if (running.value) return 'running'
            if (rows.value.some((r) => r.status === 'error')) return 'error'
            if (completedCount.value === chunkCount.value && chunkCount.value > 0) return 'done'
            if (aborted.value) return 'aborted'
            return 'idle'
        })
        const orderStatusLabel = computed(() => {
            switch (orderStatus.value) {
                case 'running':
                    return 'Running'
                case 'done':
                    return 'Completed'
                case 'error':
                    return 'Stopped (error)'
                case 'aborted':
                    return 'Aborted'
                default:
                    return 'Idle'
            }
        })

        // ── Helpers ──
        const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
        const shortHash = (h: string) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : '')
        const txUrl = (h: string) => cChainExplorerTxUrl(h, 43114)

        function formatDuration(ms: number): string {
            if (!isFinite(ms) || ms <= 0) return '—'
            const s = Math.round(ms / 1000)
            if (s < 60) return `${s}s`
            const m = Math.floor(s / 60)
            const rem = s % 60
            if (m < 60) return `${m}m ${rem}s`
            const h = Math.floor(m / 60)
            return `${h}h ${m % 60}m`
        }

        // ── Order execution ──
        const startOrder = async () => {
            if (!canSubmit.value || !wallet.value || !tokenIn.value || !tokenOut.value) return

            // Snapshot the chunk plan so later config-model changes can't mutate it.
            const plan = chunkAmounts.value.map((a) => a.clone())
            rows.value = plan.map((amount, index) => ({
                index,
                amount,
                amountDisplay: bnToBig(amount, tokenIn.value!.decimals).toFixed(6),
                status: 'pending',
                txHash: '',
                outRaw: null,
                outDisplay: '',
                priceDisplay: '',
                error: '',
            }))

            started.value = true
            running.value = true
            aborted.value = false
            startTime.value = Date.now()
            nowTick.value = Date.now()

            const w = wallet.value
            const inTok = tokenIn.value
            const outTok = tokenOut.value
            const userAddress = '0x' + w.getEvmAddress()

            try {
                // One-time approval covering the whole order (ERC20 inputs only).
                if (!isNativeToken(inTok.address)) {
                    const router = await getRouterAddress()
                    const allowance = await getAllowance(inTok.address, userAddress, router)
                    if (allowance.lt(totalAmountRaw.value)) {
                        rows.value[0].status = 'approving'
                        const gp = await GasHelper.getAdjustedGasPrice()
                        await approveRouter(w, inTok.address, totalAmountRaw.value, gp)
                        rows.value[0].status = 'pending'
                    }
                }

                for (let i = 0; i < rows.value.length; i++) {
                    if (aborted.value) break
                    if (!wallet.value) {
                        // Wallet closed mid-run — stop.
                        aborted.value = true
                        break
                    }
                    const row = rows.value[i]
                    try {
                        row.status = 'quoting'
                        const gp = await GasHelper.getAdjustedGasPrice()
                        gasPriceWei.value = gp
                        const q = await getQuote({
                            tokenIn: inTok,
                            tokenOut: outTok,
                            amountInRaw: row.amount,
                            userAddress,
                            slippagePercent: slippage.value,
                        })
                        if (aborted.value) break

                        row.status = 'swapping'
                        const res = await executeSwap(w, userAddress, q, gp)
                        row.txHash = res.txHash

                        const outRaw = new BN(q.outAmounts[0])
                        row.outRaw = outRaw
                        row.outDisplay = bnToBig(outRaw, outTok.decimals).toFixed(6)
                        const inBig = bnToBig(row.amount, inTok.decimals)
                        const outBig = bnToBig(outRaw, outTok.decimals)
                        row.priceDisplay = inBig.gt(0) ? outBig.div(inBig).toFixed(6) : '—'
                        row.status = 'done'
                    } catch (e: any) {
                        row.status = 'error'
                        row.error = e?.message || 'Chunk failed'
                        notifications.add({
                            type: 'error',
                            title: `Chunk ${i + 1} failed`,
                            message: row.error,
                        })
                        // Stop the whole order on the first failure so a bad
                        // route or slippage spike doesn't burn gas on every
                        // remaining chunk.
                        break
                    }

                    if (i < rows.value.length - 1 && !aborted.value) {
                        await delay(INTER_CHUNK_DELAY)
                    }
                }
            } finally {
                running.value = false
                // Refresh balances after the run.
                try {
                    await assetsStore.updateUTXOs()
                } catch {
                    /* non-fatal */
                }
                if (orderStatus.value === 'done') {
                    notifications.add({
                        type: 'success',
                        title: 'Iceberg order complete',
                        message: `${completedCount.value} chunks executed.`,
                    })
                }
            }
        }

        const abortOrder = () => {
            if (!running.value) return
            aborted.value = true
            notifications.add({
                type: 'warning',
                title: 'Aborting order',
                message: 'The order will stop after the current chunk finishes.',
            })
        }

        const resetOrder = () => {
            started.value = false
            running.value = false
            aborted.value = false
            rows.value = []
            startTime.value = 0
        }

        // ── Leave / close guards ──
        const hasActiveOrder = () => started.value

        const beforeUnloadHandler = (e: BeforeUnloadEvent) => {
            if (hasActiveOrder()) {
                e.preventDefault()
                e.returnValue = ''
                return ''
            }
        }

        onBeforeRouteLeave(() => {
            if (!hasActiveOrder()) return true
            const msg = running.value
                ? 'An iceberg order is still running. Leaving will abort it. Continue?'
                : 'Leaving will discard this iceberg order. Continue?'
            const ok = window.confirm(msg)
            if (ok) {
                aborted.value = true
                return true
            }
            return false
        })

        onMounted(() => {
            if (!tokenInAddr.value && heldTokens.value.length) {
                tokenInAddr.value = heldTokens.value[0].address
            }
            refreshGasPrice()
            gasTimer = setInterval(() => {
                if (!running.value) refreshGasPrice()
            }, 15000)
            tickTimer = setInterval(() => {
                nowTick.value = Date.now()
            }, 1000)
            window.addEventListener('beforeunload', beforeUnloadHandler)
        })

        onBeforeUnmount(() => {
            aborted.value = true
            if (gasTimer) clearInterval(gasTimer)
            if (tickTimer) clearInterval(tickTimer)
            if (resolveTimer) clearTimeout(resolveTimer)
            window.removeEventListener('beforeunload', beforeUnloadHandler)
        })

        return {
            // config
            heldTokens,
            tokenInAddr,
            tokenOutAddr,
            tokenIn,
            tokenOut,
            isResolving,
            targetError,
            mode,
            totalAmount,
            numChunks,
            customAmountsRaw,
            slippage,
            isLocked,
            // chunk math
            parsedChunks,
            chunkCount,
            perChunkPreview,
            totalAmountDisplay,
            customParseError,
            // fees
            gasPriceGwei,
            estFeeAvax,
            avaxBalanceDisplay,
            feeError,
            canSubmit,
            // execution
            started,
            running,
            rows,
            completedCount,
            chunksToGo,
            progressPct,
            etaDisplay,
            avgPriceDisplay,
            totalReceivedDisplay,
            totalSpentDisplay,
            orderStatus,
            orderStatusLabel,
            // handlers
            balanceOf,
            onTargetChange,
            startOrder,
            abortOrder,
            resetOrder,
            shortHash,
            txUrl,
        }
    },
})
</script>

<style lang="scss" scoped>
.iceberg_page {
    max-width: 720px;

    h1 {
        margin-bottom: 8px;
    }

    .desc {
        color: var(--primary-color-light);
        margin-bottom: 24px;
        line-height: 1.5;
        font-size: 0.92em;
    }
}

.card {
    background: var(--bg-light);
    border: 1px solid var(--bg-light);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;

    h2 {
        margin: 0 0 16px;
        font-size: 18px;
    }
}

.token_block {
    background: var(--bg);
    border: 1px solid #d3d3d3;
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 14px;

    .token_head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;

        label {
            font-size: 13px;
            font-weight: 600;
        }

        .balance {
            font-size: 12px;
            color: var(--primary-color-light);
        }
    }
}

.token_select {
    border: 1px solid #d3d3d3;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 15px;
    font-weight: 600;
    background: var(--bg-light);
    color: var(--primary-color);
    cursor: pointer;

    &.full {
        width: 100%;
    }
}

.target_row {
    display: flex;
    align-items: center;
    gap: 8px;

    .address_input {
        flex: 1;
        min-width: 0;
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        font-family: monospace;
        background: var(--bg-light);
        color: var(--primary-color);

        &:focus {
            outline: none;
            border-color: var(--secondary-color);
        }
    }

    .resolve_state {
        font-size: 12px;
        white-space: nowrap;

        &.ok {
            color: #4caf50;
        }
        &.err {
            color: #f44336;
        }
    }
}

.mode_row {
    display: flex;
    gap: 20px;
    margin: 6px 0 14px;

    .mode_opt {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
    }
}

.field_grid {
    display: grid;
    grid-template-columns: 1fr 160px;
    gap: 12px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 6px;

    label {
        font-size: 13px;
        font-weight: 600;
    }
}

.text_input,
.amounts_area {
    border: 1px solid #d3d3d3;
    border-radius: 8px;
    padding: 10px;
    font-size: 14px;
    background: var(--bg);
    color: var(--primary-color);

    &:focus {
        outline: none;
        border-color: var(--secondary-color);
    }
}

.amounts_area {
    min-height: 96px;
    resize: vertical;
    font-family: monospace;
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 4px 0 12px;

    &.err {
        color: #f44336;
    }
}

.slippage_row {
    margin: 14px 0 8px;

    label {
        font-size: 13px;
        font-weight: 600;
        display: block;
        margin-bottom: 8px;
    }

    .slippage_options {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .slip_btn {
        border: 1px solid #d3d3d3;
        background: var(--bg);
        border-radius: 8px;
        padding: 6px 12px;
        font-size: 13px;
        cursor: pointer;

        &.active {
            border-color: var(--secondary-color);
            color: var(--secondary-color);
            font-weight: 600;
        }
    }

    .slip_input {
        width: 72px;
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 13px;
        background: var(--bg);
        color: var(--primary-color);
    }

    .pct {
        font-size: 13px;
        color: var(--primary-color-light);
    }
}

.fee_box {
    margin-top: 18px;
    padding: 14px;
    background: var(--bg);
    border-radius: 10px;

    .fee_row {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        margin-bottom: 6px;
        color: var(--primary-color);

        &:last-of-type {
            margin-bottom: 0;
        }
    }

    .fee_error {
        margin: 10px 0 0;
        font-size: 13px;
        color: #f44336;
        font-weight: 600;
    }
}

.actions {
    margin-top: 18px;
}

.action_btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--secondary-color);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;

    &:hover:not(:disabled) {
        opacity: 0.9;
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.progress_head {
    display: flex;
    justify-content: space-between;
    align-items: center;

    h2 {
        display: flex;
        align-items: center;
        gap: 10px;
    }
}

.prog_badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
    text-transform: uppercase;

    &.badge_running {
        background: #fff3cd;
        color: #8a6d00;
    }
    &.badge_done {
        background: #e8f5e9;
        color: #2e7d32;
    }
    &.badge_error,
    &.badge_aborted {
        background: #fdecea;
        color: #c62828;
    }
    &.badge_idle {
        background: var(--bg);
        color: var(--primary-color-light);
    }
}

.ghost_btn {
    border: 1px solid #d3d3d3;
    background: transparent;
    color: var(--primary-color);
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;

    &:hover {
        border-color: var(--secondary-color);
    }

    &.danger {
        color: #c62828;
        border-color: #e0a0a0;

        &:hover {
            background: #fdecea;
        }
    }
}

.stats_grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin: 18px 0;

    .stat {
        background: var(--bg);
        border-radius: 8px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .stat_label {
        font-size: 11px;
        color: var(--primary-color-light);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .stat_value {
        font-size: 15px;
        font-weight: 600;
        color: var(--primary-color);
    }
}

.progress_bar {
    height: 8px;
    background: var(--bg);
    border-radius: 999px;
    overflow: hidden;
    margin-bottom: 18px;

    .progress_fill {
        height: 100%;
        background: var(--secondary-color);
        transition: width 0.4s ease;
    }
}

.tx_table {
    border: 1px solid var(--bg);
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;

    .tx_header,
    .tx_row {
        display: grid;
        grid-template-columns: 40px 1.2fr 1.2fr 1fr 1.6fr;
        gap: 10px;
        padding: 10px 14px;
        align-items: center;
    }

    .tx_header {
        background: var(--bg);
        font-weight: 700;
        font-size: 12px;
        color: var(--primary-color-light);
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }

    .tx_row {
        border-top: 1px solid var(--bg);

        &.row_done {
            border-left: 3px solid #4caf50;
        }
        &.row_error {
            border-left: 3px solid #f44336;
        }
        &.row_quoting,
        &.row_swapping,
        &.row_approving {
            border-left: 3px solid var(--secondary-color);
        }
    }

    .tx_status {
        overflow: hidden;
    }

    .tx_link {
        color: var(--secondary-color);
        font-weight: 600;
        text-decoration: none;
        font-family: monospace;

        &:hover {
            text-decoration: underline;
        }
    }

    .err_text {
        color: #f44336;
        word-break: break-word;
    }
}

@media (max-width: 640px) {
    .stats_grid {
        grid-template-columns: repeat(2, 1fr);
    }
    .field_grid {
        grid-template-columns: 1fr;
    }
    .tx_table {
        .tx_header {
            display: none;
        }
        .tx_row {
            grid-template-columns: 30px 1fr;
            grid-auto-rows: min-content;
        }
    }
}
</style>
