<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Bitcoin's asset view.

  Bitcoin has exactly one asset, so a token *list* would be a table with one
  permanent row. What is actually worth surfacing instead is the things an HD
  UTXO wallet has and an account-model wallet does not: which address to
  receive at, how the balance is spread across addresses, and how many
  spendable outputs back it.
-->
<template>
    <div class="btc_portfolio">
        <div class="filter_row">
            <span class="type_chip">{{ addressTypeLabel }}</span>
            <button class="refresh_but" @click="refresh" :disabled="isScanning">
                <fa icon="sync"></fa>
                {{ isScanning ? 'Scanning…' : 'Refresh' }}
            </button>
        </div>

        <div class="balance_block">
            <label>Balance</label>
            <p class="amount">{{ balanceText }} <span class="sym">{{ symbol }}</span></p>
            <p class="sats">{{ satsText }} sats</p>
        </div>

        <div class="receive_block">
            <label>Receive address</label>
            <div class="addr_row">
                <a
                    :href="receiveUrl"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="mono addr"
                >
                    {{ receiveAddress }}
                </a>
                <CopyText :value="receiveAddress" class="copy_btn" />
            </div>
            <p class="hint">
                A fresh, unused address. Bitcoin wallets generate a new one per payment so
                transactions are harder to link — older addresses stay yours and keep working.
            </p>
        </div>

        <div v-if="isWatchOnly" class="watch_note">
            <fa icon="glasses"></fa>
            Watch-only — this wallet holds no key and cannot spend.
        </div>

        <div class="utxo_block" v-if="!isWatchOnly">
            <label>Spendable outputs</label>
            <p v-if="!utxoCount" class="hint">
                No spendable outputs{{ isScanning ? ' yet — still scanning.' : '.' }}
            </p>
            <p v-else class="hint">
                {{ utxoCount }} unspent output{{ utxoCount === 1 ? '' : 's' }}
                <span v-if="unconfirmedCount">
                    · {{ unconfirmedCount }} still unconfirmed
                </span>
            </p>
        </div>

        <div v-if="usedAddresses.length" class="addr_list">
            <div class="list_head">
                <label>Addresses with a balance</label>
            </div>
            <div v-for="a in usedAddresses" :key="a.address" class="addr_item">
                <span class="chain_tag" :class="a.chain">{{
                    a.chain === 'change' ? 'change' : 'receive'
                }}</span>
                <div class="addr_col">
                    <a
                        :href="addressUrl(a.address)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mono small"
                    >
                        {{ a.address }}
                    </a>
                    <!--
                      Only set for a balance tracked via a non-primary scheme
                      (Electrum, Core Wallet, Bitcoin Core legacy, …) — see
                      ScannedAddress.scheme. A caption under the address
                      rather than squeezed into the narrow tag column, since
                      these labels run much longer than "receive"/"change".
                    -->
                    <span v-if="a.scheme" class="scheme_note">{{ a.scheme }}</span>
                </div>
                <span class="mono small amt">{{ formatSats(a.balanceSats) }}</span>
            </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, watch, onMounted } from 'vue'
import Big from 'big.js'

import CopyText from '@/components/misc/CopyText.vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import { getBitcoinAddressUrl, SATS_PER_BTC } from '@/bitcoin/networks'

export default defineComponent({
    name: 'BitcoinFungibles',
    components: { CopyText },
    props: {
        search: { type: String, default: '' },
    },
    setup() {
        const btc = useBitcoinStore()
        const error = ref('')

        const wallet = computed(() => btc.wallet)
        const isScanning = computed(() => btc.isScanning)
        const isWatchOnly = computed(() => wallet.value?.isReadonly ?? false)
        const symbol = computed(() => btc.network.native.symbol)
        const addressTypeLabel = computed(() => wallet.value?.addressTypeLabel ?? '')

        // scanEpoch is what makes everything below re-read after a scan — the
        // wallet object is held in a shallowRef and mutates internally, so
        // nothing here would otherwise know a refresh had happened.
        const balanceSats = computed(() => {
            void btc.scanEpoch
            return wallet.value?.balanceSats ?? 0
        })

        const balanceText = computed(() =>
            Big(balanceSats.value).div(SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0'
        )
        const satsText = computed(() => balanceSats.value.toLocaleString('en-US'))

        const receiveAddress = computed(() => {
            void btc.scanEpoch
            return wallet.value?.getReceiveAddress() ?? ''
        })

        const receiveUrl = computed(() =>
            receiveAddress.value ? getBitcoinAddressUrl(receiveAddress.value, btc.network) : ''
        )
        const addressUrl = (a: string) => getBitcoinAddressUrl(a, btc.network)

        const utxos = computed(() => {
            void btc.scanEpoch
            return wallet.value?.getSpendableUtxos() ?? []
        })
        const utxoCount = computed(() => utxos.value.length)
        const unconfirmedCount = computed(() => utxos.value.filter((u) => !u.confirmed).length)

        /** Only addresses actually holding value — a full list would be noise. */
        const usedAddresses = computed(() => {
            void btc.scanEpoch
            const w = wallet.value as { getScannedAddresses?: () => any[] } | null
            const all = w?.getScannedAddresses?.() ?? []
            return all
                .filter((a: any) => a.balanceSats > 0)
                .sort((a: any, b: any) => b.balanceSats - a.balanceSats)
        })

        const formatSats = (sats: number): string =>
            `${Big(sats).div(SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0'} ${
                symbol.value
            }`

        const refresh = async () => {
            error.value = ''
            try {
                await btc.refreshBalance()
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            }
        }

        onMounted(() => {
            if (!wallet.value) return
            // Only scan on mount if nothing has been loaded yet — a scan is
            // dozens of rate-limited indexer requests, not something to repeat
            // every time this tab is opened.
            if (balanceSats.value === 0 && utxoCount.value === 0) void refresh()
        })

        watch(() => btc.network.id, refresh)

        return {
            symbol,
            addressTypeLabel,
            balanceText,
            satsText,
            receiveAddress,
            receiveUrl,
            addressUrl,
            utxoCount,
            unconfirmedCount,
            usedAddresses,
            isScanning,
            isWatchOnly,
            error,
            refresh,
            formatSats,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.btc_portfolio {
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding-top: 12px;
    max-width: 720px;
}

.filter_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.type_chip {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: var(--bg-light);
    color: var(--primary-color-light);
    border-radius: 3px;
    padding: 3px 8px;
}

.refresh_but {
    background: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    color: var(--primary-color);
    cursor: pointer;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

label {
    display: block;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--primary-color-light);
    margin-bottom: 8px;
}

.balance_block {
    .amount {
        margin: 0;
        font-size: 30px;
        font-weight: 300;

        .sym {
            font-size: 18px;
            color: var(--primary-color-light);
        }
    }

    .sats {
        margin: 4px 0 0;
        font-size: 12px;
        color: var(--primary-color-light);
        font-family: monospace;
    }
}

.receive_block,
.utxo_block,
.addr_list {
    background: var(--bg-light);
    border-radius: 8px;
    padding: 16px;
}

.addr_row {
    display: flex;
    align-items: center;
    gap: 10px;
}

.mono {
    font-family: monospace;
    word-break: break-all;
}

.addr {
    color: var(--primary-color);
    text-decoration: none;
    font-size: 14px;

    &:hover {
        text-decoration: underline;
    }
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    line-height: 1.5;
    margin: 10px 0 0;
}

.watch_note {
    font-size: 13px;
    color: var(--primary-color-light);
    background: var(--bg-light);
    border-radius: 8px;
    padding: 12px 16px;

    svg {
        margin-right: 6px;
    }
}

.list_head {
    margin-bottom: 4px;
}

.addr_item {
    display: grid;
    grid-template-columns: 72px 1fr max-content;
    gap: 10px;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid var(--bg);

    .small {
        font-size: 11px;
    }

    a {
        color: var(--primary-color-light);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }

    .amt {
        text-align: right;
        color: var(--primary-color);
    }
}

.addr_col {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.scheme_note {
    font-size: 10px;
    color: var(--primary-color-light);
    opacity: 0.8;
}

.chain_tag {
    font-size: 10px;
    text-transform: uppercase;
    border-radius: 3px;
    padding: 2px 6px;
    text-align: center;
    background: var(--bg);
    color: var(--primary-color-light);

    &.change {
        opacity: 0.7;
    }
}

.error {
    font-size: 13px;
    color: var(--error);
    margin: 0;
}

@include main.mobile-device {
    .addr_item {
        grid-template-columns: 1fr;

        .amt {
            text-align: left;
        }
    }
}
</style>
