<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="swap_page">
        <h1>Swap</h1>
        <p class="desc">
            Swap tokens on the Avalanche C-Chain. Routing is powered by the ArenaTrade / Odos
            aggregator for best-price execution across on-chain liquidity. Quotes and the
            executable transaction are fetched via API; signing and broadcasting happen locally
            with your active wallet.
        </p>

        <div class="card">
            <!-- ── From ── -->
            <div class="token_block">
                <div class="token_head">
                    <label>You pay</label>
                    <span v-if="tokenIn" class="balance">
                        Balance: {{ balanceOf(tokenIn) }} {{ tokenIn.symbol }}
                    </span>
                </div>
                <div class="token_row">
                    <input
                        v-model="amountIn"
                        type="text"
                        class="amount_input"
                        placeholder="0.0"
                        :disabled="isBusy"
                        @input="onAmountChange"
                    />
                    <select v-model="tokenInAddr" class="token_select" :disabled="isBusy">
                        <option v-if="!heldTokens.length" :value="''" disabled>
                            No tokens held
                        </option>
                        <option v-for="t in heldTokens" :key="'in-' + t.address" :value="t.address">
                            {{ t.symbol }}
                        </option>
                    </select>
                </div>
            </div>

            <div class="switch_row">
                <span class="switch_arrow">↓</span>
            </div>

            <!-- ── To ── -->
            <div class="token_block">
                <div class="token_head">
                    <label>You receive (estimated)</label>
                    <span v-if="tokenOut" class="balance">
                        {{ tokenOut.symbol }} · {{ tokenOut.decimals }} decimals
                    </span>
                </div>
                <div class="token_row">
                    <input
                        :value="estimatedOut"
                        type="text"
                        class="amount_input"
                        placeholder="0.0"
                        readonly
                    />
                </div>
                <div class="token_row target_row">
                    <input
                        v-model="tokenOutAddr"
                        type="text"
                        class="address_input"
                        placeholder="Token address (0x…) or symbol (e.g. USDC)"
                        spellcheck="false"
                        :disabled="isBusy"
                        @input="onTargetChange"
                    />
                    <span v-if="isResolving" class="resolve_state">Resolving…</span>
                    <span v-else-if="tokenOut" class="resolve_state ok">✓ {{ tokenOut.symbol }}</span>
                    <span v-else-if="targetError" class="resolve_state err">{{ targetError }}</span>
                </div>
            </div>

            <!-- ── Slippage ── -->
            <div class="slippage_row">
                <label>Slippage tolerance</label>
                <div class="slippage_options">
                    <button
                        v-for="s in [0.5, 1, 2]"
                        :key="s"
                        type="button"
                        class="slip_btn"
                        :class="{ active: slippage === s }"
                        :disabled="isBusy"
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
                        :disabled="isBusy"
                    />
                </div>
            </div>

            <button
                type="button"
                class="action_btn"
                :disabled="!canQuote || isBusy"
                @click="fetchQuote"
            >
                <span v-if="isQuoting">Fetching quote…</span>
                <span v-else>Get Quote</span>
            </button>

            <!-- ── Quote summary ── -->
            <div v-if="quote" class="quote_box">
                <div class="quote_row">
                    <span>Rate</span>
                    <span>1 {{ tokenIn.symbol }} ≈ {{ rate }} {{ tokenOut.symbol }}</span>
                </div>
                <div class="quote_row">
                    <span>Value</span>
                    <span>${{ fmtUsd(quote.inValues[0]) }} → ${{ fmtUsd(quote.outValues[0]) }}</span>
                </div>
                <div class="quote_row" v-if="quote.priceImpact !== null">
                    <span>Price impact</span>
                    <span :class="{ warn: (quote.priceImpact || 0) < -3 }">
                        {{ (quote.priceImpact || 0).toFixed(2) }}%
                    </span>
                </div>
                <div class="quote_row">
                    <span>Min. received</span>
                    <span>{{ minReceived }} {{ tokenOut.symbol }}</span>
                </div>

                <button
                    type="button"
                    class="action_btn swap_confirm"
                    :disabled="isBusy"
                    @click="doSwap"
                >
                    <span v-if="isApproving">Approving {{ tokenIn.symbol }}…</span>
                    <span v-else-if="isSwapping">Swapping…</span>
                    <span v-else>Swap</span>
                </button>
                <p v-if="statusMsg" class="info_msg">{{ statusMsg }}</p>
            </div>
        </div>

        <!-- ── Result ── -->
        <div v-if="resultTx" class="card result_card">
            <h2>✅ Swap Submitted</h2>
            <div class="result_row">
                <span class="result_label">Tx Hash</span>
                <span class="result_value mono">{{ resultTx }}</span>
            </div>
            <a class="explorer_link" :href="explorerUrl" target="_blank" rel="noopener noreferrer">
                View on Snowtrace ↗
            </a>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
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
    OdosQuote,
} from '@/js/ArenaSwap'
import { AvaWalletCore } from '@/js/wallets/types'

const NATIVE_AVAX: SwapToken = {
    address: NATIVE_TOKEN_ADDRESS,
    symbol: 'AVAX',
    name: 'Avalanche',
    decimals: 18,
}

export default defineComponent({
    name: 'Swap',
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const wallet = computed(() => mainStore.activeWallet as AvaWalletCore | null)

        // Source list: ONLY tokens the wallet currently holds (native AVAX +
        // any ERC20 with a positive balance).
        const heldTokens = computed<SwapToken[]>(() => {
            const out: SwapToken[] = []
            if ((wallet.value?.ethBalance || new BN(0)).gt(new BN(0))) {
                out.push(NATIVE_AVAX)
            }
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

        const tokenInAddr = ref('')
        const tokenOutAddr = ref('')
        const amountIn = ref('')
        const slippage = ref(0.5)

        const quote = ref<OdosQuote | null>(null)
        const isQuoting = ref(false)
        const isApproving = ref(false)
        const isSwapping = ref(false)
        const statusMsg = ref('')
        const resultTx = ref('')
        const evmChainId = ref(43114)

        // Target token is a free-text address, resolved on-chain to metadata.
        const tokenOut = ref<SwapToken | null>(null)
        const isResolving = ref(false)
        const targetError = ref('')
        let resolveTimer: ReturnType<typeof setTimeout> | undefined

        const tokenIn = computed(
            () => heldTokens.value.find((t) => t.address === tokenInAddr.value) || null
        )

        const isBusy = computed(() => isQuoting.value || isApproving.value || isSwapping.value)

        const canQuote = computed(() => {
            return (
                !!wallet.value &&
                !!tokenIn.value &&
                !!tokenOut.value &&
                tokenInAddr.value.toLowerCase() !== (tokenOut.value?.address || '').toLowerCase() &&
                /^\d*\.?\d+$/.test(amountIn.value.trim()) &&
                parseFloat(amountIn.value) > 0
            )
        })

        const balanceOf = (t: SwapToken): string => {
            if (isNativeToken(t.address)) {
                const bal = wallet.value?.ethBalance || new BN(0)
                return bnToBig(bal, 18).toFixed(4)
            }
            const found = [
                ...(assetsStore.erc20Tokens || []),
                ...(assetsStore.erc20TokensCustom || []),
            ].find((e: any) => e.data.address.toLowerCase() === t.address.toLowerCase())
            return found ? (found as any).balanceBig.toFixed(4) : '0'
        }

        const estimatedOut = computed(() => {
            if (!quote.value || !tokenOut.value) return ''
            return bnToBig(new BN(quote.value.outAmounts[0]), tokenOut.value.decimals).toFixed(6)
        })

        const rate = computed(() => {
            if (!quote.value || !tokenOut.value) return '0'
            const outBig = bnToBig(new BN(quote.value.outAmounts[0]), tokenOut.value.decimals)
            const inNum = parseFloat(amountIn.value) || 1
            return outBig.div(inNum).toFixed(6)
        })

        const minReceived = computed(() => {
            if (!quote.value || !tokenOut.value) return '0'
            const outBig = bnToBig(new BN(quote.value.outAmounts[0]), tokenOut.value.decimals)
            return outBig.times(1 - slippage.value / 100).toFixed(6)
        })

        const explorerUrl = computed(() =>
            resultTx.value ? cChainExplorerTxUrl(resultTx.value, evmChainId.value) : ''
        )

        const fmtUsd = (v: number) => (v || 0).toFixed(2)

        const onAmountChange = () => {
            // A fresh amount invalidates the previous quote.
            quote.value = null
        }

        // Resolve the free-text target (address OR symbol) into token metadata,
        // debounced on input.
        const resolveTarget = async () => {
            const raw = tokenOutAddr.value.trim()
            targetError.value = ''
            tokenOut.value = null
            quote.value = null
            if (!raw) return
            isResolving.value = true
            try {
                // Prefer known-list metadata (match by address or symbol) to
                // avoid an extra network round-trip.
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
            quote.value = null
            if (resolveTimer) clearTimeout(resolveTimer)
            resolveTimer = setTimeout(resolveTarget, 400)
        }

        const fetchQuote = async () => {
            if (!canQuote.value || !wallet.value) return
            isQuoting.value = true
            quote.value = null
            resultTx.value = ''
            statusMsg.value = ''
            try {
                const amountInRaw = toBaseUnits(amountIn.value.trim(), tokenIn.value.decimals)
                const q = await getQuote({
                    tokenIn: tokenIn.value,
                    tokenOut: tokenOut.value!,
                    amountInRaw,
                    userAddress: '0x' + wallet.value.getEvmAddress(),
                    slippagePercent: slippage.value,
                })
                quote.value = q
            } catch (e: any) {
                notifications.add({
                    type: 'error',
                    title: 'Quote Failed',
                    message: e?.message || 'Could not fetch a quote.',
                })
            } finally {
                isQuoting.value = false
            }
        }

        const doSwap = async () => {
            if (!quote.value || !wallet.value) return
            const w = wallet.value
            const userAddress = '0x' + w.getEvmAddress()
            resultTx.value = ''
            statusMsg.value = ''
            try {
                evmChainId.value = await web3.eth.getChainId()
                const gasPrice: BN = await GasHelper.getAdjustedGasPrice()
                const amountInRaw = toBaseUnits(amountIn.value.trim(), tokenIn.value.decimals)

                // ERC20 inputs must approve the router first.
                if (!isNativeToken(tokenIn.value.address)) {
                    const router = await getRouterAddress()
                    const allowance = await getAllowance(
                        tokenIn.value.address,
                        userAddress,
                        router
                    )
                    if (allowance.lt(amountInRaw)) {
                        isApproving.value = true
                        statusMsg.value = 'Waiting for approval confirmation…'
                        await approveRouter(w, tokenIn.value.address, amountInRaw, gasPrice)
                        isApproving.value = false
                    }
                }

                isSwapping.value = true
                statusMsg.value = 'Broadcasting swap…'
                const res = await executeSwap(w, userAddress, quote.value, gasPrice)
                resultTx.value = res.txHash
                statusMsg.value = ''
                quote.value = null
                notifications.add({
                    type: 'success',
                    title: 'Swap Submitted',
                    message: `Swapping ${tokenIn.value.symbol} → ${tokenOut.value!.symbol}`,
                })
            } catch (e: any) {
                console.error('Swap failed', e)
                notifications.add({
                    type: 'error',
                    title: 'Swap Failed',
                    message: e?.message || 'The swap could not be completed.',
                })
                statusMsg.value = ''
            } finally {
                isApproving.value = false
                isSwapping.value = false
            }
        }

        onMounted(() => {
            // Default the source to the first held token.
            if (!tokenInAddr.value && heldTokens.value.length) {
                tokenInAddr.value = heldTokens.value[0].address
            }
        })

        return {
            heldTokens,
            tokenInAddr,
            tokenOutAddr,
            tokenIn,
            tokenOut,
            amountIn,
            slippage,
            quote,
            isQuoting,
            isApproving,
            isSwapping,
            isResolving,
            targetError,
            isBusy,
            canQuote,
            estimatedOut,
            rate,
            minReceived,
            statusMsg,
            resultTx,
            explorerUrl,
            balanceOf,
            fmtUsd,
            onAmountChange,
            onTargetChange,
            fetchQuote,
            doSwap,
        }
    },
})
</script>

<style lang="scss" scoped>
.swap_page {
    max-width: 560px;

    h1 {
        margin-bottom: 8px;
    }

    .desc {
        color: var(--primary-color-light);
        margin-bottom: 24px;
        line-height: 1.5;
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

    .token_row {
        display: flex;
        gap: 10px;
        align-items: center;
    }

    .amount_input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 22px;
        color: var(--primary-color);
        min-width: 0;

        &:focus {
            outline: none;
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
    }
}

.switch_row {
    display: flex;
    justify-content: center;
    margin: 8px 0;

    .switch_arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #d3d3d3;
        background: var(--bg);
        border-radius: 50%;
        width: 32px;
        height: 32px;
        font-size: 16px;
        color: var(--secondary-color);
    }
}

.target_row {
    margin-top: 10px;
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

.slippage_row {
    margin: 18px 0 8px;

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
}

.action_btn {
    width: 100%;
    margin-top: 16px;
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

    &.swap_confirm {
        background: #4caf50;
    }
}

.quote_box {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid #d3d3d3;

    .quote_row {
        display: flex;
        justify-content: space-between;
        font-size: 14px;
        margin-bottom: 8px;
        color: var(--primary-color);

        .warn {
            color: #f44336;
        }
    }
}

.info_msg {
    margin-top: 12px;
    font-size: 13px;
    color: var(--primary-color-light);
}

.result_card {
    border-color: #4caf50;

    .result_row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }

    .result_label {
        font-size: 13px;
        font-weight: 600;
        min-width: 70px;
    }

    .result_value {
        font-size: 13px;
        word-break: break-all;
        flex: 1;
    }

    .mono {
        font-family: monospace;
    }

    .explorer_link {
        display: inline-block;
        margin-top: 8px;
        color: var(--secondary-color);
        font-weight: 600;
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}
</style>
