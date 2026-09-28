<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Watcher limit orders — see js/LimitOrder.ts. The order lives in this tab:
  it polls LI.FI quotes and fills when the market reaches the limit, only
  from a quote whose enforced minimum is at or above it.

  Built the same way as the Iceberg page (same token sources, the same
  js/ArenaSwap quote / approve / execute path, the same leave guards), and
  gated the same way: arming asks the Moats-burn requirement.

  Panels are `lo_panel`, not `card`: Bootstrap's `.card` forces near-black
  text on this dark theme.
-->
<template>
    <div class="limit_page">
        <h1>Limit Order</h1>
        <p class="desc">
            Swap when the market reaches your price. The order is watched from this tab — keep it
            open. It fills only at your limit or better: the swap carries a minimum output at or
            above your price, and reverts on-chain rather than filling below it. Your wallet asks
            you to confirm the fill when the price is reached. Routing uses LI.FI.
        </p>

        <div v-if="!wallet || !signer" class="lo_panel notice">
            <p>Connect an Avalanche wallet to place limit orders.</p>
        </div>

        <template v-else>
            <!-- ── Setup ── -->
            <section class="lo_panel">
                <h2>Order</h2>

                <div class="field">
                    <div class="field_head">
                        <label>You pay</label>
                        <span v-if="tokenIn" class="muted">
                            Balance: {{ balanceOf(tokenIn) }} {{ tokenIn.symbol }}<RegistryCheck :address="tokenIn.address"></RegistryCheck>
                        </span>
                    </div>
                    <div class="row">
                        <input
                            v-model="amountText"
                            type="text"
                            inputmode="decimal"
                            class="text_input grow"
                            placeholder="0.0"
                            :disabled="isLocked"
                            name="lo-amount"
                            autocomplete="off"
                            data-1p-ignore
                            data-lpignore="true"
                        />
                        <button type="button" class="small_btn" :disabled="isLocked || !tokenIn" @click="setMax">
                            Max
                        </button>
                        <select v-model="tokenInAddr" class="token_select" :disabled="isLocked">
                            <option v-if="!heldTokens.length" value="" disabled>No tokens held</option>
                            <option v-for="t in heldTokens" :key="'in-' + t.address" :value="t.address">
                                {{ t.symbol }}
                            </option>
                        </select>
                    </div>
                </div>

                <div class="field">
                    <label>You receive</label>
                    <div class="row">
                        <input
                            v-model="tokenOutText"
                            type="text"
                            class="text_input grow"
                            placeholder="Token address (0x…) or symbol (e.g. USDC)"
                            spellcheck="false"
                            :disabled="isLocked"
                            name="lo-target"
                            autocomplete="off"
                            data-1p-ignore
                            data-lpignore="true"
                            @input="onTargetChange"
                        />
                        <span v-if="isResolving" class="state">Resolving…</span>
                        <span v-else-if="tokenOut" class="state ok">✓ {{ tokenOut.symbol }}<RegistryCheck :address="tokenOut.address"></RegistryCheck></span>
                        <span v-else-if="targetError" class="state err">{{ targetError }}</span>
                    </div>
                </div>

                <div class="field">
                    <label>Limit</label>
                    <div class="side_toggle" role="group">
                        <button
                            type="button"
                            :class="{ selected: side === 'sell' }"
                            :disabled="isLocked"
                            @click="side = 'sell'"
                        >
                            Sell at or above
                        </button>
                        <button
                            type="button"
                            :class="{ selected: side === 'buy' }"
                            :disabled="isLocked"
                            @click="side = 'buy'"
                        >
                            Buy at or below
                        </button>
                    </div>
                    <div class="row">
                        <input
                            v-model="priceText"
                            type="text"
                            inputmode="decimal"
                            class="text_input grow"
                            placeholder="0.0"
                            :disabled="isLocked"
                            name="lo-price"
                            autocomplete="off"
                            data-1p-ignore
                            data-lpignore="true"
                        />
                        <span class="unit">{{ priceUnit }}</span>
                        <button
                            type="button"
                            class="small_btn"
                            :disabled="isLocked || !canQuote || previewing"
                            @click="useMarketPrice"
                        >
                            Use market
                        </button>
                    </div>
                    <p class="hint">
                        <template v-if="side === 'sell'">
                            Fills when 1 {{ tokenIn ? tokenIn.symbol : 'token' }} gets at least this many
                            {{ tokenOut ? tokenOut.symbol : 'tokens' }}.
                        </template>
                        <template v-else>
                            Fills when 1 {{ tokenOut ? tokenOut.symbol : 'token' }} costs at most this many
                            {{ tokenIn ? tokenIn.symbol : 'tokens' }}.
                        </template>
                        <template v-if="minOutText">
                            You receive at least <strong>{{ minOutText }} {{ tokenOut && tokenOut.symbol }}</strong>.
                        </template>
                    </p>
                </div>

                <div class="field_grid">
                    <div class="field">
                        <label>Max slippage</label>
                        <select v-model.number="maxSlippage" class="token_select full" :disabled="isLocked">
                            <option v-for="s in [0.5, 1, 2, 3, 5]" :key="s" :value="s">{{ s }}%</option>
                        </select>
                        <span class="hint">Used only as far as your limit allows.</span>
                    </div>
                    <div class="field">
                        <label>Stop watching after</label>
                        <select v-model.number="expiryHours" class="token_select full" :disabled="isLocked">
                            <option :value="0">Never (while open)</option>
                            <option :value="1">1 hour</option>
                            <option :value="6">6 hours</option>
                            <option :value="24">24 hours</option>
                        </select>
                    </div>
                </div>

                <label class="check">
                    <input v-model="browserNotify" type="checkbox" :disabled="isLocked" />
                    Notify me in the browser when it fills or needs me
                </label>

                <p v-if="market && !order" class="market">
                    Market now: 1 {{ tokenIn && tokenIn.symbol }} ≈ {{ fmtRate(market.rate) }}
                    {{ tokenOut && tokenOut.symbol }}
                    <span class="muted">(1 {{ tokenOut && tokenOut.symbol }} ≈ {{ fmtRate(market.inverse) }} {{ tokenIn && tokenIn.symbol }})</span>
                </p>
                <p v-if="setupError" class="error_msg">{{ setupError }}</p>

                <button
                    v-if="!order || isFinal"
                    type="button"
                    class="arm_btn"
                    :disabled="!canArm || arming || isBlocked"
                    @click="gatedAction(arm)"
                >
                    {{ arming ? armingText : order ? 'Place another order' : 'Place limit order' }}
                </button>
            </section>

            <!-- ── Live order ── -->
            <section v-if="order" class="lo_panel status" :class="snap.state">
                <div class="status_head">
                    <h2>
                        {{ order.amountText }} {{ order.tokenIn.symbol }} → {{ order.tokenOut.symbol }}
                    </h2>
                    <span class="badge" :class="snap.state">{{ stateLabel }}</span>
                </div>

                <div class="tiles">
                    <div class="tile">
                        <label>Your limit</label>
                        <p>{{ order.priceText }} {{ order.priceUnit }}</p>
                        <span>at least {{ order.minOutText }} {{ order.tokenOut.symbol }}</span>
                    </div>
                    <div class="tile">
                        <label>Market</label>
                        <p>{{ liveMarketText }}</p>
                        <span>{{ distanceText }}</span>
                    </div>
                    <div class="tile">
                        <label>Checks</label>
                        <p>{{ snap.checks }}</p>
                        <span>{{ lastCheckedText }}</span>
                    </div>
                    <div v-if="order.expiresAt" class="tile">
                        <label>Stops</label>
                        <p>{{ new Date(order.expiresAt).toLocaleTimeString() }}</p>
                    </div>
                </div>

                <p v-if="snap.state === 'filling'" class="attention">
                    Your limit was reached — confirm the swap in your wallet.
                </p>
                <p v-if="snap.state === 'paused'" class="error_msg">{{ snap.pausedReason }}</p>
                <p v-if="snap.lastError && snap.state === 'watching'" class="muted">
                    Last check failed: {{ snap.lastError }} — retrying.
                </p>
                <p v-if="snap.state === 'filled'" class="filled">
                    Filled — about {{ filledOutText }} {{ order.tokenOut.symbol }} received.
                </p>
                <p v-if="snap.state === 'captured'" class="muted">
                    The fill was captured for offline signing, not broadcast.
                </p>
                <a v-if="snap.txHash" class="tx_link" :href="txUrl(snap.txHash)" target="_blank" rel="noopener noreferrer">
                    View transaction ↗
                </a>

                <div class="status_actions">
                    <button v-if="snap.state === 'paused'" type="button" class="small_btn" @click="resume">
                        Resume watching
                    </button>
                    <button
                        v-if="snap.state === 'watching' || snap.state === 'paused'"
                        type="button"
                        class="small_btn danger"
                        @click="cancelOrder"
                    >
                        Cancel order
                    </button>
                </div>
            </section>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, shallowRef, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import { useAssetsStore, useMainStore, useNotificationsStore } from '@/stores'
import { toBaseUnits } from '@/js/TokenLauncher'
import {
    approveRouter,
    executeSwap,
    getAllowance,
    getQuote,
    isNativeToken,
    resolveTargetToken,
    swapExplorerTxUrl,
    NATIVE_TOKEN_ADDRESS,
    type SwapToken,
} from '@/js/ArenaSwap'
import {
    LimitOrderWatcher,
    guaranteesLimit,
    isUserRejection,
    limitMinOut,
    quoteRate,
    type FillOutcome,
    type LimitSide,
    type WatchSnapshot,
} from '@/js/LimitOrder'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { authorizeBatch, authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { isOfflineTxId } from '@/stores/offlineSigning'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import RegistryCheck from '@/components/misc/RegistryCheck.vue'
import type { EvmSigner } from '@/evm/signer'

const CHECK_INTERVAL_MS = 15_000
/** Same gas budget the Iceberg page reserves per aggregator swap. */
const SWAP_GAS_UNITS = 500_000

const NATIVE_AVAX: SwapToken = {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'AVAX',
    name: 'Avalanche',
    decimals: 18,
}

interface ArmedOrder {
    tokenIn: SwapToken
    tokenOut: SwapToken
    amountInRaw: BN
    amountText: string
    minOut: BN
    minOutText: string
    priceText: string
    priceUnit: string
    side: LimitSide
    expiresAt: number | null
    signer: EvmSigner
}

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: leaving the page must
    // destroy the watcher, never keep a cached one polling in the background.
    name: 'limit_order',
    components: { RegistryCheck },
    setup() {
        // Premium, asked when the order is placed — see useBaseAssetGate.
        const { isBlocked, gatedAction } = useBaseAssetGate()

        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const wallet = computed(() => mainStore.activeWallet as any)
        const signer = computed(() => activeEvmSigner())

        // concat, not array spread: vue3-jest's TypeScript output turns a spread
        // into a tslib helper the installed tslib lacks.
        const allErc20 = (): any[] =>
            ((assetsStore.erc20Tokens || []) as any[]).concat((assetsStore.erc20TokensCustom || []) as any[])

        // ── Tokens: what is held (like the Iceberg page) ──
        const heldTokens = computed<SwapToken[]>(() => {
            const out: SwapToken[] = []
            if ((wallet.value?.ethBalance || new BN(0)).gt(new BN(0))) out.push(NATIVE_AVAX)
            const seen = new Set([NATIVE_AVAX.address])
            for (const t of allErc20()) {
                const k = t.data.address.toLowerCase()
                if (seen.has(k) || !t.balanceBN || t.balanceBN.lten(0)) continue
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

        const tokenInAddr = ref('')
        const tokenIn = computed(() => heldTokens.value.find((t) => t.address === tokenInAddr.value) || null)
        const tokenOutText = ref('')
        const tokenOut = ref<SwapToken | null>(null)
        const isResolving = ref(false)
        const targetError = ref('')
        const amountText = ref('')
        const side = ref<LimitSide>('sell')
        const priceText = ref('')
        const maxSlippage = ref(1)
        const expiryHours = ref(0)
        const browserNotify = ref(false)

        const avaxBalance = computed<BN>(() => wallet.value?.ethBalance || new BN(0))
        const balanceRaw = (t: SwapToken): BN => {
            if (isNativeToken(t.address)) return avaxBalance.value
            const found = allErc20().find((e) => e.data.address.toLowerCase() === t.address.toLowerCase())
            return found?.balanceBN || new BN(0)
        }
        const balanceOf = (t: SwapToken) => bnToBig(balanceRaw(t), t.decimals).toFixed(4)

        const amountInRaw = computed<BN | null>(() => {
            if (!tokenIn.value) return null
            try {
                const v = toBaseUnits(amountText.value, tokenIn.value.decimals)
                return v.gtn(0) ? v : null
            } catch {
                return null
            }
        })

        const priceValid = computed(() => /^\d+(\.\d+)?$/.test(priceText.value.trim()) && Number(priceText.value) > 0)
        const priceUnit = computed(() => {
            const a = tokenIn.value?.symbol ?? '…'
            const b = tokenOut.value?.symbol ?? '…'
            return side.value === 'sell' ? `${b} per ${a}` : `${a} per ${b}`
        })

        const minOut = computed<BN | null>(() => {
            if (!amountInRaw.value || !tokenIn.value || !tokenOut.value || !priceValid.value) return null
            try {
                return limitMinOut(amountInRaw.value, priceText.value.trim(), side.value, tokenIn.value, tokenOut.value)
            } catch {
                return null
            }
        })
        const fmt = (raw: BN, decimals: number) =>
            Number(bnToBig(raw, decimals).toString()).toLocaleString(undefined, { maximumFractionDigits: 6 })
        const minOutText = computed(() => (minOut.value && tokenOut.value ? fmt(minOut.value, tokenOut.value.decimals) : ''))

        const setMax = () => {
            if (!tokenIn.value) return
            amountText.value = bnToBig(balanceRaw(tokenIn.value), tokenIn.value.decimals).toString()
        }

        // ── Target token (address or symbol), as on the Iceberg page ──
        let resolveTimer: ReturnType<typeof setTimeout> | undefined
        const resolveTarget = async () => {
            const raw = tokenOutText.value.trim()
            targetError.value = ''
            tokenOut.value = null
            if (!raw || !signer.value) return
            isResolving.value = true
            try {
                const known = allErc20().find(
                    (e) =>
                        e.data.address.toLowerCase() === raw.toLowerCase() ||
                        (e.data.symbol || '').toLowerCase() === raw.toLowerCase()
                )
                const resolved: SwapToken =
                    raw.toUpperCase() === 'AVAX'
                        ? NATIVE_AVAX
                        : known
                        ? {
                              address: known.data.address,
                              symbol: known.data.symbol,
                              name: known.data.name,
                              decimals: parseInt(known.data.decimals as string) || 18,
                          }
                        : await resolveTargetToken(signer.value, raw)
                if (resolved.address.toLowerCase() === tokenInAddr.value.toLowerCase()) {
                    targetError.value = 'Must differ from the token you pay'
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
            if (resolveTimer) clearTimeout(resolveTimer)
            resolveTimer = setTimeout(resolveTarget, 400)
        }

        // ── Market preview, before an order exists ──
        const canQuote = computed(() => !!signer.value && !!tokenIn.value && !!tokenOut.value && !!amountInRaw.value)
        const market = shallowRef<{ rate: Big; inverse: Big } | null>(null)
        const previewing = ref(false)
        const quoteFor = (s: EvmSigner, tIn: SwapToken, tOut: SwapToken, amount: BN, slippagePercent: number) =>
            getQuote({
                chainId: s.network.evmChainId,
                tokenIn: tIn,
                tokenOut: tOut,
                amountInRaw: amount,
                userAddress: s.address,
                slippagePercent,
            })
        const refreshPreview = async () => {
            // A live order does its own checking; a preview queued while the
            // order was being set up would only spend a LI.FI request.
            if (isLocked.value) return
            if (!canQuote.value) {
                market.value = null
                return
            }
            previewing.value = true
            try {
                const q = await quoteFor(signer.value!, tokenIn.value!, tokenOut.value!, amountInRaw.value!, maxSlippage.value)
                const rate = quoteRate(amountInRaw.value!, q.toAmount, tokenIn.value!, tokenOut.value!)
                market.value = { rate, inverse: rate.gt(0) ? Big(1).div(rate) : Big(0) }
            } catch (e: any) {
                market.value = null
                setupError.value = e?.message || 'Could not price this pair.'
            } finally {
                previewing.value = false
            }
        }
        let previewTimer: ReturnType<typeof setTimeout> | undefined
        watch([tokenInAddr, tokenOut, amountInRaw], () => {
            setupError.value = ''
            if (previewTimer) clearTimeout(previewTimer)
            previewTimer = setTimeout(refreshPreview, 600)
        })
        const fmtRate = (r: Big) => {
            const n = Number(r.toString())
            return n.toLocaleString(undefined, { maximumSignificantDigits: 8 })
        }
        const useMarketPrice = async () => {
            await refreshPreview()
            if (!market.value) return
            const value = side.value === 'sell' ? market.value.rate : market.value.inverse
            priceText.value = Number(value.toPrecision(8)).toString()
        }

        // ── Placing the order ──
        const setupError = ref('')
        const arming = ref(false)
        const armingText = ref('')
        const order = shallowRef<ArmedOrder | null>(null)
        const snap = ref<WatchSnapshot>({
            state: 'watching',
            lastQuote: null,
            lastCheckedAt: 0,
            checks: 0,
            lastError: '',
            pausedReason: '',
            txHash: '',
            outRaw: null,
        })
        let watcher: LimitOrderWatcher | null = null

        const isFinal = computed(() => ['filled', 'captured', 'expired', 'cancelled'].includes(snap.value.state))
        const isLocked = computed(() => !!order.value && !isFinal.value)

        /** Why the order cannot be placed as set up, or '' when it can. */
        const blocker = computed((): string => {
            if (!tokenIn.value) return 'Choose the token you pay.'
            if (!tokenOut.value) return 'Choose the token you receive.'
            if (!amountInRaw.value) return 'Enter an amount.'
            if (!priceValid.value) return 'Enter a limit price.'
            if (amountInRaw.value.gt(balanceRaw(tokenIn.value))) {
                return `That is more ${tokenIn.value.symbol} than this wallet holds.`
            }
            return ''
        })
        const canArm = computed(() => !blocker.value && !isLocked.value)

        const attention = (title: string, body: string) => {
            document.title = `● ${title}`
            if (browserNotify.value && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                try {
                    new Notification(title, { body })
                } catch {
                    /* some browsers only allow notifications from a service worker */
                }
            }
        }
        const originalTitle = document.title
        const clearAttention = () => (document.title = originalTitle)

        const onSnapshot = (s: WatchSnapshot) => {
            const prev = snap.value.state
            snap.value = s
            const o = order.value
            if (!o || prev === s.state) return
            if (s.state === 'filling') {
                notifications.add({ type: 'info', title: 'Limit reached', message: 'Confirm the swap in your wallet.' })
                attention('Limit reached', `Confirm ${o.amountText} ${o.tokenIn.symbol} → ${o.tokenOut.symbol}`)
            } else if (s.state === 'filled') {
                notifications.add({
                    type: 'success',
                    title: 'Limit order filled',
                    message: `${o.amountText} ${o.tokenIn.symbol} swapped for ${o.tokenOut.symbol}.`,
                })
                attention('Limit order filled', `${o.amountText} ${o.tokenIn.symbol} → ${o.tokenOut.symbol}`)
                void refreshBalances()
            } else if (s.state === 'paused') {
                notifications.add({ type: 'warning', title: 'Limit order paused', message: s.pausedReason })
                attention('Limit order paused', s.pausedReason)
            } else if (s.state === 'expired') {
                notifications.add({ type: 'info', title: 'Limit order expired', message: 'It stopped watching.' })
                clearAttention()
            } else if (s.state === 'watching') {
                clearAttention()
            }
        }

        const refreshBalances = async () => {
            try {
                await Promise.all([wallet.value?.getEthBalance?.(), assetsStore.updateERC20Balances?.()])
            } catch {
                /* best effort */
            }
        }

        /**
         * One fill: authorize, then — inside the authorized call — take a
         * fresh quote, refuse it unless its minimum guarantees the limit,
         * approve if the router changed, send and wait for the receipt.
         */
        const fill = async (o: ArmedOrder, slippagePercent: number): Promise<FillOutcome> => {
            const s = o.signer
            try {
                return await authorizeBatch(
                    s.authSubject,
                    `Fill limit order: ${o.amountText} ${o.tokenIn.symbol} → ${o.tokenOut.symbol}`,
                    async (): Promise<FillOutcome> => {
                        const q = await quoteFor(s, o.tokenIn, o.tokenOut, o.amountInRaw, slippagePercent)
                        if (!guaranteesLimit(q, o.minOut)) return { kind: 'not-met' }
                        if (o.amountInRaw.gt(balanceRaw(o.tokenIn))) {
                            return { kind: 'failed', error: `This wallet no longer holds ${o.amountText} ${o.tokenIn.symbol}.` }
                        }

                        let nonce: number | undefined
                        if (!isNativeToken(o.tokenIn.address) && q.approvalAddress) {
                            const allowance = await getAllowance(s, o.tokenIn.address, s.address, q.approvalAddress)
                            if (allowance.lt(o.amountInRaw)) {
                                const base = await s.getNonce()
                                await approveRouter(s, o.tokenIn.address, q.approvalAddress, o.amountInRaw, base)
                                nonce = base + 1
                            }
                        }

                        const { txHash } = await executeSwap(s, q, nonce)
                        if (isOfflineTxId(txHash)) return { kind: 'captured', txHash }
                        const receipt = await s.waitForReceipt(txHash)
                        if (!receipt.status) {
                            return {
                                kind: 'failed',
                                txHash,
                                error: 'The swap reverted on-chain — the price moved past your limit before it was mined. Nothing was swapped.',
                            }
                        }
                        return { kind: 'filled', txHash, outRaw: new BN(q.toAmount) }
                    }
                )
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled || isUserRejection(e)) return { kind: 'declined' }
                return { kind: 'failed', error: e?.message || 'The fill failed.' }
            }
        }

        const arm = async () => {
            const s = signer.value
            if (!s || !canArm.value || !tokenIn.value || !tokenOut.value || !amountInRaw.value || !minOut.value) {
                setupError.value = blocker.value
                return
            }
            setupError.value = ''
            arming.value = true
            try {
                const tIn = tokenIn.value
                const tOut = tokenOut.value
                const amount = amountInRaw.value

                // Gas for the fill, on top of the amount when paying in AVAX.
                armingText.value = 'Checking balances…'
                const gas = (await s.getGasPrice()).mul(new BN(SWAP_GAS_UNITS)).muln(3).divn(2)
                const needAvax = isNativeToken(tIn.address) ? amount.add(gas) : gas
                if (avaxBalance.value.lt(needAvax)) {
                    setupError.value = `Keep about ${fmt(needAvax, 18)} AVAX for this order and the gas to fill it.`
                    return
                }

                // Approve now, so the fill itself is a single confirmation.
                if (!isNativeToken(tIn.address)) {
                    armingText.value = 'Checking approval…'
                    const probe = await quoteFor(s, tIn, tOut, amount, maxSlippage.value)
                    if (probe.approvalAddress) {
                        const allowance = await getAllowance(s, tIn.address, s.address, probe.approvalAddress)
                        if (allowance.lt(amount)) {
                            armingText.value = 'Approve in your wallet…'
                            await authorizeSingle(s.authSubject, `Approve ${tIn.symbol} for a limit order`, () =>
                                approveRouter(s, tIn.address, probe.approvalAddress!, amount)
                            )
                        }
                    }
                }

                if (browserNotify.value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    try {
                        await Notification.requestPermission()
                    } catch {
                        /* not fatal */
                    }
                }

                const armed: ArmedOrder = {
                    tokenIn: tIn,
                    tokenOut: tOut,
                    amountInRaw: amount,
                    amountText: fmt(amount, tIn.decimals),
                    minOut: minOut.value,
                    minOutText: minOutText.value,
                    priceText: priceText.value.trim(),
                    priceUnit: priceUnit.value,
                    side: side.value,
                    expiresAt: expiryHours.value ? Date.now() + expiryHours.value * 3_600_000 : null,
                    signer: s,
                }
                watcher?.cancel()
                order.value = armed
                watcher = new LimitOrderWatcher({
                    minOut: armed.minOut,
                    maxSlippagePercent: maxSlippage.value,
                    expiresAt: armed.expiresAt,
                    intervalMs: CHECK_INTERVAL_MS,
                    quote: (slip) => quoteFor(s, tIn, tOut, amount, slip),
                    fill: (slip) => fill(armed, slip),
                    onUpdate: onSnapshot,
                })
                watcher.start()
            } catch (e: any) {
                if (!(e instanceof SessionAuthCancelled)) {
                    setupError.value = e?.message || 'Could not place the order.'
                }
            } finally {
                arming.value = false
                armingText.value = ''
            }
        }

        const cancelOrder = () => {
            watcher?.cancel()
            clearAttention()
        }
        const resume = () => watcher?.resume()

        // ── Live view ──
        const now = ref(Date.now())
        const liveRate = computed(() => {
            const o = order.value
            const q = snap.value.lastQuote
            if (!o || !q) return null
            return quoteRate(o.amountInRaw, q.toAmount, o.tokenIn, o.tokenOut)
        })
        const liveMarketText = computed(() => {
            const o = order.value
            const r = liveRate.value
            if (!o || !r) return 'checking…'
            const shown = o.side === 'sell' ? r : r.gt(0) ? Big(1).div(r) : Big(0)
            return `${fmtRate(shown)} ${o.priceUnit}`
        })
        /** How far the market still has to move, measured on the output. */
        const distanceText = computed(() => {
            const o = order.value
            const q = snap.value.lastQuote
            if (!o || !q) return ''
            const out = Big(q.toAmount || '0')
            if (out.lte(0)) return ''
            const gap = Big(o.minOut.toString()).minus(out).div(out).times(100)
            if (gap.lte(0)) return 'at or past your limit'
            return `${Number(gap.toFixed(2))}% away from your limit`
        })
        const lastCheckedText = computed(() => {
            if (!snap.value.lastCheckedAt) return ''
            const s = Math.max(0, Math.round((now.value - snap.value.lastCheckedAt) / 1000))
            return `last ${s}s ago · every ${CHECK_INTERVAL_MS / 1000}s`
        })
        const filledOutText = computed(() =>
            order.value && snap.value.outRaw ? fmt(snap.value.outRaw, order.value.tokenOut.decimals) : ''
        )
        const stateLabel = computed(
            () =>
                ({
                    watching: 'Watching',
                    filling: 'Filling',
                    filled: 'Filled',
                    captured: 'Captured',
                    paused: 'Paused',
                    expired: 'Expired',
                    cancelled: 'Cancelled',
                } as Record<string, string>)[snap.value.state]
        )
        const txUrl = (h: string) => (order.value ? swapExplorerTxUrl(order.value.signer.network, h) : '')

        // ── Leave guards: the order lives in this tab ──
        const isLive = () => !!watcher?.isLive
        const beforeUnload = (e: BeforeUnloadEvent) => {
            if (isLive()) {
                e.preventDefault()
                e.returnValue = ''
                return ''
            }
        }
        onBeforeRouteLeave(() => {
            if (!isLive()) return true
            return window.confirm('Leaving cancels your limit order — it only runs while this page is open. Leave anyway?')
        })

        let clock: ReturnType<typeof setInterval> | undefined
        onMounted(() => {
            window.addEventListener('beforeunload', beforeUnload)
            clock = setInterval(() => (now.value = Date.now()), 1000)
            if (!tokenInAddr.value && heldTokens.value.length) tokenInAddr.value = heldTokens.value[0].address
        })
        onBeforeUnmount(() => {
            window.removeEventListener('beforeunload', beforeUnload)
            if (clock) clearInterval(clock)
            if (resolveTimer) clearTimeout(resolveTimer)
            if (previewTimer) clearTimeout(previewTimer)
            watcher?.cancel()
            clearAttention()
        })

        return {
            isBlocked,
            gatedAction,
            wallet,
            signer,
            heldTokens,
            tokenInAddr,
            tokenIn,
            tokenOutText,
            tokenOut,
            isResolving,
            targetError,
            amountText,
            side,
            priceText,
            priceUnit,
            maxSlippage,
            expiryHours,
            browserNotify,
            minOutText,
            balanceOf,
            setMax,
            onTargetChange,
            canQuote,
            market,
            previewing,
            fmtRate,
            useMarketPrice,
            setupError,
            arming,
            armingText,
            order,
            snap,
            isFinal,
            isLocked,
            canArm,
            arm,
            cancelOrder,
            resume,
            liveMarketText,
            distanceText,
            lastCheckedText,
            filledOutText,
            stateLabel,
            txUrl,
        }
    },
})
</script>

<style lang="scss" scoped>
.limit_page {
    max-width: 720px;
    color: var(--primary-color);

    .desc {
        color: var(--primary-color-light);
        line-height: 1.6;
        margin-bottom: 20px !important;
    }
}

.lo_panel {
    background: var(--bg-light);
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 18px;
    color: var(--primary-color);

    h2 {
        margin: 0 0 14px;
        font-size: 17px;
    }
}

.field {
    display: flex;
    flex-direction: column;
    margin-bottom: 16px;

    label {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
    }
}

.field_head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
}

.field_grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.grow {
    flex: 1;
    min-width: 0;
}

.text_input,
.token_select {
    background: var(--bg);
    border: 1px solid var(--bg);
    border-radius: 8px;
    padding: 9px 12px;
    font-size: 15px;
    color: var(--primary-color);

    &:focus {
        outline: none;
        border-color: var(--secondary-color);
    }

    &:disabled {
        opacity: 0.6;
    }
}

.token_select.full {
    width: 100%;
}

.unit {
    font-size: 12px;
    color: var(--primary-color-light);
    white-space: nowrap;
}

.side_toggle {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;

    button {
        flex: 1;
        border: 1px solid var(--bg);
        background: var(--bg);
        color: var(--primary-color);
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 13px;
        cursor: pointer;

        &.selected {
            border-color: var(--secondary-color);
        }

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }
}

.small_btn {
    border: 1px solid var(--primary-color-light);
    background: transparent;
    color: var(--primary-color);
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;

    &.danger {
        border-color: var(--error);
        color: var(--error);
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.state {
    font-size: 12px;
    white-space: nowrap;

    &.ok {
        color: var(--success);
    }

    &.err {
        color: var(--error);
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin-top: 6px !important;
    line-height: 1.5;
}

.check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--primary-color-light);
    margin-bottom: 14px;
    cursor: pointer;
}

.market {
    font-size: 13px;
    margin-bottom: 12px !important;
}

.arm_btn {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--secondary-color);
    // See the note on `.button_secondary` in _main.scss.
    color: var(--platform-on-accent, #fff) !important;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;

    &:disabled {
        background: var(--bg);
        color: var(--primary-color-light) !important;
        cursor: not-allowed;
    }
}

.status_head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
}

.badge {
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 10px;
    border: 1px solid var(--primary-color-light);

    &.watching {
        border-color: var(--info);
        color: var(--info);
    }

    &.filling {
        border-color: var(--warning);
        color: var(--warning);
    }

    &.filled {
        border-color: var(--success);
        color: var(--success);
    }

    &.paused {
        border-color: var(--error);
        color: var(--error);
    }
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
}

.tile {
    background: var(--bg);
    border-radius: 8px;
    padding: 10px 12px;
    min-width: 0;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }

    p {
        font-weight: 600;
        margin-top: 4px !important;
        word-break: break-word;
    }

    span {
        display: block;
        font-size: 12px;
        color: var(--primary-color-light);
        margin-top: 2px;
    }
}

.attention {
    color: var(--warning);
    font-weight: 600;
}

.filled {
    color: var(--success);
    font-weight: 600;
}

.tx_link {
    display: inline-block;
    margin-top: 6px;
    color: var(--secondary-color);
}

.status_actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.muted {
    color: var(--primary-color-light);
    font-size: 13px;
}

.error_msg {
    color: var(--error);
    font-size: 13px;
    margin: 4px 0 12px !important;
}

.notice p {
    color: var(--primary-color-light);
}

@media (max-width: 600px) {
    .field_grid {
        grid-template-columns: 1fr;
    }
}
</style>
