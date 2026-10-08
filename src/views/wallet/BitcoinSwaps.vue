<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Bitcoin Swaps: AVAX ↔ BTC.b on C-Chain, BTC ↔ BTC.b through Lombard (the
  Avalanche Bridge for Bitcoin), and Quick Bitcoin Swap chaining them — AVAX
  straight to BTC on the Bitcoin network and back. See src/bitcoinSwap for how
  each step is built and why. Every action is a premium action behind the
  Moats burn gate; estimates are open to everyone.
-->
<template>
    <div class="btc_swaps">
        <div class="head">
            <h1>Bitcoin Swaps</h1>
            <p class="desc">
                Move between AVAX on Avalanche C-Chain and BTC on the Bitcoin network. BTC ↔ BTC.b goes through the
                Avalanche Bridge for Bitcoin (run by Lombard); AVAX ↔ BTC.b is a swap on C-Chain.
            </p>
        </div>

        <div class="tabs" role="tablist">
            <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="tab === t.id" :class="{ on: tab === t.id }" @click="selectTab(t.id)">
                {{ t.label }}
            </button>
        </div>

        <!-- Wallets -->
        <section class="wallets">
            <div :class="{ missing: !signer }">
                <strong>Avalanche C-Chain:</strong>
                <span v-if="signer" class="mono">{{ signer.address }}</span>
                <span v-else>{{ signerHint }}</span>
                <span v-if="signer" class="muted">· {{ fmtNum(avaxBalance, 4) }} AVAX · {{ fmtNum(btcbBalanceView, 8) }} BTC.b</span>
            </div>
            <div v-if="needsBitcoin" :class="{ missing: !btcWallet }">
                <strong>Bitcoin:</strong>
                <span v-if="btcWallet" class="mono">{{ btcWallet.getReceiveAddress() }}</span>
                <span v-else>Connect a Bitcoin wallet that can sign.</span>
                <span v-if="btcWallet" class="muted">· {{ fmtNum(btcBalance, 8) }} BTC</span>
            </div>
        </section>

        <section class="card">
            <p class="what">{{ explain }}</p>
            <label class="sub_label" for="btcswap-amount">You send ({{ inputSymbol }})</label>
            <div class="amount_row">
                <input id="btcswap-amount" v-model="amountText" class="field amount" inputmode="decimal" placeholder="0.0" />
                <button v-if="maxValue !== null" type="button" class="max_btn" @click="setMax">MAX</button>
            </div>
            <p v-if="amountError" class="form_error">{{ amountError }}</p>

            <template v-if="needsBtcDestination">
                <label class="sub_label" for="btcswap-dest">Bitcoin address to receive at</label>
                <input id="btcswap-dest" v-model.trim="btcDest" class="field mono" spellcheck="false" autocomplete="off" />
                <p v-if="btcDestError" class="form_error">{{ btcDestError }}</p>
            </template>

            <div class="estimate">
                <p v-if="estimating" class="muted">Estimating…</p>
                <template v-else-if="estimate">
                    <p>
                        You receive about <strong>{{ estimate.out }}</strong>
                        <span v-if="estimate.min" class="muted">(at least {{ estimate.min }})</span>
                    </p>
                    <ul class="notes">
                        <li v-for="(n, i) in estimate.notes" :key="i">{{ n }}</li>
                    </ul>
                </template>
                <p v-if="estimateError" class="form_error">{{ estimateError }}</p>
            </div>

            <v-btn class="button_primary go" depressed block :loading="busy" :disabled="!canRun || isBlocked" @click="gatedAction(run)">
                {{ actionLabel }}
            </v-btn>
            <p v-if="error" class="form_error">{{ error }}</p>
            <p v-if="offlineOn" class="form_error">Offline signing is on — every step must be broadcast. Turn it off to swap.</p>
        </section>

        <!-- History -->
        <section v-if="history.length" class="history">
            <div class="history_head">
                <h3>Your Bitcoin swaps</h3>
                <button type="button" class="link_btn" :disabled="refreshing" @click="refreshAll">{{ refreshing ? 'Refreshing…' : 'Refresh' }}</button>
            </div>
            <div v-for="r in history" :key="r.id" class="swap">
                <div class="swap_head">
                    <span><strong>{{ kindLabel(r.kind) }}</strong> · {{ r.amountIn }} {{ r.symbolIn }}</span>
                    <span class="status" :class="r.status">{{ statusLabel(r.status) }}</span>
                </div>
                <p class="muted small">{{ when(r.createdAt) }}<span v-if="r.detail"> · {{ r.detail }}</span></p>
                <ul class="steps">
                    <li v-for="(s, i) in r.steps" :key="i">
                        {{ s.label }}
                        <a v-if="s.txHash" :href="txUrl(s)" target="_blank" rel="noopener noreferrer" class="mono">{{ short(s.txHash) }} ↗</a>
                    </li>
                </ul>
                <div class="swap_actions">
                    <v-btn
                        v-if="r.status === 'ready' && r.kind === 'quick-btc-avax'"
                        class="button_primary"
                        depressed
                        x-small
                        :loading="continuing === r.id"
                        :disabled="!signer || isBlocked || continuing !== ''"
                        @click="gatedAction(() => continueSwap(r))"
                    >
                        Swap BTC.b to AVAX (step 2)
                    </v-btn>
                    <button v-if="r.status !== 'running' && r.status !== 'waiting' && r.status !== 'ready'" type="button" class="link_btn muted" @click="remove(r)">Remove</button>
                </div>
            </div>
        </section>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

import { getBridgeChain } from '@/bridge/chains'
import { walletSigners } from '@/bridge/signers'
import { getPlatform } from '@/platforms'
import { BitcoinWallet } from '@/platforms/bitcoin/wallet'
import { useOfflineSigningStore } from '@/stores'
import { isValidBitcoinAddress } from '@/bitcoin/keys'
import { getBitcoinTxUrl } from '@/bitcoin/networks'
import { SessionAuthCancelled } from '@/js/security/authorize'
import { errorToString } from '@/helpers/helper'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import { MIN_DEPOSIT_SATS, btcbBalance, redeemConfig } from '@/bitcoinSwap/lombard'
import {
    KIND_LABELS,
    btcSwaps,
    continueQuickBtcToAvax,
    minOut,
    quoteAvaxToBtcb,
    quoteBtcbToAvax,
    refreshSwap,
    removeSwap,
    runAvaxToBtcb,
    runBtcToBtcb,
    runBtcbToAvax,
    runBtcbToBtc,
    runQuickAvaxToBtc,
    runQuickBtcToAvax,
    type BtcSwapKind,
    type BtcSwapRecord,
    type BtcSwapStep,
} from '@/bitcoinSwap/flows'
import type { EvmSigner } from '@/evm/signer'

const TABS: { id: BtcSwapKind; label: string }[] = [
    { id: 'quick-avax-btc', label: 'Quick AVAX → BTC' },
    { id: 'quick-btc-avax', label: 'Quick BTC → AVAX' },
    { id: 'avax-btcb', label: 'AVAX → BTC.b' },
    { id: 'btcb-avax', label: 'BTC.b → AVAX' },
    { id: 'btc-btcb', label: 'BTC → BTC.b' },
    { id: 'btcb-btc', label: 'BTC.b → BTC' },
]

const EXPLAIN: Record<BtcSwapKind, string> = {
    'quick-avax-btc': 'Swaps your AVAX to BTC.b on C-Chain, then sends exactly the BTC.b received through the Avalanche Bridge for Bitcoin to your Bitcoin address. Two steps, run one after the other.',
    'quick-btc-avax': 'Sends your BTC through the Avalanche Bridge for Bitcoin to BTC.b on C-Chain (about an hour), then — once it arrives — swaps it to AVAX. The second step needs one more click below.',
    'avax-btcb': 'Swaps AVAX for BTC.b on Avalanche C-Chain, at the best rate KyberSwap finds.',
    'btcb-avax': 'Swaps BTC.b for AVAX on Avalanche C-Chain, at the best rate KyberSwap finds.',
    'btc-btcb': 'Sends BTC from your Bitcoin wallet through the Avalanche Bridge for Bitcoin (Lombard). BTC.b arrives 1:1 on your C-Chain address after about an hour. Minimum 0.0002 BTC.',
    'btcb-btc': 'Sends BTC.b through the Avalanche Bridge for Bitcoin (Lombard) and receives BTC at any Bitcoin address, minus Lombard’s fee.',
}

const INPUT_DECIMALS: Record<BtcSwapKind, number> = {
    'quick-avax-btc': 18,
    'quick-btc-avax': 8,
    'avax-btcb': 18,
    'btcb-avax': 8,
    'btc-btcb': 8,
    'btcb-btc': 8,
}

function parseUnits(text: string, decimals: number): bigint | null {
    const t = text.trim()
    if (!/^\d*\.?\d*$/.test(t) || !t || t === '.') return null
    const [w, f = ''] = t.split('.')
    if (f.length > decimals) return null
    const v = BigInt((w || '0') + f.padEnd(decimals, '0'))
    return v > BigInt(0) ? v : null
}
const units = (v: bigint, decimals: number) => Number(v) / 10 ** decimals

export default defineComponent({
    // Excluded from keep-alive in Wallet.vue: balances and estimates must be fresh.
    name: 'bitcoin_swaps',
    setup() {
        const { isBlocked, gatedAction } = useBaseAssetGate()
        const offline = useOfflineSigningStore()
        const offlineOn = computed(() => offline.isActive)

        const tabs = TABS
        const tab = ref<BtcSwapKind>('quick-avax-btc')
        const explain = computed(() => EXPLAIN[tab.value])
        const inputSymbol = computed(() => KIND_LABELS[tab.value].replace('Quick swap ', '').split(' → ')[0])
        const needsBitcoin = computed(() => tab.value !== 'avax-btcb' && tab.value !== 'btcb-avax')
        const needsBtcDestination = computed(() => tab.value === 'btcb-btc' || tab.value === 'quick-avax-btc')
        const sendsBitcoin = computed(() => tab.value === 'btc-btcb' || tab.value === 'quick-btc-avax')

        // ── wallets ──
        const cchain = getBridgeChain('evm:43114')
        const signer = ref<EvmSigner | null>(null)
        const btcWallet = ref<BitcoinWallet | null>(null)
        const readWallets = () => {
            signer.value = cchain ? walletSigners.evm(cchain) : null
            const w = getPlatform('bitcoin')?.getActiveWallet()
            btcWallet.value = w instanceof BitcoinWallet && !w.isReadonly && w.network.id === 'mainnet' ? w : null
        }
        readWallets()
        const signerHint = 'Open the Avalanche tab, or point the EVM wallet at Avalanche C-Chain.'

        const avaxBalance = ref<bigint | null>(null)
        const btcbBalanceView = ref<bigint | null>(null)
        const btcBalance = ref<bigint | null>(null)
        const loadBalances = async () => {
            readWallets()
            const s = signer.value
            if (s) {
                try {
                    const [a, b] = await Promise.all([s.reader().eth.getBalance(s.address), btcbBalance(s.reader(), s.address)])
                    avaxBalance.value = BigInt(a.toString())
                    btcbBalanceView.value = b
                } catch (e) {
                    console.warn('[BitcoinSwaps] balances unavailable:', e)
                }
            }
            const w = btcWallet.value
            if (w) {
                try {
                    await w.refresh()
                    btcBalance.value = BigInt(w.balanceSats)
                } catch (e) {
                    console.warn('[BitcoinSwaps] BTC balance unavailable:', e)
                }
            }
        }

        // ── form ──
        const amountText = ref('')
        const btcDest = ref('')
        const decimals = computed(() => INPUT_DECIMALS[tab.value])
        const amount = computed(() => parseUnits(amountText.value, decimals.value))
        const maxValue = computed<bigint | null>(() => {
            if (inputSymbol.value === 'AVAX') return avaxBalance.value === null ? null : avaxBalance.value > BigInt('50000000000000000') ? avaxBalance.value - BigInt('50000000000000000') : BigInt(0)
            if (inputSymbol.value === 'BTC.b') return btcbBalanceView.value
            return btcBalance.value === null ? null : btcBalance.value > BigInt(3000) ? btcBalance.value - BigInt(3000) : BigInt(0)
        })
        const setMax = () => {
            if (maxValue.value === null) return
            amountText.value = maxValue.value > BigInt(0) ? String(units(maxValue.value, decimals.value)) : ''
        }
        const amountError = computed(() => {
            if (!amountText.value) return ''
            if (amount.value === null) return `Enter an amount with at most ${decimals.value} decimals.`
            if (maxValue.value !== null && inputSymbol.value !== 'AVAX' && amount.value > maxValue.value) return `More than your ${inputSymbol.value} balance.`
            if (sendsBitcoin.value && amount.value < BigInt(MIN_DEPOSIT_SATS)) return `The minimum is ${MIN_DEPOSIT_SATS / 1e8} BTC.`
            return ''
        })
        const btcDestError = computed(() => {
            if (!needsBtcDestination.value) return ''
            const w = btcWallet.value
            if (!btcDest.value) return 'Enter the Bitcoin address to receive at.'
            if (w && !isValidBitcoinAddress(btcDest.value, w.network)) return 'Not a valid Bitcoin address.'
            return ''
        })
        const selectTab = (id: BtcSwapKind) => {
            tab.value = id
            amountText.value = ''
            error.value = ''
        }
        watch(btcWallet, (w) => {
            if (w && !btcDest.value) btcDest.value = w.getReceiveAddress()
        }, { immediate: true })

        // ── estimate ──
        const estimate = ref<{ out: string; min?: string; notes: string[] } | null>(null)
        const estimating = ref(false)
        const estimateError = ref('')
        let timer: ReturnType<typeof setTimeout> | null = null
        let seq = 0
        const runEstimate = async () => {
            const a = amount.value
            const s = ++seq
            estimate.value = null
            estimateError.value = ''
            if (a === null) return
            estimating.value = true
            try {
                const k = tab.value
                let out: { out: string; min?: string; notes: string[] }
                if (k === 'avax-btcb' || k === 'quick-avax-btc') {
                    const q = await quoteAvaxToBtcb(a)
                    const b = BigInt(q.amountOut.toString())
                    if (k === 'avax-btcb') {
                        out = { out: `${units(b, 8)} BTC.b`, min: `${units(minOut(q), 8)} BTC.b`, notes: ['Slippage limit 0.5%.'] }
                    } else {
                        const cfg = signer.value ? await redeemConfig(signer.value.reader()) : { commissionSats: 10_000, minSats: 3_300, enabled: true }
                        const btc = b - BigInt(cfg.commissionSats)
                        out = {
                            out: `${units(btc > BigInt(0) ? btc : BigInt(0), 8)} BTC`,
                            notes: [
                                `Step 1: ${units(b, 8)} BTC.b from the AVAX swap (0.5% slippage limit).`,
                                `Step 2: Lombard pays BTC minus its ${cfg.commissionSats / 1e8} BTC fee; the smallest redeem is ${(cfg.commissionSats + cfg.minSats) / 1e8} BTC.`,
                                cfg.enabled ? 'BTC usually arrives within a few hours.' : 'Lombard has paused redemptions right now.',
                            ],
                        }
                    }
                } else if (k === 'btcb-avax' || k === 'quick-btc-avax') {
                    const q = await quoteBtcbToAvax(a)
                    const avax = units(BigInt(q.amountOut.toString()), 18)
                    out =
                        k === 'btcb-avax'
                            ? { out: `${avax} AVAX`, min: `${units(minOut(q), 18)} AVAX`, notes: ['Slippage limit 0.5%.'] }
                            : {
                                  out: `${avax} AVAX`,
                                  notes: [
                                      `Step 1: ${units(a, 8)} BTC → ${units(a, 8)} BTC.b through Lombard (1:1, about an hour; plus your Bitcoin network fee).`,
                                      'Step 2: the BTC.b is swapped to AVAX at the rate when you continue — this estimate uses today’s rate.',
                                  ],
                              }
                } else if (k === 'btc-btcb') {
                    out = { out: `${units(a, 8)} BTC.b`, notes: ['Lombard mints 1:1, about an hour after your Bitcoin payment confirms. Your Bitcoin network fee is paid on top.'] }
                } else {
                    const cfg = signer.value ? await redeemConfig(signer.value.reader()) : { commissionSats: 10_000, minSats: 3_300, enabled: true }
                    const btc = a - BigInt(cfg.commissionSats)
                    out = {
                        out: `${units(btc > BigInt(0) ? btc : BigInt(0), 8)} BTC`,
                        notes: [`Lombard’s fee: ${cfg.commissionSats / 1e8} BTC. Smallest redeem: ${(cfg.commissionSats + cfg.minSats) / 1e8} BTC.`],
                    }
                }
                if (s === seq) estimate.value = out
            } catch (e) {
                if (s === seq) estimateError.value = errorToString(e)
            } finally {
                if (s === seq) estimating.value = false
            }
        }
        watch([amount, tab], () => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(runEstimate, 500)
        })

        // ── run ──
        const busy = ref(false)
        const error = ref('')
        const canRun = computed(() => {
            if (busy.value || offlineOn.value || amount.value === null || amountError.value) return false
            if (!signer.value) return false
            if (needsBitcoin.value && !btcWallet.value) return false
            if (needsBtcDestination.value && btcDestError.value) return false
            return true
        })
        const actionLabel = computed(() => (tab.value.startsWith('quick') ? `Quick swap ${KIND_LABELS[tab.value].replace('Quick swap ', '')}` : `Swap ${KIND_LABELS[tab.value]}`))
        const run = async () => {
            if (!canRun.value || !signer.value || amount.value === null) return
            busy.value = true
            error.value = ''
            const s = signer.value
            const a = amount.value
            const w = btcWallet.value
            try {
                switch (tab.value) {
                    case 'avax-btcb':
                        await runAvaxToBtcb(s, a)
                        break
                    case 'btcb-avax':
                        await runBtcbToAvax(s, a)
                        break
                    case 'btc-btcb':
                        await runBtcToBtcb(s, w as BitcoinWallet, a)
                        break
                    case 'btcb-btc':
                        await runBtcbToBtc(s, w, a, btcDest.value)
                        break
                    case 'quick-avax-btc':
                        await runQuickAvaxToBtc(s, w, a, btcDest.value)
                        break
                    case 'quick-btc-avax':
                        await runQuickBtcToAvax(s, w as BitcoinWallet, a)
                        break
                }
                amountText.value = ''
                loadBalances()
            } catch (e) {
                if (e instanceof SessionAuthCancelled) return
                error.value = errorToString(e)
            } finally {
                busy.value = false
            }
        }

        // ── history ──
        const history = computed(() => btcSwaps.value)
        const refreshing = ref(false)
        const continuing = ref('')
        const refreshAll = async () => {
            refreshing.value = true
            try {
                await Promise.allSettled(btcSwaps.value.filter((r) => r.status === 'waiting').map((r) => refreshSwap(r)))
            } finally {
                refreshing.value = false
            }
        }
        const continueSwap = async (r: BtcSwapRecord) => {
            if (!signer.value) return
            continuing.value = r.id
            error.value = ''
            try {
                await continueQuickBtcToAvax(signer.value, r)
                loadBalances()
            } catch (e) {
                if (!(e instanceof SessionAuthCancelled)) error.value = errorToString(e)
            } finally {
                continuing.value = ''
            }
        }
        const remove = (r: BtcSwapRecord) => removeSwap(r.id)

        let poll: ReturnType<typeof setInterval> | null = null
        onMounted(() => {
            loadBalances()
            refreshAll()
            poll = setInterval(() => {
                if (btcSwaps.value.some((r) => r.status === 'waiting')) refreshAll()
            }, 60_000)
        })
        onBeforeUnmount(() => {
            if (poll) clearInterval(poll)
            if (timer) clearTimeout(timer)
        })

        // ── display ──
        const fmtNum = (v: bigint | null, d: number) => (v === null ? '…' : units(v, d).toLocaleString(undefined, { maximumFractionDigits: d === 18 ? 4 : 8 }))
        const short = (h: string) => (h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h)
        const kindLabel = (k: BtcSwapKind) => KIND_LABELS[k]
        const statusLabel = (s: string) => ({ running: 'Running', waiting: 'In progress', ready: 'Ready for step 2', done: 'Done', failed: 'Failed' }[s] ?? s)
        const when = (ms: number) => new Date(ms).toLocaleString()
        const txUrl = (s: BtcSwapStep) => {
            if (s.chain === 'avalanche') return `https://snowtrace.io/tx/${s.txHash}`
            const w = btcWallet.value
            return w ? getBitcoinTxUrl(String(s.txHash), w.network) : `https://mempool.space/tx/${s.txHash}`
        }

        return {
            isBlocked,
            gatedAction,
            offlineOn,
            tabs,
            tab,
            selectTab,
            explain,
            inputSymbol,
            needsBitcoin,
            needsBtcDestination,
            signer,
            btcWallet,
            signerHint,
            avaxBalance,
            btcbBalanceView,
            btcBalance,
            amountText,
            amountError,
            maxValue,
            setMax,
            btcDest,
            btcDestError,
            estimate,
            estimating,
            estimateError,
            busy,
            error,
            canRun,
            actionLabel,
            run,
            history,
            refreshing,
            refreshAll,
            continuing,
            continueSwap,
            remove,
            fmtNum,
            short,
            kindLabel,
            statusLabel,
            when,
            txUrl,
        }
    },
})
</script>

<style lang="scss" scoped>
.btc_swaps {
    max-width: 640px;
    margin: 0 auto;
    color: var(--primary-color);
}

.head {
    text-align: center;
    margin-bottom: 16px;

    h1 {
        font-weight: normal;
    }

    .desc {
        color: var(--primary-color-light);
        font-size: 0.9em;
        line-height: 1.5;
    }
}

.tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-bottom: 12px;

    button {
        padding: 6px 12px;
        border-radius: 16px;
        font-size: 13px;
        background: var(--bg-light);
        color: var(--primary-color-light);

        &.on {
            background: var(--secondary-color);
            color: #fff;
        }
    }
}

.wallets {
    font-size: 13px;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-all;

    .missing {
        color: var(--error);
    }
}

.card {
    background: var(--bg-light);
    border-radius: 14px;
    padding: 18px;
}

.what {
    font-size: 13px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin-bottom: 10px !important;
}

.sub_label {
    display: block;
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 10px 0 4px;
}

.field {
    width: 100%;
    padding: 9px 12px;
    border-radius: 8px;
    background: var(--bg);
    color: var(--primary-color);
    border: 1px solid transparent;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.amount_row {
    display: flex;
    gap: 8px;
    align-items: center;

    .amount {
        font-size: 20px;
    }
}

.max_btn {
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-color);
}

.estimate {
    margin: 14px 0;
    font-size: 14px;

    .notes {
        margin: 6px 0 0;
        padding-left: 18px;
        font-size: 12px;
        color: var(--primary-color-light);
    }
}

.go {
    margin-top: 6px;
}

.history {
    margin-top: 24px;
}

.history_head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;

    h3 {
        font-weight: normal;
    }
}

.swap {
    background: var(--bg-light);
    border-radius: 10px;
    padding: 10px 14px;
    margin-top: 8px;
}

.swap_head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
}

.status {
    font-size: 12px;
    font-weight: 600;

    &.done {
        color: var(--success);
    }

    &.failed {
        color: var(--error);
    }

    &.ready {
        color: var(--secondary-color);
    }
}

.steps {
    margin: 6px 0;
    padding-left: 18px;
    font-size: 12px;
    word-break: break-all;
}

.swap_actions {
    display: flex;
    gap: 12px;
    align-items: center;
}

.link_btn {
    font-size: 12px;
    color: var(--secondary-color);
}

.mono {
    font-family: monospace;
}

.muted {
    color: var(--primary-color-light);
}

.small {
    font-size: 12px;
}

.form_error {
    color: var(--error);
    font-size: 13px;
    margin-top: 6px !important;
}
</style>
