<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The newest ArenaTrade launches, like arenatrade.ai's "New" tab, but read
  from the chain (Arena's TokenManager) rather than ArenaTrade's private API —
  see js/ArenaSniper.ts. Sortable by age, transactions and volume.

  Works on any tab: it reads C-Chain through its own connection and needs no
  wallet at all.

  Panels are `sniper_panel`, not `card`: Bootstrap's `.card` forces
  near-black text on this dark theme.
-->
<template>
    <div class="sniper_page">
        <div class="head">
            <div>
                <h1>ArenaTrade Sniper</h1>
                <p class="desc">
                    The newest tokens launched on
                    <a href="https://arenatrade.ai/" target="_blank" rel="noopener noreferrer">ArenaTrade</a>
                    , read live from Arena's launch contract on Avalanche C-Chain.
                </p>
            </div>
            <div class="controls">
                <label class="live_toggle">
                    <input v-model="live" type="checkbox" />
                    Live
                </label>
                <button type="button" class="refresh_btn" :disabled="busy" title="Refresh" @click="refresh">
                    <fa icon="sync" :class="{ spinning: busy }"></fa>
                </button>
            </div>
        </div>

        <div class="sort_bar" role="group" aria-label="Sort by">
            <span class="sort_label">Sort by</span>
            <button
                v-for="opt in sortOptions"
                :key="opt.key"
                type="button"
                class="sort_btn"
                :class="{ selected: sortBy === opt.key }"
                :aria-pressed="sortBy === opt.key"
                @click="sortBy = opt.key"
            >
                {{ opt.label }}
            </button>
        </div>

        <p v-if="error" class="error_msg">{{ error }}</p>

        <section class="sniper_panel">
            <p v-if="!tokens.length && busy" class="muted">Scanning the latest launches…</p>
            <p v-else-if="!tokens.length" class="muted">No launches found.</p>

            <div v-else class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Token</th>
                            <th class="num">Age</th>
                            <th class="num">Transactions</th>
                            <th class="num">Volume</th>
                            <th>Creator</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="t in sorted" :key="t.tokenId" :class="{ fresh: freshIds.has(t.tokenId) }">
                            <td class="token">
                                <span class="symbol">{{ t.symbol || '?' }}</span>
                                <span class="name">{{ t.name || short(t.address) }}</span>
                                <span v-if="t.graduated" class="grad" title="Moved to a DEX pool; figures cover bonding-curve trades only">
                                    graduated
                                </span>
                            </td>
                            <td class="num" :title="t.createdAt ? new Date(t.createdAt * 1000).toLocaleString() : ''">
                                {{ age(t.createdAt) }}
                            </td>
                            <td class="num">
                                <span class="txs">{{ t.buys + t.sells }}</span>
                                <span class="split">
                                    <span class="buys">{{ t.buys }}B</span> /
                                    <span class="sells">{{ t.sells }}S</span>
                                </span>
                            </td>
                            <td class="num">
                                <span>{{ avax(t.volumeWei) }} AVAX</span>
                                <span v-if="avaxUsd" class="usd">{{ usd(t.volumeWei) }}</span>
                            </td>
                            <td>
                                <a class="mono" :href="explorer(t.creator)" target="_blank" rel="noopener noreferrer">
                                    {{ short(t.creator) }}
                                </a>
                            </td>
                            <td class="links">
                                <a :href="arenaUrl(t.address)" target="_blank" rel="noopener noreferrer">ArenaTrade ↗</a>
                                <a :href="explorer(t.address)" target="_blank" rel="noopener noreferrer">Contract ↗</a>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="tokens.length" class="footer">
                <button type="button" class="more_btn" :disabled="busy" @click="loadMore">
                    Load {{ PAGE }} more
                </button>
                <span class="muted">
                    {{ tokens.length }} newest launches
                    <template v-if="updatedAt">· updated {{ updatedAt }}</template>
                </span>
            </div>
        </section>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onUnmounted } from 'vue'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { useMainStore } from '@/stores'
import {
    ArenaSniperFeed,
    sortSniperTokens,
    type SniperSort,
    type SniperToken,
} from '@/js/ArenaSniper'

const PAGE = 25
const LIVE_INTERVAL_MS = 20_000
/** How long a launch that arrived on a refresh stays highlighted. */
const FRESH_MS = 60_000

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing a stale list and keep its live timer running.
    name: 'arena_sniper',
    setup() {
        const mainStore = useMainStore()

        const sortOptions: { key: SniperSort; label: string }[] = [
            { key: 'age', label: 'Age' },
            { key: 'transactions', label: 'Transactions' },
            { key: 'volume', label: 'Volume' },
        ]
        const sortBy = ref<SniperSort>('age')

        let feed = new ArenaSniperFeed()
        const limit = ref(PAGE)
        const tokens = ref<SniperToken[]>([])
        const busy = ref(false)
        const error = ref('')
        const updatedAt = ref('')
        const live = ref(true)
        const freshIds = ref(new Set<string>())
        /** Ticks every few seconds so the ages stay current. */
        const now = ref(Date.now())

        const sorted = computed(() => sortSniperTokens(tokens.value, sortBy.value))

        const settle = (list: SniperToken[]) => {
            // New objects, so Vue re-renders counters the feed updated in place.
            tokens.value = list.map((t) => ({ ...t }))
            updatedAt.value = new Date().toLocaleTimeString()
        }

        const load = async () => {
            busy.value = true
            error.value = ''
            try {
                feed = new ArenaSniperFeed()
                settle(await feed.loadNewest(limit.value))
            } catch (e) {
                console.warn('[ArenaSniper] load failed:', e)
                error.value = 'Could not read ArenaTrade launches from the chain. Try refreshing.'
            } finally {
                busy.value = false
            }
        }

        const refresh = async () => {
            if (busy.value) return
            if (!tokens.value.length) return load()
            busy.value = true
            error.value = ''
            try {
                const before = new Set(tokens.value.map((t) => t.tokenId))
                const list = await feed.refresh()
                const arrived = list.filter((t) => !before.has(t.tokenId)).map((t) => t.tokenId)
                if (arrived.length) {
                    freshIds.value = new Set([...freshIds.value, ...arrived])
                    setTimeout(() => {
                        const next = new Set(freshIds.value)
                        arrived.forEach((id) => next.delete(id))
                        freshIds.value = next
                    }, FRESH_MS)
                }
                settle(list)
            } catch (e) {
                console.warn('[ArenaSniper] refresh failed:', e)
                error.value = 'Could not refresh — showing the last figures read.'
            } finally {
                busy.value = false
            }
        }

        const loadMore = async () => {
            limit.value += PAGE
            await load()
        }

        let liveTimer: ReturnType<typeof setInterval> | null = null
        let clockTimer: ReturnType<typeof setInterval> | null = null
        const setLive = (on: boolean) => {
            if (liveTimer) clearInterval(liveTimer)
            liveTimer = on ? setInterval(refresh, LIVE_INTERVAL_MS) : null
        }
        watch(live, setLive)

        onMounted(() => {
            load()
            setLive(live.value)
            clockTimer = setInterval(() => (now.value = Date.now()), 5_000)
        })
        onUnmounted(() => {
            setLive(false)
            if (clockTimer) clearInterval(clockTimer)
        })

        // ── formatting ──
        const avaxUsd = computed(() => {
            const p = Number((mainStore.prices as any)?.usd)
            return Number.isFinite(p) && p > 0 ? p : 0
        })
        const toAvax = (wei: BN) => Number(Big(wei.toString()).div(Big(10).pow(18)).toString())
        const avax = (wei: BN) => {
            const v = toAvax(wei)
            return v.toLocaleString(undefined, { maximumFractionDigits: v < 10 ? 3 : 1 })
        }
        const usd = (wei: BN) =>
            (toAvax(wei) * avaxUsd.value).toLocaleString(undefined, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
            })
        const age = (createdAt: number) => {
            if (!createdAt) return '…'
            const s = Math.max(0, Math.floor(now.value / 1000 - createdAt))
            if (s < 60) return `${s}s`
            if (s < 3600) return `${Math.floor(s / 60)}m`
            if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
            return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
        }
        const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
        const explorer = (a: string) => `https://snowtrace.io/address/${a}`
        const arenaUrl = (a: string) => `https://arenatrade.ai/token/${a}`

        return {
            PAGE,
            sortOptions,
            sortBy,
            tokens,
            sorted,
            busy,
            error,
            updatedAt,
            live,
            freshIds,
            avaxUsd,
            refresh,
            loadMore,
            avax,
            usd,
            age,
            short,
            explorer,
            arenaUrl,
        }
    },
})
</script>

<style lang="scss" scoped>
.sniper_page {
    max-width: 1100px;
    color: var(--primary-color);

    .desc {
        color: var(--primary-color-light);
        line-height: 1.6;

        a {
            color: var(--secondary-color);
        }
    }
}

.head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 14px;

    h1 {
        margin-bottom: 6px;
    }
}

.controls {
    display: flex;
    align-items: center;
    gap: 14px;
}

.live_toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--primary-color-light);
    cursor: pointer;
}

.refresh_btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--primary-color-light);
    font-size: 16px;
    padding: 6px;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .spinning {
        animation: spin 1s linear infinite;
    }
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

.sort_bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
}

.sort_label {
    font-size: 13px;
    color: var(--primary-color-light);
    margin-right: 4px;
}

.sort_btn {
    border: 1px solid var(--bg-light);
    background: var(--bg-light);
    color: var(--primary-color);
    border-radius: 16px;
    padding: 5px 14px;
    font-size: 13px;
    cursor: pointer;

    &.selected {
        border-color: var(--secondary-color);
        background: var(--secondary-color);
        color: var(--platform-on-accent, #fff) !important;
    }
}

.sniper_panel {
    background: var(--bg-light);
    border-radius: 12px;
    padding: 12px 16px;
    color: var(--primary-color);
}

.table_wrap {
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: var(--primary-color);

    th {
        text-align: left;
        font-size: 12px;
        font-weight: 600;
        color: var(--primary-color-light);
        padding: 8px 10px;
        border-bottom: 1px solid var(--bg);
        white-space: nowrap;
    }

    td {
        padding: 9px 10px;
        border-bottom: 1px solid var(--bg);
        white-space: nowrap;
        vertical-align: middle;
    }

    .num {
        text-align: right;
    }

    tr.fresh td {
        background: rgba(var(--info-1), 0.18);
    }

    a {
        color: var(--secondary-color);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}

.token {
    .symbol {
        font-weight: 700;
        margin-right: 8px;
    }

    .name {
        color: var(--primary-color-light);
    }

    .grad {
        margin-left: 8px;
        font-size: 11px;
        padding: 1px 7px;
        border-radius: 10px;
        border: 1px solid var(--success);
        color: var(--success);
    }
}

.txs {
    font-weight: 700;
    margin-right: 6px;
}

.split {
    font-size: 11px;
    color: var(--primary-color-light);

    .buys {
        color: var(--success);
    }

    .sells {
        color: var(--error);
    }
}

.usd {
    display: block;
    font-size: 11px;
    color: var(--primary-color-light);
}

.links a + a {
    margin-left: 12px;
}

.mono {
    font-family: monospace;
}

.footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 12px 4px 4px;
}

.more_btn {
    border: 1px solid var(--primary-color-light);
    background: transparent;
    color: var(--primary-color);
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;

    &:disabled {
        opacity: 0.5;
        cursor: default;
    }
}

.muted {
    color: var(--primary-color-light);
    font-size: 13px;
}

.error_msg {
    color: var(--error);
    margin-bottom: 12px !important;
}
</style>
