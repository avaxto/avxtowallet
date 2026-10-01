<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  PHAR Swap: swap tokens on the Pharaoh exchange. WAVAX → AVAX is the default
  pair and a one-click "swap all"; see js/PharSwap.ts for how each kind of swap
  is sent, rebuilt from HARs of phar.gg's trade page.
-->
<template>
    <div class="phar_swap">
        <div class="head">
            <h1>PHAR Swap</h1>
            <p class="desc">
                Swap tokens on the Pharaoh exchange. WAVAX ↔ AVAX is a direct 1:1 unwrap/wrap on the
                WAVAX contract; other pairs are routed through Pharaoh's pools via the KyberSwap
                aggregator phar.gg uses.
            </p>
        </div>

        <p v-if="!signer" class="muted center">Connect an Avalanche wallet or the EVM platform to swap.</p>

        <template v-else>
            <p v-if="wrongChain" class="error_msg">
                The Pharaoh exchange is on Avalanche C-Chain; your wallet is on {{ wrongChain }}. Switch to
                C-Chain to swap.
            </p>

            <SignedTxExport v-if="offline.hasRecords" :records="offline.records" @done="onOfflineDone"></SignedTxExport>

            <template v-else>
                <!-- ── Swap all WAVAX ── -->
                <div class="swap_all">
                    <div>
                        <p class="swap_all_title">Swap all WAVAX to AVAX</p>
                        <p class="muted">
                            {{ wavaxBalance === null ? 'Reading balance…' : `${fmt(wavaxBalance, 18)} WAVAX in this wallet` }}
                        </p>
                    </div>
                    <v-btn
                        class="button_secondary"
                        depressed
                        small
                        :loading="busy && swappingAll"
                        :disabled="!canSwapAll"
                        @click="swapAllWavax"
                    >
                        Swap all
                    </v-btn>
                </div>

                <section class="swap_card">
                    <!-- From -->
                    <div class="side">
                        <div class="side_head">
                            <label>You pay</label>
                            <button v-if="fromBalance !== null" type="button" class="balance_btn" @click="setMax">
                                Balance: {{ fmt(fromBalance, from.decimals) }} {{ from.symbol }}
                            </button>
                        </div>
                        <div class="side_row">
                            <input
                                v-model="amountText"
                                class="amount_input"
                                type="text"
                                inputmode="decimal"
                                placeholder="0.0"
                                autocomplete="off"
                                data-1p-ignore
                                data-lpignore="true"
                                :disabled="busy"
                            />
                            <button type="button" class="max_btn" :disabled="busy || fromBalance === null" @click="setMax">Max</button>
                            <button type="button" class="token_btn" :disabled="busy" @click="openPicker('from')">
                                {{ from.symbol }}
                                <RegistryCheck v-if="!isNativeToken(from)" :address="from.address" :chain-id="43114"></RegistryCheck>
                                <span class="caret">▾</span>
                            </button>
                        </div>
                    </div>

                    <div class="flip_row">
                        <button type="button" class="flip_btn" title="Swap direction" :disabled="busy" @click="flip">↓↑</button>
                    </div>

                    <!-- To -->
                    <div class="side">
                        <div class="side_head">
                            <label>You receive</label>
                            <span v-if="toBalance !== null" class="muted">
                                Balance: {{ fmt(toBalance, to.decimals) }} {{ to.symbol }}
                            </span>
                        </div>
                        <div class="side_row">
                            <input class="amount_input" type="text" :value="quoteOutText" placeholder="0.0" readonly />
                            <button type="button" class="token_btn" :disabled="busy" @click="openPicker('to')">
                                {{ to.symbol }}
                                <RegistryCheck v-if="!isNativeToken(to)" :address="to.address" :chain-id="43114"></RegistryCheck>
                                <span class="caret">▾</span>
                            </button>
                        </div>
                    </div>

                    <!-- Token picker -->
                    <div v-if="picking" class="picker">
                        <input
                            ref="pickerSearch"
                            v-model="search"
                            class="picker_search"
                            type="text"
                            placeholder="Search by name, symbol or address"
                            autocomplete="off"
                            spellcheck="false"
                        />
                        <div class="picker_list">
                            <button
                                v-for="t in pickerTokens"
                                :key="t.address"
                                type="button"
                                class="picker_item"
                                @click="pick(t)"
                            >
                                <span class="picker_symbol">
                                    {{ t.symbol }}
                                    <RegistryCheck v-if="!isNativeToken(t)" :address="t.address" :chain-id="43114"></RegistryCheck>
                                </span>
                                <span class="picker_addr mono">{{ isNativeToken(t) ? 'native' : short(t.address) }}</span>
                            </button>
                            <p v-if="!pickerTokens.length" class="muted center">No tokens match.</p>
                        </div>
                        <button type="button" class="picker_close" @click="picking = null">Close</button>
                    </div>

                    <!-- Options -->
                    <div v-if="kind === 'kyber'" class="options">
                        <label class="check_row">
                            <input v-model="pharaohOnly" type="checkbox" :disabled="busy" />
                            Pharaoh pools only
                        </label>
                        <div class="slippage">
                            <span class="muted">Slippage</span>
                            <button
                                v-for="s in [10, 50, 100]"
                                :key="s"
                                type="button"
                                class="slip_btn"
                                :class="{ active: slippageBps === s }"
                                :disabled="busy"
                                @click="slippageBps = s"
                            >
                                {{ s / 100 }}%
                            </button>
                        </div>
                    </div>

                    <!-- Quote -->
                    <div v-if="quote" class="quote_box">
                        <div class="quote_row">
                            <span>Rate</span>
                            <span>1 {{ quote.from.symbol }} = {{ rateText }} {{ quote.to.symbol }}</span>
                        </div>
                        <div class="quote_row">
                            <span>Route</span>
                            <span>{{ routeText }}</span>
                        </div>
                        <div v-if="quote.kind === 'kyber'" class="quote_row">
                            <span>Minimum received</span>
                            <span>{{ fmt(minReceived, quote.to.decimals) }} {{ quote.to.symbol }}</span>
                        </div>
                        <div v-if="quote.amountOutUsd !== null" class="quote_row">
                            <span>Value</span>
                            <span>{{ usd(quote.amountOutUsd) }}</span>
                        </div>
                        <p v-if="quote.kind !== 'kyber'" class="muted note">
                            {{ quote.kind === 'unwrap' ? 'Unwrapping' : 'Wrapping' }} is exact and 1:1 — no slippage, no
                            fee beyond gas.
                        </p>
                    </div>
                    <p v-else-if="quoting" class="muted center">Getting a quote…</p>

                    <p v-if="error" class="error_msg">{{ error }}</p>

                    <div v-if="result" class="done_box">
                        <p class="done_title"><fa icon="circle-check"></fa> {{ resultText }}</p>
                        <p class="mono tx_hash">{{ result.txHash }}</p>
                        <div class="tx_actions">
                            <CopyText :value="result.txHash" class="tx_copy">Copy transaction hash</CopyText>
                            <a :href="txUrl(result.txHash)" target="_blank" rel="noopener noreferrer" class="panel_link">
                                View on snowtrace.io ↗
                            </a>
                        </div>
                    </div>

                    <SignOnlyToggle :disabled="busy"></SignOnlyToggle>
                    <v-btn class="button_primary swap_btn" depressed block :loading="busy && !swappingAll" :disabled="!canSwap" @click="swap">
                        {{ swapLabel }}
                    </v-btn>
                </section>
            </template>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import axios from 'axios'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { useOfflineSigningStore } from '@/stores'
import { authorizeBatch, SessionAuthCancelled } from '@/js/security/authorize'
import { errorToString } from '@/helpers/helper'
import { toBaseUnits } from '@/js/TokenLauncher'
import { isRegistryToken, verifiedFirst } from '@/helpers/registry_token'
import { PHAR_API, parseTokens } from '@/js/PharAutoVault'
import {
    AVAX_TOKEN,
    PHAR_SWAP_CHAIN_ID,
    WAVAX_TOKEN,
    executeSwap,
    isNative,
    quoteSwap,
    readTokenBalance,
    swapKind,
    type SwapQuote,
    type SwapResult,
    type SwapTokenRef,
} from '@/js/PharSwap'
import CopyText from '@/components/misc/CopyText.vue'
import RegistryCheck from '@/components/misc/RegistryCheck.vue'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'

/** A quote older than this is refetched before it is sent. */
const QUOTE_MAX_AGE_MS = 20_000
const QUOTE_DEBOUNCE_MS = 450
/** Shown first in the picker, in this order, ahead of the rest. */
const FEATURED = ['USDC', 'USDt', 'BTC.b', 'WETH.e', 'PHAR', 'sAVAX']

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back with a stale quote and balances.
    name: 'phar_swap',
    components: { CopyText, RegistryCheck, SignOnlyToggle, SignedTxExport },
    setup() {
        const offline = useOfflineSigningStore()
        const signer = computed(() => activeEvmSigner())

        // Default pair: WAVAX → AVAX, as captured.
        const from = ref<SwapTokenRef>(WAVAX_TOKEN)
        const to = ref<SwapTokenRef>(AVAX_TOKEN)
        const amountText = ref('')
        const pharaohOnly = ref(true)
        const slippageBps = ref(50)

        const fromBalance = ref<BN | null>(null)
        const toBalance = ref<BN | null>(null)
        const wavaxBalance = ref<BN | null>(null)

        const quote = ref<SwapQuote | null>(null)
        let quotedAt = 0
        const quoting = ref(false)
        const busy = ref(false)
        const swappingAll = ref(false)
        const error = ref('')
        const result = ref<SwapResult & { summary: string } | null>(null)

        // ── tokens ──
        const tokenList = ref<SwapTokenRef[]>([AVAX_TOKEN, WAVAX_TOKEN])
        const loadTokens = async () => {
            try {
                const { data } = await axios.get(`${PHAR_API}/tokens`, { timeout: 15_000 })
                const all = Array.from(parseTokens(data).values())
                    .filter((t) => t.symbol && t.address.toLowerCase() !== WAVAX_TOKEN.address.toLowerCase())
                    .map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals }))
                const featured = FEATURED.map((s) => all.find((t) => t.symbol === s)).filter(Boolean) as SwapTokenRef[]
                const rest = all
                    .filter((t) => !featured.includes(t))
                    .sort((a, b) => a.symbol.localeCompare(b.symbol))
                tokenList.value = [AVAX_TOKEN, WAVAX_TOKEN]
                    .concat(featured)
                    .concat(verifiedFirst(rest, (t) => isRegistryToken(t.address, 43114)))
            } catch (e) {
                console.warn('[PharSwap] token list unavailable:', e)
            }
        }
        loadTokens()

        const picking = ref<'from' | 'to' | null>(null)
        const search = ref('')
        const pickerSearch = ref<HTMLInputElement>()
        const pickerTokens = computed(() => {
            const q = search.value.trim().toLowerCase()
            const list = q
                ? tokenList.value.filter(
                      (t) => t.symbol.toLowerCase().includes(q) || t.address.toLowerCase() === q
                  )
                : tokenList.value
            return list.slice(0, 60)
        })
        const openPicker = async (side: 'from' | 'to') => {
            picking.value = side
            search.value = ''
            await nextTick()
            pickerSearch.value?.focus()
        }
        const pick = (t: SwapTokenRef) => {
            const side = picking.value
            picking.value = null
            if (side === 'from') {
                if (t.address === to.value.address) to.value = from.value
                from.value = t
            } else if (side === 'to') {
                if (t.address === from.value.address) from.value = to.value
                to.value = t
            }
        }
        const flip = () => {
            const f = from.value
            from.value = to.value
            to.value = f
            amountText.value = ''
        }

        // ── balances ──
        const wrongChain = computed(() => {
            const s = signer.value
            return s && s.network.evmChainId !== PHAR_SWAP_CHAIN_ID ? s.network.name : ''
        })
        const refreshBalances = async () => {
            const s = signer.value
            if (!s || wrongChain.value) return
            const [fb, tb, wb] = await Promise.all([
                readTokenBalance(s, from.value, s.address).catch(() => null),
                readTokenBalance(s, to.value, s.address).catch(() => null),
                readTokenBalance(s, WAVAX_TOKEN, s.address).catch(() => null),
            ])
            fromBalance.value = fb
            toBalance.value = tb
            wavaxBalance.value = wb
        }
        watch([signer, from, to], refreshBalances, { immediate: true })

        // ── amount & quote ──
        const amountIn = computed((): BN | null => {
            try {
                const bn = toBaseUnits(amountText.value, from.value.decimals)
                return bn.isZero() ? null : bn
            } catch {
                return null
            }
        })
        const kind = computed(() => swapKind(from.value, to.value))

        let timer: ReturnType<typeof setTimeout> | undefined
        let generation = 0
        const requote = async (): Promise<SwapQuote | null> => {
            const amt = amountIn.value
            const mine = ++generation
            quote.value = null
            error.value = ''
            if (!amt) return null
            quoting.value = true
            try {
                const q = await quoteSwap(from.value, to.value, amt, { pharaohOnly: pharaohOnly.value })
                if (mine !== generation) return null
                quote.value = q
                quotedAt = Date.now()
                return q
            } catch (e) {
                if (mine === generation) error.value = errorToString(e)
                return null
            } finally {
                if (mine === generation) quoting.value = false
            }
        }
        watch([amountText, from, to, pharaohOnly], () => {
            result.value = null
            if (timer) clearTimeout(timer)
            timer = setTimeout(requote, QUOTE_DEBOUNCE_MS)
        })
        onBeforeUnmount(() => timer && clearTimeout(timer))

        const setMax = () => {
            const bal = fromBalance.value
            if (!bal) return
            // Leave AVAX for gas when spending native AVAX.
            const reserve = isNative(from.value) ? new BN('50000000000000000') : new BN(0) // 0.05 AVAX
            const spendable = bal.gt(reserve) ? bal.sub(reserve) : new BN(0)
            amountText.value = Big(spendable.toString()).div(Big(10).pow(from.value.decimals)).toFixed()
        }

        const insufficient = computed(() => !!amountIn.value && !!fromBalance.value && amountIn.value.gt(fromBalance.value))
        const canSwap = computed(
            () => !!signer.value && !wrongChain.value && !busy.value && !!quote.value && !insufficient.value
        )
        const canSwapAll = computed(
            () => !!signer.value && !wrongChain.value && !busy.value && !!wavaxBalance.value && !wavaxBalance.value.isZero()
        )
        const swapLabel = computed(() => {
            if (insufficient.value) return `Insufficient ${from.value.symbol}`
            if (kind.value === 'unwrap') return 'Unwrap WAVAX to AVAX'
            if (kind.value === 'wrap') return 'Wrap AVAX to WAVAX'
            return `Swap ${from.value.symbol} to ${to.value.symbol}`
        })

        const run = async (q: SwapQuote) => {
            const s = signer.value
            if (!s) return
            busy.value = true
            error.value = ''
            result.value = null
            try {
                const res = await authorizeBatch(s.authSubject, `Swap ${q.from.symbol} to ${q.to.symbol}`, () =>
                    executeSwap(s, q, slippageBps.value)
                )
                if (!res.offline) {
                    result.value = {
                        ...res,
                        summary: `${fmt(q.amountIn, q.from.decimals)} ${q.from.symbol} → ${fmt(q.amountOut, q.to.decimals)} ${q.to.symbol}`,
                    }
                }
                amountText.value = ''
                await refreshBalances()
            } catch (e) {
                // A dismissed password prompt is not an error — the user backed out.
                if (e instanceof SessionAuthCancelled) return
                error.value = errorToString(e)
            } finally {
                busy.value = false
                swappingAll.value = false
            }
        }

        const swap = async () => {
            if (!canSwap.value || !quote.value) return
            // Market quotes go stale; wrap/unwrap never does.
            let q: SwapQuote | null = quote.value
            if (q.kind === 'kyber' && Date.now() - quotedAt > QUOTE_MAX_AGE_MS) q = await requote()
            if (q) await run(q)
        }

        /** One click: the whole WAVAX balance, unwrapped to AVAX. */
        const swapAllWavax = async () => {
            const bal = wavaxBalance.value
            if (!canSwapAll.value || !bal) return
            swappingAll.value = true
            from.value = WAVAX_TOKEN
            to.value = AVAX_TOKEN
            const q = await quoteSwap(WAVAX_TOKEN, AVAX_TOKEN, bal, { pharaohOnly: true })
            await run(q)
        }

        const onOfflineDone = () => {
            offline.clearRecords()
            refreshBalances()
        }

        // ── formatting ──
        const fmt = (v: BN, d: number) => {
            const x = Number(Big(v.toString()).div(Big(10).pow(d)).toString())
            return x.toLocaleString(undefined, { maximumFractionDigits: x >= 1000 ? 2 : x >= 1 ? 6 : 8 })
        }
        const usd = (x: number) => x.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
        const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
        const txUrl = (hash: string) => `https://snowtrace.io/tx/${hash}`
        const isNativeToken = (t: SwapTokenRef) => isNative(t)
        const quoteOutText = computed(() => (quote.value ? fmt(quote.value.amountOut, quote.value.to.decimals) : ''))
        const rateText = computed(() => {
            const q = quote.value
            if (!q) return ''
            const inn = Big(q.amountIn.toString()).div(Big(10).pow(q.from.decimals))
            const out = Big(q.amountOut.toString()).div(Big(10).pow(q.to.decimals))
            if (inn.eq(0)) return '0'
            return Number(out.div(inn).toString()).toLocaleString(undefined, { maximumSignificantDigits: 6 })
        })
        const routeText = computed(() => (quote.value ? quote.value.exchanges.join(' → ') || '--' : ''))
        const minReceived = computed(() => {
            const q = quote.value
            if (!q) return new BN(0)
            return q.amountOut.mul(new BN(10_000 - slippageBps.value)).div(new BN(10_000))
        })
        const resultText = computed(() => (result.value ? `Swapped ${result.value.summary}` : ''))

        return {
            offline,
            signer,
            from,
            to,
            amountText,
            pharaohOnly,
            slippageBps,
            fromBalance,
            toBalance,
            wavaxBalance,
            quote,
            quoting,
            busy,
            swappingAll,
            error,
            result,
            picking,
            search,
            pickerSearch,
            pickerTokens,
            openPicker,
            pick,
            flip,
            wrongChain,
            kind,
            setMax,
            canSwap,
            canSwapAll,
            swapLabel,
            swap,
            swapAllWavax,
            onOfflineDone,
            fmt,
            usd,
            short,
            txUrl,
            isNativeToken,
            quoteOutText,
            rateText,
            routeText,
            minReceived,
            resultText,
        }
    },
})
</script>

<style lang="scss" scoped>
.phar_swap {
    max-width: 520px;
    margin: 0 auto;
    color: var(--primary-color);
}

.head {
    text-align: center;
    margin-bottom: 20px;

    h1 {
        font-weight: normal;
    }

    .desc {
        color: var(--primary-color-light);
        font-size: 0.9em;
        line-height: 1.5;
        margin-top: 4px !important;
    }
}

.swap_all {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: var(--bg-light);
    border: 1px solid var(--secondary-color);
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 14px;

    .swap_all_title {
        font-weight: 700;
    }
}

.swap_card {
    background: var(--bg-light);
    border-radius: 14px;
    padding: 18px;
    position: relative;
}

.side {
    background: var(--bg);
    border-radius: 10px;
    padding: 12px 14px;
}

.side_head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }
}

.balance_btn {
    font-size: 12px;
    color: var(--primary-color-light);

    &:hover {
        color: var(--secondary-color);
    }
}

.side_row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.amount_input {
    flex: 1;
    min-width: 0;
    font-size: 22px;
    background: transparent;
    color: var(--primary-color);
    border: none;
    outline: none;
}

.max_btn {
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-color);
    padding: 4px 6px;
}

.token_btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-weight: 700;
    font-size: 15px;
    padding: 6px 10px;
    border-radius: 18px;
    background: var(--bg-light);
    color: var(--primary-color);
    white-space: nowrap;

    .caret {
        font-size: 11px;
        opacity: 0.7;
    }
}

.flip_row {
    display: flex;
    justify-content: center;
    margin: -6px 0;
    position: relative;
    z-index: 1;
}

.flip_btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--bg-light);
    border: 3px solid var(--bg);
    color: var(--primary-color);
    font-size: 13px;
}

.picker {
    position: absolute;
    inset: 0;
    z-index: 5;
    background: var(--bg-light);
    border-radius: 14px;
    padding: 14px;
    display: flex;
    flex-direction: column;
}

.picker_search {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg);
    color: var(--primary-color);
    border: 1px solid var(--bg);
    margin-bottom: 8px;
}

.picker_list {
    flex: 1;
    overflow-y: auto;
}

.picker_item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 9px 10px;
    border-radius: 8px;
    color: var(--primary-color);

    &:hover {
        background: var(--bg);
    }

    .picker_symbol {
        font-weight: 600;
    }

    .picker_addr {
        font-size: 11px;
        color: var(--primary-color-light);
    }
}

.picker_close {
    margin-top: 8px;
    color: var(--secondary-color);
    font-size: 13px;
}

.options {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 2px 4px;
    font-size: 13px;
}

.check_row {
    display: flex;
    align-items: center;
    gap: 6px;
}

.slippage {
    display: flex;
    align-items: center;
    gap: 6px;
}

.slip_btn {
    padding: 2px 8px;
    border-radius: 10px;
    border: 1px solid var(--bg);
    color: var(--primary-color-light);
    font-size: 12px;

    &.active {
        background: var(--bg);
        color: var(--primary-color);
        font-weight: 600;
    }
}

.quote_box {
    margin-top: 12px;
    padding: 10px 14px;
    background: var(--bg);
    border-radius: 10px;
    font-size: 13px;
}

.quote_row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;

    span:first-child {
        color: var(--primary-color-light);
    }

    span:last-child {
        text-align: right;
        word-break: break-word;
    }
}

.done_box {
    margin-top: 12px;
    border: 1px solid var(--success);
    background: rgba(107, 198, 136, 0.08);
    border-radius: 10px;
    padding: 12px 14px;

    .done_title {
        color: var(--success);
        font-weight: 700;
    }

    .tx_hash {
        font-size: 12px;
        word-break: break-all;
        color: var(--primary-color-light);
        margin-top: 4px !important;
    }
}

.tx_actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 6px;
    font-size: 13px;
}

.panel_link {
    color: var(--secondary-color) !important;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
    }
}

.swap_btn {
    margin-top: 12px;
}

.mono {
    font-family: monospace;
}

.muted {
    color: var(--primary-color-light);
    font-size: 13px;
}

.note {
    margin-top: 6px !important;
}

.center {
    text-align: center;
    padding: 10px 0;
}

.error_msg {
    color: var(--error);
    font-size: 13px;
    margin: 10px 0 !important;
    word-break: break-word;
}
</style>
