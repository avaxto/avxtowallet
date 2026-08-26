<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="sol_fungibles">
        <div class="filter_row">
            <label class="toggle">
                <input type="checkbox" v-model="hideUnverified" />
                Hide unrecognised tokens
                <span class="count" v-if="unverifiedCount">({{ unverifiedCount }})</span>
            </label>
            <button class="refresh_but" @click="refresh" :disabled="loading">
                <fa icon="sync"></fa>
                Refresh
            </button>
        </div>

        <div class="headers">
            <p class="name_col">Asset</p>
            <p class="tag_col"></p>
            <p class="balance_col">Balance</p>
        </div>

        <div class="scrollable no_scroll_bar">
            <div v-for="row in visibleRows" :key="row.key" class="asset row">
                <div class="name_col">
                    <p class="name">
                        {{ row.name }}
                        <span class="sym">({{ row.symbol }})</span>
                        <span v-if="row.isNative" class="native_tag">native</span>
                    </p>
                    <a
                        v-if="!row.isNative"
                        :href="mintLink(row.mint)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="addr"
                    >
                        {{ shortenMint(row.mint) }}
                    </a>
                </div>

                <div class="tag_col">
                    <!--
                      "unrecognised" is the absence of an opinion, not an
                      accusation, and must not look like one — most legitimate
                      tokens are unregistered. It is styled as a quiet neutral
                      chip rather than a warning.
                    -->
                    <span
                        v-if="row.isUnverified"
                        class="tag unknown"
                        title="Not in this wallet's pinned token list, so its name is shown as its mint address rather than a ticker it supplied. Normal for most tokens."
                    >
                        unrecognised
                    </span>
                    <span v-if="row.isToken2022" class="tag t22" title="Token-2022 program mint">
                        token-2022
                    </span>
                </div>

                <div class="balance_col">
                    <p>{{ formatAmount(row.amount) }}</p>
                </div>
            </div>

            <div v-if="loading && !visibleRows.length" class="empty">
                <Spinner class="spinner"></Spinner>
                <p>Reading balances…</p>
            </div>
            <div v-else-if="error" class="empty err">
                <p>{{ error }}</p>
                <button class="refresh_but" @click="refresh">Try again</button>
            </div>
            <div v-else-if="!visibleRows.length" class="empty">
                <p v-if="hideUnverified && unverifiedCount">
                    Only unrecognised tokens found — untick the filter above to see them.
                </p>
                <p v-else>No assets in this wallet.</p>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
/**
 * The Solana platform's asset list.
 *
 * Separate from `Fungibles.vue` (Avalanche X/P assets) and `EvmFungibles.vue`
 * (multi-network ERC-20 scan) for the same reason those are separate from each
 * other: the asset model differs. Here a holding is an SPL token account
 * keyed by mint, there is exactly one network in play, and the thing worth
 * surfacing per row is provenance — whether the mint is one this wallet pins.
 *
 * Names and symbols shown here always come from the pinned registry or from
 * the mint address itself, never from chain metadata, so no row can display a
 * ticker an attacker chose. See the note in solana/tokens.ts.
 */
import { defineComponent, computed, ref, watch, onMounted } from 'vue'
import Big from 'big.js'

import Spinner from '@/components/misc/Spinner.vue'
import { useSolanaStore } from '@/platforms/solana/store'
import {
    readSolBalance,
    readSplBalances,
    shortenMint,
    type SolanaTokenBalance,
} from '@/solana/tokens'
import { getSolanaAddressUrl } from '@/solana/networks'

interface Row {
    key: string
    mint: string
    symbol: string
    name: string
    amount: Big
    isNative: boolean
    isUnverified: boolean
    isToken2022: boolean
}

export default defineComponent({
    name: 'SolanaFungibles',
    components: { Spinner },
    props: {
        search: { type: String, default: '' },
    },
    setup(props) {
        const solanaStore = useSolanaStore()

        const tokens = ref<SolanaTokenBalance[]>([])
        const solBalance = ref<Big>(Big(0))
        const loading = ref(false)
        const error = ref('')
        // Defaults to showing everything: hiding tokens by default would mean
        // a real airdrop or a newly-listed token silently missing from the
        // portfolio, which is worse than a slightly noisier list.
        const hideUnverified = ref(false)

        const address = computed(() => solanaStore.wallet?.getPrimaryAddress() ?? null)

        const refresh = async (): Promise<void> => {
            const addr = address.value
            if (!addr) {
                tokens.value = []
                solBalance.value = Big(0)
                return
            }
            loading.value = true
            error.value = ''
            try {
                const [sol, spl] = await Promise.all([
                    readSolBalance(addr, solanaStore.network),
                    readSplBalances(addr, solanaStore.network),
                ])
                solBalance.value = sol
                tokens.value = spl
            } catch (e: any) {
                error.value = e?.message ?? String(e)
            } finally {
                loading.value = false
            }
        }

        onMounted(refresh)
        // Re-read on both a wallet change and a cluster change — the same
        // address holds entirely different balances on devnet.
        watch(() => [address.value, solanaStore.network.id], refresh)

        const allRows = computed((): Row[] => {
            const native: Row = {
                key: 'native',
                mint: '',
                symbol: solanaStore.network.native.symbol,
                name: solanaStore.network.native.name,
                amount: solBalance.value,
                isNative: true,
                isUnverified: false,
                isToken2022: false,
            }
            return [
                native,
                ...tokens.value.map((t) => ({
                    key: t.mint,
                    mint: t.mint,
                    symbol: t.symbol,
                    name: t.name,
                    amount: t.amount,
                    isNative: false,
                    isUnverified: t.isUnverified,
                    isToken2022: t.isToken2022,
                })),
            ]
        })

        const unverifiedCount = computed(
            () => allRows.value.filter((r) => r.isUnverified).length
        )

        const visibleRows = computed((): Row[] => {
            const q = props.search.trim().toLowerCase()
            return allRows.value.filter((r) => {
                // The native row is never filtered out by the "unrecognised"
                // toggle — SOL is the one balance that must always be visible.
                if (hideUnverified.value && r.isUnverified && !r.isNative) return false
                if (!q) return true
                return (
                    r.symbol.toLowerCase().includes(q) ||
                    r.name.toLowerCase().includes(q) ||
                    r.mint.toLowerCase().includes(q)
                )
            })
        })

        const formatAmount = (amount: Big): string => {
            // Big's toString gives exponential notation for very small values;
            // toFixed keeps it readable, then trailing zeros come off.
            const s = amount.toFixed(9).replace(/\.?0+$/, '')
            return s === '' || s === '-' ? '0' : s
        }

        const mintLink = (mint: string): string =>
            getSolanaAddressUrl(mint, solanaStore.network)


        return {
            loading,
            error,
            hideUnverified,
            unverifiedCount,
            visibleRows,
            refresh,
            formatAmount,
            shortenMint,
            mintLink,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.sol_fungibles {
    display: flex;
    flex-direction: column;
}

.filter_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 0;
    font-size: 13px;

    .toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--primary-color-light);
        cursor: pointer;

        .count {
            opacity: 0.7;
        }
    }
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

.headers,
.row {
    display: grid;
    grid-template-columns: 1fr max-content 160px;
    gap: 12px;
    align-items: center;
}

.headers {
    padding: 8px 0;
    border-bottom: 1px solid var(--bg-light);

    p {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: var(--primary-color-light);
        margin: 0;
    }
}

.balance_col {
    text-align: right;
    font-family: monospace;
    word-break: break-all;
}

.row {
    padding: 12px 0;
    border-bottom: 1px solid var(--bg-light);

    .name {
        margin: 0;
        font-size: 14px;

        .sym {
            color: var(--primary-color-light);
            font-size: 13px;
        }
    }

    .addr {
        font-family: monospace;
        font-size: 11px;
        color: var(--primary-color-light);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}

.native_tag {
    font-size: 10px;
    text-transform: uppercase;
    background: var(--bg-light);
    border-radius: 3px;
    padding: 1px 5px;
    margin-left: 6px;
    color: var(--primary-color-light);
}

.tag_col {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;

    &.unknown {
        background: var(--bg-light);
        color: var(--primary-color-light);
    }

    &.t22 {
        background: var(--bg-light);
        color: var(--primary-color-light);
        opacity: 0.8;
    }

}

.scrollable {
    max-height: 60vh;
    overflow-y: auto;
}

.empty {
    text-align: center;
    padding: 40px 0;
    color: var(--primary-color-light);
    font-size: 13px;

    &.err {
        color: var(--error);
    }

    .spinner {
        width: 26px;
        margin: 0 auto 12px;
    }
}

@include main.mobile-device {
    .headers,
    .row {
        grid-template-columns: 1fr max-content;
    }

    .balance_col {
        grid-column: 1 / -1;
        text-align: left;
    }
}
</style>
