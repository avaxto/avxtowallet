<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="bridge_page">
        <h1>ARENA Bridge</h1>
        <p class="desc">
            Move ARENA from Avalanche C-Chain to Robinhood Chain over LayerZero.
            Your tokens are locked on Avalanche and minted to the same address on
            Robinhood Chain.
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

            <div v-else-if="!onAvalanche" class="card notice">
                <p>
                    Bridging starts on Avalanche C-Chain, but your wallet is on
                    chain {{ currentChainId ?? 'unknown' }}.
                </p>
                <button class="ava_button button_secondary" @click="switchToAvalanche" :disabled="busy">
                    Switch to Avalanche C-Chain
                </button>
            </div>

            <template v-else>
                <div class="card">
                    <div class="route_row">
                        <div class="route_leg">
                            <label>From</label>
                            <p>Avalanche C-Chain</p>
                        </div>
                        <span class="route_arrow">→</span>
                        <div class="route_leg">
                            <label>To</label>
                            <p>Robinhood Chain</p>
                        </div>
                    </div>

                    <div class="balance_row">
                        <label>ARENA balance</label>
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
                            <span>You receive</span>
                            <span>{{ formatAmount(quote.amountReceivedLD) }} ARENA</span>
                        </div>
                        <div v-if="quote.dustLD > 0" class="quote_line dust">
                            <span>Not bridged (rounded off)</span>
                            <span>{{ formatAmount(quote.dustLD) }} ARENA</span>
                        </div>
                        <div class="quote_line">
                            <span>LayerZero fee</span>
                            <span>{{ formatAmount(quote.nativeFee) }} AVAX</span>
                        </div>
                    </div>
                    <p v-if="quote && quote.dustLD > 0" class="dust_note">
                        ARENA bridges at 6-decimal precision, so anything below that
                        is rounded off and stays in your wallet on Avalanche.
                    </p>

                    <p v-if="err" class="err">{{ err }}</p>

                    <div class="actions">
                        <button
                            v-if="needsApproval"
                            class="ava_button button_secondary"
                            @click="approve"
                            :disabled="busy || !quote"
                        >
                            {{ isApproving ? 'Approving…' : 'Approve ARENA' }}
                        </button>
                        <button
                            v-else
                            class="ava_button button_secondary"
                            @click="bridge"
                            :disabled="busy || !quote"
                        >
                            {{ isBridging ? 'Bridging…' : 'Bridge to Robinhood' }}
                        </button>
                    </div>

                    <p v-if="needsApproval && quote" class="approve_note">
                        A one-time approval lets the bridge contract move this amount
                        of ARENA. You'll confirm the bridge itself after.
                    </p>
                </div>

                <!-- Result -->
                <div v-if="sentTxHash" class="card success_card">
                    <h2>Bridge submitted</h2>
                    <p>
                        Avalanche transaction confirmed. Delivery to Robinhood Chain is
                        handled by LayerZero and usually lands within a few minutes.
                    </p>
                    <div class="links">
                        <a :href="avalancheTxUrl" target="_blank" rel="noopener noreferrer">
                            View on Snowtrace
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
 * ARENA bridge page.
 *
 * Signs through the injected provider directly rather than through either
 * platform's wallet class. Two reasons: the bridge is a pair of arbitrary
 * contract calls (an ERC-20 approve and a payable `send`), which neither
 * `EvmWallet` nor Avalanche's `WalletHelper` exposes a generic path for; and
 * doing it this way means the page works whichever platform is active, since
 * both reach Avalanche C-Chain through the same extension.
 *
 * Protocol details, and the on-chain verification behind the addresses, live
 * in `@/evm/bridge/arenaOft`.
 */
import { defineComponent, ref, computed, watch, onMounted } from 'vue'

import {
    ARENA_DECIMALS,
    AVALANCHE_CHAIN_ID,
    buildApproveTx,
    buildSendTx,
    getArenaAllowance,
    getArenaBalance,
    getAvalancheNetwork,
    layerZeroScanUrl,
    quoteBridge,
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

        const amountIn = ref('')
        const quote = ref<BridgeQuote | null>(null)
        const err = ref('')
        const amountErr = ref('')

        const isQuoting = ref(false)
        const isApproving = ref(false)
        const isBridging = ref(false)
        const isConnecting = ref(false)
        const sentTxHash = ref('')

        const hasProvider = computed(() => provider.value !== null)
        const onAvalanche = computed(() => currentChainId.value === AVALANCHE_CHAIN_ID)
        const busy = computed(
            () => isQuoting.value || isApproving.value || isBridging.value || isConnecting.value
        )

        const amountLD = computed((): bigint | null => parseAmount(amountIn.value, ARENA_DECIMALS))

        const needsApproval = computed((): boolean => {
            if (!quote.value || allowance.value === null) return false
            return allowance.value < quote.value.amountSentLD
        })

        const avalancheTxUrl = computed(
            () => `${getAvalancheNetwork().explorerUrl}/tx/${sentTxHash.value}`
        )
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

        const refreshBalances = async (): Promise<void> => {
            if (!account.value || !onAvalanche.value) return
            try {
                const [bal, allow] = await Promise.all([
                    getArenaBalance(account.value),
                    getArenaAllowance(account.value),
                ])
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

        const switchToAvalanche = async (): Promise<void> => {
            if (!provider.value) return
            err.value = ''
            try {
                await ensureChain(provider.value, getAvalancheNetwork())
                await readChain()
                await refreshBalances()
            } catch (e: any) {
                err.value = e?.message ?? 'Could not switch network.'
            }
        }

        const refreshQuote = async (): Promise<void> => {
            quote.value = null
            amountErr.value = ''
            const amt = amountLD.value
            if (!amt || amt <= BigInt(0) || !account.value || !onAvalanche.value) return
            if (balance.value !== null && amt > balance.value) {
                amountErr.value = 'Amount exceeds your ARENA balance.'
                return
            }

            isQuoting.value = true
            err.value = ''
            try {
                quote.value = await quoteBridge(account.value, amt)
            } catch (e: any) {
                amountErr.value = e?.message ?? 'Could not quote this bridge.'
            } finally {
                isQuoting.value = false
            }
        }

        /**
         * Re-checks the chain immediately before signing. The extension can be
         * moved to another network at any moment, and both of these calls are
         * plain `eth_sendTransaction` — they go wherever the extension points,
         * so a stale check would submit an Avalanche-intended transaction on
         * whatever chain it drifted to.
         */
        const assertStillOnAvalanche = async (): Promise<void> => {
            await readChain()
            if (!onAvalanche.value) {
                throw new Error(
                    `Your wallet is on chain ${currentChainId.value}, not Avalanche C-Chain. ` +
                        'Switch back and try again.'
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
                await assertStillOnAvalanche()
                await submit(buildApproveTx(quote.value.amountSentLD))
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
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 1500))
                try {
                    const allow = await getArenaAllowance(account.value)
                    allowance.value = allow
                    if (allow >= required) return
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
            try {
                await assertStillOnAvalanche()
                // Re-quote immediately before sending: the LayerZero fee moves
                // with gas, and an under-funded msg.value reverts.
                const fresh = await quoteBridge(account.value, quote.value.amountSentLD)
                quote.value = fresh
                const hash = await submit(buildSendTx(fresh, account.value))
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
            onAvalanche,
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
            avalancheTxUrl,
            lzScanUrl,
            formatAmount,
            connect,
            switchToAvalanche,
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
        font-size: 15px;
        font-weight: 600;
    }
}

.route_arrow {
    color: var(--primary-color-light);
    font-size: 18px;
}

.balance_row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 16px;
    font-size: 13px;

    label {
        color: var(--primary-color-light);
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
    padding: 3px 0;

    span:first-child {
        color: var(--primary-color-light);
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
