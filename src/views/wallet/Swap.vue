<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="swap_page">
        <h1>Swap</h1>
        <p class="desc">
            Swap tokens on the Avalanche C-Chain. Routing is powered by LI.FI for
            best-price execution across on-chain liquidity. Quotes and the
            executable transaction are fetched via API; signing and broadcasting happen locally
            with your active wallet.
        </p>

        <div class="card">
            <!-- ── From ── -->
            <div class="token_block">
                <div class="token_head">
                    <label>You pay</label>
                    <span
                        v-if="tokenIn"
                        class="balance clickable"
                        title="Click to use max amount"
                        @click="setMaxAmount"
                    >
                        Balance: {{ tokenIn.balance.toFixed(4) }} {{ tokenIn.symbol }}
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
                    <button
                        v-if="tokenIn"
                        type="button"
                        class="max_but"
                        :disabled="isBusy"
                        @click="setMaxAmount"
                    >
                        Max
                    </button>
                    <div ref="tokenSelectWrap" class="token_select_wrap">
                        <button
                            type="button"
                            class="token_select_btn"
                            :disabled="isBusy || (!heldTokens.length && !sdkLoading)"
                            @click="toggleTokenDropdown"
                        >
                            <template v-if="tokenIn">{{ tokenIn.symbol }}</template>
                            <template v-else-if="sdkLoading && !heldTokens.length">
                                <Spinner class="token_btn_spinner"></Spinner>
                                Loading…
                            </template>
                            <template v-else>No tokens held</template>
                            <span class="caret">▾</span>
                        </button>
                        <div v-if="tokenDropdownOpen" class="token_dropdown">
                            <TokenListPicker
                                :tokens="heldTokens"
                                :selected-address="tokenInAddr"
                                :loading="sdkLoading"
                                @select="selectTokenIn"
                            ></TokenListPicker>
                        </div>
                    </div>
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
                <div v-if="tokenOut && !isNativeToken(tokenOut.address)" class="contract_row">
                    <div class="contract_addr">
                        <span class="contract_label">Contract</span>
                        <span class="mono">{{ tokenOut.address }}</span>
                        <CopyText :value="tokenOut.address" class="copy_btn" />
                    </div>
                    <p class="contract_warn">
                        Always verify this address yourself before swapping — anyone can
                        create a token with the same symbol or name.
                    </p>
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
                    <span>${{ fmtUsd(quote.fromAmountUSD) }} → ${{ fmtUsd(quote.toAmountUSD) }}</span>
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
            <button type="button" class="action_btn reset_btn" @click="resetForm">
                New Swap
            </button>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted } from 'vue'
import { useMainStore, useAssetsStore, useNotificationsStore } from '@/stores'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { GasHelper } from '@/avalanche-wallet-sdk'
import { bnToBig } from '@/helpers/helper'
import { toBaseUnits } from '@/js/TokenLauncher'
import CopyText from '@/components/misc/CopyText.vue'
import Spinner from '@/components/misc/Spinner.vue'
import TokenListPicker from '@/components/misc/TokenListPicker.vue'
import { useHeldErc20Tokens, HeldToken } from '@/composables/useHeldErc20Tokens'
import {
    getQuote,
    executeSwap,
    approveRouter,
    getAllowance,
    isNativeToken,
    resolveTargetToken,
    cChainExplorerTxUrl,
    SwapToken,
    SwapQuote,
} from '@/js/ArenaSwap'
import { AvaWalletCore } from '@/js/wallets/types'
import { authorizeWalletOp, AuthScope, SessionAuthCancelled } from '@/js/security/authorize'

export default defineComponent({
    name: 'Swap',
    components: {
        CopyText,
        Spinner,
        TokenListPicker,
    },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const wallet = computed(() => mainStore.activeWallet as AvaWalletCore | null)

        // Source list: ONLY tokens the wallet currently holds (native AVAX +
        // any ERC20 with a positive balance), merging the assets store
        // ("Default Assets") with tokens auto-discovered via the
        // Glacier/chainkit SDK ("All Assets") — same merged list the
        // transfer page's token picker uses, so neither omits what the
        // other shows.
        const { tokens: heldTokens, loading: sdkLoading, refresh: refreshHeldTokens } = useHeldErc20Tokens()

        const tokenInAddr = ref('')
        const tokenOutAddr = ref('')
        const amountIn = ref('')
        const slippage = ref(0.5)

        // Searchable "You pay" token dropdown (replaces a plain <select> so
        // a long held-token list can be filtered by symbol/name/address) —
        // search + list rendering itself lives in TokenListPicker.
        const tokenDropdownOpen = ref(false)
        const tokenSelectWrap = ref<HTMLElement>()

        const toggleTokenDropdown = () => {
            if (isBusy.value || !heldTokens.value.length) return
            tokenDropdownOpen.value = !tokenDropdownOpen.value
        }

        const selectTokenIn = (t: HeldToken) => {
            tokenInAddr.value = t.address
            tokenDropdownOpen.value = false
            quote.value = null
        }

        const onDocumentClick = (e: MouseEvent) => {
            if (!tokenDropdownOpen.value) return
            if (tokenSelectWrap.value && !tokenSelectWrap.value.contains(e.target as Node)) {
                tokenDropdownOpen.value = false
            }
        }

        const quote = ref<SwapQuote | null>(null)
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

        const setMaxAmount = () => {
            if (!tokenIn.value) return
            // Full precision (not the 4-decimal display rounding shown next
            // to the balance label) so "Max" never asks to spend more than
            // is actually held.
            amountIn.value = tokenIn.value.balance.toString()
            quote.value = null
        }

        const estimatedOut = computed(() => {
            if (!quote.value || !tokenOut.value) return ''
            return bnToBig(new BN(quote.value.toAmount), tokenOut.value.decimals).toFixed(6)
        })

        const rate = computed(() => {
            if (!quote.value || !tokenOut.value) return '0'
            const outBig = bnToBig(new BN(quote.value.toAmount), tokenOut.value.decimals)
            const inNum = parseFloat(amountIn.value) || 1
            return outBig.div(inNum).toFixed(6)
        })

        // toAmountMin already reflects the slippage tolerance sent with the
        // quote request (see getQuote) — the aggregator's own figure, not a
        // client-side recompute.
        const minReceived = computed(() => {
            if (!quote.value || !tokenOut.value) return '0'
            return bnToBig(new BN(quote.value.toAmountMin), tokenOut.value.decimals).toFixed(6)
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

        // Clears everything the "Swap Submitted" result depends on so the form
        // is ready for another swap — keeps the selected source token (a
        // convenience for swapping the same asset again) but clears the
        // amount, target, quote and result/status.
        const resetForm = () => {
            amountIn.value = ''
            tokenOutAddr.value = ''
            tokenOut.value = null
            targetError.value = ''
            isResolving.value = false
            quote.value = null
            resultTx.value = ''
            statusMsg.value = ''
            if (resolveTimer) clearTimeout(resolveTimer)
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
                // An ERC20 input needs an approval before the swap, so this
                // scope may cover two signatures from one password entry.
                await authorizeWalletOp(w, AuthScope.BATCH, 'Approve and swap', async () => {
                evmChainId.value = await web3.eth.getChainId()
                const gasPrice: BN = await GasHelper.getAdjustedGasPrice()
                const amountInRaw = toBaseUnits(amountIn.value.trim(), tokenIn.value.decimals)

                // Explicit, locally-incrementing nonce for the (up to) two
                // sends below — asking the wallet/RPC for "the" current
                // nonce independently for each is racy, since the approval
                // may not be visible as pending yet by the time the swap
                // asks, and both can get the same nonce.
                let nextNonceVal: number | undefined
                const nextNonce = async (): Promise<number> => {
                    if (nextNonceVal === undefined) {
                        nextNonceVal = await web3.eth.getTransactionCount(userAddress, 'pending')
                    }
                    return nextNonceVal++
                }

                // ERC20 inputs must approve LI.FI's quoted spender first — it
                // can vary per route/quote, unlike Odos's single fixed router.
                const spender = quote.value.approvalAddress
                if (!isNativeToken(tokenIn.value.address) && spender) {
                    const allowance = await getAllowance(
                        tokenIn.value.address,
                        userAddress,
                        spender
                    )
                    if (allowance.lt(amountInRaw)) {
                        isApproving.value = true
                        statusMsg.value = 'Waiting for approval confirmation…'
                        await approveRouter(
                            w,
                            tokenIn.value.address,
                            spender,
                            amountInRaw,
                            gasPrice,
                            await nextNonce()
                        )
                        isApproving.value = false
                    }
                }

                isSwapping.value = true
                statusMsg.value = 'Broadcasting swap…'
                const res = await executeSwap(w, quote.value, gasPrice, await nextNonce())
                resultTx.value = res.txHash
                statusMsg.value = ''
                quote.value = null
                notifications.add({
                    type: 'success',
                    title: 'Swap Submitted',
                    message: `Swapping ${tokenIn.value.symbol} → ${tokenOut.value!.symbol}`,
                })

                // Balances don't update on their own (see useHeldErc20Tokens's
                // refresh() doc) — without this, tokenIn.balance still reads
                // pre-swap, so a "Max" click on the next swap would offer to
                // spend an amount the wallet no longer has. The broadcast tx
                // above only guarantees the *submission* landed, not that the
                // node's balance view has caught up yet, so this can still
                // race the RPC by a block or two; it's the same best-effort
                // freshness the rest of the app relies on after a send.
                refreshHeldTokens().catch((e) => {
                    console.warn('[Swap] post-swap balance refresh failed:', e)
                })
                })
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) {
                    isApproving.value = false
                    isSwapping.value = false
                    statusMsg.value = ''
                    return
                }
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
            document.addEventListener('mousedown', onDocumentClick)
        })

        onUnmounted(() => {
            document.removeEventListener('mousedown', onDocumentClick)
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
            setMaxAmount,
            fmtUsd,
            isNativeToken,
            onAmountChange,
            onTargetChange,
            fetchQuote,
            doSwap,
            resetForm,
            tokenDropdownOpen,
            tokenSelectWrap,
            toggleTokenDropdown,
            selectTokenIn,
            sdkLoading,
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

            &.clickable {
                cursor: pointer;
                user-select: none;

                &:hover {
                    color: var(--secondary-color);
                    text-decoration: underline;
                }
            }
        }
    }

    .token_row {
        display: flex;
        gap: 10px;
        align-items: center;
    }

    .max_but {
        flex-shrink: 0;
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 600;
        background: transparent;
        color: var(--secondary-color);
        cursor: pointer;

        &:hover:not(:disabled) {
            background: var(--bg-light);
        }

        &:disabled {
            cursor: not-allowed;
            opacity: 0.5;
        }
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

    .token_select_wrap {
        position: relative;
        flex-shrink: 0;
    }

    .token_select_btn {
        display: flex;
        align-items: center;
        gap: 6px;
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 15px;
        font-weight: 600;
        background: var(--bg-light);
        color: var(--primary-color);
        cursor: pointer;
        white-space: nowrap;

        .caret {
            font-size: 11px;
            opacity: 0.6;
        }

        &:disabled {
            cursor: not-allowed;
            opacity: 0.6;
        }
    }

    // Spinner.vue's own scoped style sets its own width/height — match
    // BalanceCard.vue's/Fungibles.vue's precedent of using !important to
    // reliably override a child component's own scoped styles.
    .token_btn_spinner {
        width: 13px !important;
        height: 13px !important;
    }

    // Popover shell around TokenListPicker (which supplies its own search
    // input + scrollable list styling) — anchored under the trigger button.
    .token_dropdown {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 240px;
        max-width: 80vw;
        background: var(--bg);
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        z-index: 5;
        overflow: hidden;
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

.contract_row {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--bg-light);

    .contract_addr {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .contract_label {
        font-size: 11px;
        font-weight: 600;
        color: var(--primary-color-light);
        white-space: nowrap;
    }

    .mono {
        font-family: monospace;
        font-size: 12px;
        color: var(--primary-color);
        word-break: break-all;
        flex: 1;
    }

    .copy_btn {
        flex-shrink: 0;
    }

    .contract_warn {
        margin-top: 6px;
        font-size: 11.5px;
        color: var(--secondary-color);
        line-height: 1.4;
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

    h2 {
        color: var(--primary-color);
    }

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
        color: var(--primary-color-light);
    }

    .result_value {
        font-size: 13px;
        word-break: break-all;
        flex: 1;
        color: var(--primary-color);
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

    .reset_btn {
        display: block;
        background: transparent;
        border: 1px solid #4caf50;
        color: #4caf50;

        &:hover:not(:disabled) {
            background: rgba(76, 175, 80, 0.1);
            opacity: 1;
        }
    }
}
</style>
