<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="bridge_page">
        <h1>ARENA Bridge</h1>
        <p class="desc">
            Move ARENA between Avalanche C-Chain and Robinhood Chain over
            LayerZero. Your tokens are {{ route.mechanism }}.
        </p>

        <!-- Preconditions -->
        <div v-if="!hasProvider" class="card notice">
            <p>
                No wallet extension detected. This bridge signs through your
                extension (MetaMask or Core), so one needs to be installed and
                connected.
            </p>
        </div>

        <template v-else>
            <div v-if="!account" class="card notice">
                <p>Connect a wallet to bridge.</p>
                <button class="ava_button button_secondary" @click="connect" :disabled="busy">
                    Connect Wallet
                </button>
            </div>

            <template v-else>
                <div class="card">
                    <div class="route_row">
                        <div class="route_leg">
                            <label>From</label>
                            <p>{{ route.sourceName }}</p>
                        </div>
                        <button
                            class="swap_but"
                            @click="flipDirection"
                            :disabled="busy"
                            :title="`Bridge from ${route.destName} instead`"
                        >
                            ⇄
                        </button>
                        <div class="route_leg">
                            <label>To</label>
                            <p>{{ route.destName }}</p>
                        </div>
                    </div>

                    <!--
                        Balances are read straight from the source chain's RPC, so
                        they show whichever way the bridge is pointed. Only signing
                        needs the wallet to actually be on that chain.
                    -->
                    <div v-if="!onSourceChain" class="chain_notice">
                        <p>
                            This direction is signed on {{ route.sourceName }}, but your
                            wallet is on chain {{ currentChainId ?? 'unknown' }}.
                        </p>
                        <button
                            class="ava_button button_secondary"
                            @click="switchToSource"
                            :disabled="busy"
                        >
                            Switch to {{ route.sourceName }}
                        </button>
                    </div>

                    <div class="balance_row">
                        <label>ARENA balance on {{ route.sourceName }}</label>
                        <p>
                            <span v-if="balance === null">…</span>
                            <span v-else>{{ formatAmount(balance) }} ARENA</span>
                        </p>
                    </div>

                    <div class="amount_row">
                        <label for="bridge_amount">Amount</label>
                        <div class="amount_input">
                            <input
                                id="bridge_amount"
                                v-model="amountIn"
                                type="text"
                                inputmode="decimal"
                                placeholder="0.0"
                                autocomplete="off"
                                spellcheck="false"
                                :disabled="busy"
                            />
                            <button class="max_but" @click="setMax" :disabled="busy || !balance">
                                MAX
                            </button>
                        </div>
                    </div>

                    <p v-if="amountErr" class="err">{{ amountErr }}</p>

                    <!-- Quote -->
                    <div v-if="quote" class="quote_box">
                        <div class="quote_line">
                            <span>Sending</span>
                            <span>{{ formatAmount(quote.amountSentLD) }} ARENA</span>
                        </div>
                        <div class="quote_line">
                            <span>You receive on {{ route.destName }}</span>
                            <span>{{ formatAmount(quote.amountReceivedLD) }} ARENA</span>
                        </div>
                        <div v-if="quote.dustLD > 0" class="quote_line dust">
                            <span>Not bridged (rounded off)</span>
                            <span>{{ formatAmount(quote.dustLD) }} ARENA</span>
                        </div>
                        <div class="quote_line">
                            <span>LayerZero fee</span>
                            <span>{{ formatAmount(quote.nativeFee) }} {{ route.feeSymbol }}</span>
                        </div>
                        <div class="quote_line">
                            <span>Per-transfer limit</span>
                            <span>{{ formatAmount(quote.maxTransferLD) }} ARENA</span>
                        </div>
                    </div>
                    <p v-if="quote && quote.dustLD > 0" class="dust_note">
                        ARENA bridges at 6-decimal precision, so anything below that
                        is rounded off and stays in your wallet on
                        {{ route.sourceName }}.
                    </p>

                    <p v-if="err" class="err">{{ err }}</p>

                    <div class="actions">
                        <button
                            v-if="needsApproval"
                            class="ava_button button_secondary"
                            @click="approve"
                            :disabled="busy || !quote || !onSourceChain"
                        >
                            {{ isApproving ? 'Approving…' : 'Approve ARENA' }}
                        </button>
                        <button
                            v-else
                            class="ava_button button_secondary"
                            @click="bridge"
                            :disabled="busy || !quote || !onSourceChain"
                        >
                            {{ isBridging ? 'Bridging…' : `Bridge to ${route.destName}` }}
                        </button>
                    </div>

                    <p v-if="needsApproval && quote" class="approve_note">
                        A one-time approval lets the bridge contract move this amount
                        of ARENA. You'll confirm the bridge itself after.
                    </p>
                    <p v-else-if="!route.approvalToken && quote" class="approve_note">
                        No approval is needed this way — the ARENA contract on
                        {{ route.sourceName }} is the bridge, and burns from your own
                        balance.
                    </p>
                </div>

                <!-- Result -->
                <div v-if="sentTxHash" class="card success_card">
                    <h2>Bridge submitted</h2>
                    <p>
                        {{ sentRoute.sourceName }} transaction confirmed. Delivery to
                        {{ sentRoute.destName }} is handled by LayerZero and usually
                        lands within a few minutes.
                    </p>
                    <div class="links">
                        <a :href="sourceTxUrl" target="_blank" rel="noopener noreferrer">
                            View on {{ sourceExplorerName }}
                        </a>
                        <a :href="lzScanUrl" target="_blank" rel="noopener noreferrer">
                            Track delivery on LayerZero Scan
                        </a>
                    </div>
                </div>
            </template>
        </template>
    </div>
</template>

<script lang="ts">
/**
 * ARENA bridge page, both directions.
 *
 * Signs through the injected provider directly rather than through either
 * platform's wallet class. Two reasons: the bridge is a pair of arbitrary
 * contract calls (an ERC-20 approve and a payable `send`), which neither
 * `EvmWallet` nor Avalanche's `WalletHelper` exposes a generic path for; and
 * doing it this way means the page works whichever platform is active, since
 * both chains are reached through the same extension.
 *
 * Protocol details, the per-direction route table, and the on-chain
 * verification behind the addresses live in `@/evm/bridge/arenaOft`.
 */
import { defineComponent, ref, computed, watch, onMounted } from 'vue'

import {
    ARENA_DECIMALS,
    DEFAULT_DIRECTION,
    buildApproveTx,
    buildSendTx,
    getArenaAllowance,
    getArenaBalance,
    getRoute,
    getSourceNetwork,
    layerZeroScanUrl,
    oppositeDirection,
    quoteBridge,
    type BridgeDirection,
    type BridgeQuote,
} from '@/evm/bridge/arenaOft'
import {
    ensureChain,
    getEvmProvider,
    getProviderChainId,
    type Eip1193Provider,
} from '@/platforms/evm/wallet'

/** Parses a decimal string into base units, without going through float. */
function parseAmount(input: string, decimals: number): bigint | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    if (!/^\d*\.?\d*$/.test(trimmed)) return null
    const [whole, frac = ''] = trimmed.split('.')
    if (frac.length > decimals) return null
    const combined = (whole || '0') + frac.padEnd(decimals, '0')
    try {
        return BigInt(combined)
    } catch {
        return null
    }
}

export default defineComponent({
    name: 'Bridge',
    setup() {
        const provider = ref<Eip1193Provider | null>(null)
        const account = ref<string | null>(null)
        const currentChainId = ref<number | null>(null)
        const balance = ref<bigint | null>(null)
        const allowance = ref<bigint | null>(null)

        const direction = ref<BridgeDirection>(DEFAULT_DIRECTION)
        const amountIn = ref('')
        const quote = ref<BridgeQuote | null>(null)
        const err = ref('')
        const amountErr = ref('')

        const isQuoting = ref(false)
        const isApproving = ref(false)
        const isBridging = ref(false)
        const isConnecting = ref(false)
        const sentTxHash = ref('')
        /** The direction the submitted transaction went, so the result card survives a flip. */
        const sentDirection = ref<BridgeDirection>(DEFAULT_DIRECTION)

        const route = computed(() => getRoute(direction.value))
        const sentRoute = computed(() => getRoute(sentDirection.value))

        const hasProvider = computed(() => provider.value !== null)
        const onSourceChain = computed(() => currentChainId.value === route.value.sourceChainId)
        const busy = computed(
            () => isQuoting.value || isApproving.value || isBridging.value || isConnecting.value
        )

        const amountLD = computed((): bigint | null => parseAmount(amountIn.value, ARENA_DECIMALS))

        const needsApproval = computed((): boolean => {
            if (!quote.value || allowance.value === null) return false
            return allowance.value < quote.value.amountSentLD
        })

        const sourceTxUrl = computed(
            () => `${getSourceNetwork(sentDirection.value).explorerUrl}/tx/${sentTxHash.value}`
        )
        const sourceExplorerName = computed(() => {
            const url = getSourceNetwork(sentDirection.value).explorerUrl ?? ''
            const host = url.replace(/^https?:\/\//, '').split('/')[0]
            return host || 'the explorer'
        })
        const lzScanUrl = computed(() => layerZeroScanUrl(sentTxHash.value))

        /** Formats base units for display, trimming trailing zeros. */
        const formatAmount = (raw: bigint, decimals = ARENA_DECIMALS): string => {
            const neg = raw < BigInt(0)
            const abs = neg ? -raw : raw
            const base = BigInt(10) ** BigInt(decimals)
            const whole = abs / base
            const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '')
            return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''}`
        }

        const readChain = async (): Promise<void> => {
            if (!provider.value) return
            currentChainId.value = await getProviderChainId(provider.value)
        }

        const readAccount = async (): Promise<void> => {
            if (!provider.value) return
            try {
                const accounts: string[] = await provider.value.request({ method: 'eth_accounts' })
                account.value = accounts?.[0] ?? null
            } catch {
                account.value = null
            }
        }

        /**
         * Reads through the source chain's own RPC rather than the wallet, so
         * these stay correct no matter which network the extension is on.
         */
        const refreshBalances = async (): Promise<void> => {
            if (!account.value) return
            const forDirection = direction.value
            try {
                const [bal, allow] = await Promise.all([
                    getArenaBalance(forDirection, account.value),
                    getArenaAllowance(forDirection, account.value),
                ])
                // The user can flip direction mid-read; a late answer for the
                // other leg would show the wrong chain's balance.
                if (direction.value !== forDirection) return
                balance.value = bal
                allowance.value = allow
            } catch (e: any) {
                console.warn('[Bridge] Could not read ARENA balance/allowance:', e)
            }
        }

        const connect = async (): Promise<void> => {
            if (!provider.value) return
            isConnecting.value = true
            err.value = ''
            try {
                await provider.value.request({ method: 'eth_requestAccounts' })
                await readAccount()
                await readChain()
                await refreshBalances()
            } catch (e: any) {
                err.value = e?.message ?? 'Could not connect.'
            } finally {
                isConnecting.value = false
            }
        }

        const switchToSource = async (): Promise<void> => {
            if (!provider.value) return
            err.value = ''
            try {
                await ensureChain(provider.value, getSourceNetwork(direction.value))
                await readChain()
                await refreshBalances()
            } catch (e: any) {
                err.value = e?.message ?? 'Could not switch network.'
            }
        }

        const flipDirection = async (): Promise<void> => {
            direction.value = oppositeDirection(direction.value)
            amountIn.value = ''
            quote.value = null
            err.value = ''
            amountErr.value = ''
            balance.value = null
            allowance.value = null
            await refreshBalances()
        }

        const refreshQuote = async (): Promise<void> => {
            quote.value = null
            amountErr.value = ''
            const amt = amountLD.value
            if (!amt || amt <= BigInt(0) || !account.value) return
            if (balance.value !== null && amt > balance.value) {
                amountErr.value = `Amount exceeds your ARENA balance on ${route.value.sourceName}.`
                return
            }

            isQuoting.value = true
            err.value = ''
            const forDirection = direction.value
            try {
                const q = await quoteBridge(forDirection, account.value, amt)
                if (direction.value === forDirection) quote.value = q
            } catch (e: any) {
                if (direction.value === forDirection) {
                    amountErr.value = e?.message ?? 'Could not quote this bridge.'
                }
            } finally {
                isQuoting.value = false
            }
        }

        /**
         * Re-checks the chain immediately before signing. The extension can be
         * moved to another network at any moment, and both of these calls are
         * plain `eth_sendTransaction` — they go wherever the extension points,
         * so a stale check would submit a transaction meant for one chain on
         * whatever chain it drifted to.
         */
        const assertOnSourceChain = async (): Promise<void> => {
            await readChain()
            if (!onSourceChain.value) {
                throw new Error(
                    `Your wallet is on chain ${currentChainId.value}, not ` +
                        `${route.value.sourceName}. Switch back and try again.`
                )
            }
        }

        const submit = async (tx: { to: string; data: string; value?: string }): Promise<string> => {
            const p = provider.value
            if (!p || !account.value) throw new Error('No connected wallet.')
            const params: Record<string, string> = {
                from: account.value,
                to: tx.to,
                data: tx.data,
            }
            if (tx.value) params.value = tx.value
            return await p.request({ method: 'eth_sendTransaction', params: [params] })
        }

        const approve = async (): Promise<void> => {
            if (!quote.value) return
            isApproving.value = true
            err.value = ''
            try {
                await assertOnSourceChain()
                await submit(buildApproveTx(direction.value, quote.value.amountSentLD))
                // The extension resolves as soon as the tx is broadcast, not
                // mined, so poll the allowance rather than assuming it landed.
                await pollAllowance(quote.value.amountSentLD)
            } catch (e: any) {
                err.value = e?.message ?? 'Approval failed.'
            } finally {
                isApproving.value = false
            }
        }

        /** Waits for the approval to actually take effect on-chain. */
        const pollAllowance = async (required: bigint): Promise<void> => {
            if (!account.value) return
            const forDirection = direction.value
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 1500))
                if (direction.value !== forDirection) return
                try {
                    const allow = await getArenaAllowance(forDirection, account.value)
                    allowance.value = allow
                    if (allow !== null && allow >= required) return
                } catch {
                    /* transient RPC hiccup — keep polling */
                }
            }
            err.value =
                'Approval is taking longer than expected to confirm. Check your wallet, then try bridging again.'
        }

        const bridge = async (): Promise<void> => {
            if (!quote.value || !account.value) return
            isBridging.value = true
            err.value = ''
            const forDirection = direction.value
            try {
                await assertOnSourceChain()
                // Re-quote immediately before sending: the LayerZero fee moves
                // with gas, and an under-funded msg.value reverts.
                const fresh = await quoteBridge(
                    forDirection,
                    account.value,
                    quote.value.amountSentLD
                )
                quote.value = fresh
                const hash = await submit(buildSendTx(fresh, account.value))
                sentDirection.value = forDirection
                sentTxHash.value = hash
                amountIn.value = ''
                quote.value = null
                await refreshBalances()
            } catch (e: any) {
                err.value = e?.message ?? 'Bridge failed.'
            } finally {
                isBridging.value = false
            }
        }

        const setMax = (): void => {
            if (balance.value === null) return
            amountIn.value = formatAmountRaw(balance.value, ARENA_DECIMALS)
        }

        /** Like formatAmount but without thousands separators, so it round-trips through the input. */
        const formatAmountRaw = (raw: bigint, decimals: number): string => {
            const base = BigInt(10) ** BigInt(decimals)
            const whole = raw / base
            const frac = (raw % base).toString().padStart(decimals, '0').replace(/0+$/, '')
            return `${whole}${frac ? '.' + frac : ''}`
        }

        let quoteTimer: ReturnType<typeof setTimeout> | undefined
        watch(amountIn, () => {
            sentTxHash.value = ''
            clearTimeout(quoteTimer)
            quoteTimer = setTimeout(refreshQuote, 400)
        })

        onMounted(async () => {
            provider.value = getEvmProvider()
            if (!provider.value) return
            await readAccount()
            await readChain()
            await refreshBalances()

            provider.value.on?.('accountsChanged', async (accounts: string[]) => {
                account.value = accounts?.[0] ?? null
                quote.value = null
                balance.value = null
                allowance.value = null
                await refreshBalances()
            })
            provider.value.on?.('chainChanged', async () => {
                await readChain()
                quote.value = null
                await refreshBalances()
            })
        })

        return {
            hasProvider,
            account,
            currentChainId,
            route,
            sentRoute,
            onSourceChain,
            balance,
            amountIn,
            quote,
            err,
            amountErr,
            busy,
            isApproving,
            isBridging,
            needsApproval,
            sentTxHash,
            sourceTxUrl,
            sourceExplorerName,
            lzScanUrl,
            formatAmount,
            connect,
            switchToSource,
            flipDirection,
            approve,
            bridge,
            setMax,
        }
    },
})
</script>

<style scoped lang="scss">
.bridge_page {
    width: 100%;
    max-width: 680px;

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
        margin: 0 0 8px;
        font-size: 18px;
    }
}

.notice {
    p {
        margin-bottom: 14px;
        color: var(--primary-color-light);
        line-height: 1.5;
    }
}

.chain_notice {
    margin-bottom: 20px;
    padding: 14px;
    background: var(--bg);
    border-radius: 8px;

    p {
        margin-bottom: 10px;
        font-size: 13px;
        color: var(--primary-color-light);
        line-height: 1.5;
    }
}

.route_row {
    display: flex;
    align-items: center;
    gap: 18px;
    margin-bottom: 20px;
}

.route_leg {
    label {
        display: block;
        font-size: 12px;
        color: var(--primary-color-light);
    }
    p {
        color: var(--primary-color);
        font-size: 15px;
        font-weight: 600;
    }
}

.swap_but {
    flex-shrink: 0;
    color: var(--secondary-color);
    font-size: 18px;
    line-height: 1;
    padding: 6px 10px;
    border-radius: 6px;
    background: var(--bg);

    &:disabled {
        opacity: 0.4;
        cursor: default;
    }
}

.balance_row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 16px;
    font-size: 13px;

    label {
        color: var(--primary-color-light);
    }
    p {
        color: var(--primary-color);
        white-space: nowrap;
    }
}

.amount_row {
    label {
        display: block;
        font-size: 12px;
        color: var(--primary-color-light);
        margin-bottom: 4px;
    }
}

.amount_input {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg);
    border-radius: 6px;
    padding: 8px 12px;

    input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        color: var(--primary-color);
        font-size: 20px;

        &:focus {
            outline: none;
        }
    }
}

.max_but {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--secondary-color);
    padding: 2px 8px;
    border-radius: 4px;

    &:disabled {
        opacity: 0.4;
        cursor: default;
    }
}

.quote_box {
    margin-top: 18px;
    padding: 14px;
    background: var(--bg);
    border-radius: 8px;
    font-size: 13px;
}

.quote_line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 3px 0;

    span:first-child {
        color: var(--primary-color-light);
    }

    span:last-child {
        color: var(--primary-color);
        white-space: nowrap;
    }

    &.dust span:last-child {
        color: var(--warning);
    }
}

.dust_note,
.approve_note {
    margin-top: 10px;
    font-size: 12px;
    color: var(--primary-color-light);
    line-height: 1.5;
}

.actions {
    margin-top: 20px;
}

.err {
    margin-top: 12px;
    color: var(--error);
    font-size: 13px;
}

.success_card {
    p {
        color: var(--primary-color);
        line-height: 1.5;
    }

    .links {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 12px;
    }

    a {
        color: var(--secondary-color);
        font-size: 13px;
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}
</style>
