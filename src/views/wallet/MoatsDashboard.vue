<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  The AVXTO moat at a glance — everything moats.app's dashboard for it shows,
  from the same sources (see js/MoatsStats.ts): the contract, moats.app's own
  API, and DexScreener for the price.

  Works on any tab: the contract is read through a C-Chain connection of its
  own. The "Your position" panels need an EVM address, so they appear
  whenever there is an EVM signer, whichever chain it is on.

  Panels are named `moat_panel`, not `card`: Bootstrap's `.card` forces
  near-black text (the bug the burn page had).
-->
<template>
    <div class="moats_dash">
        <div class="dash_header">
            <div>
                <h1>AVXTO Moat</h1>
                <p class="desc">
                    Live statistics for the AVXTO moat on
                    <a :href="moatsAppUrl" target="_blank" rel="noopener noreferrer">moats.app</a>
                    .
                    <span v-if="api && api.config" class="tags">
                        <span class="tag status">{{ api.config.status }}</span>
                        <span
                            v-for="tag in api.config.tags"
                            :key="tag.name"
                            class="tag"
                            :style="tag.color ? { borderColor: tag.color, color: tag.color } : {}"
                        >
                            {{ tag.name }}
                        </span>
                    </span>
                </p>
            </div>
            <button type="button" class="refresh_btn" :disabled="loading" @click="load">
                <fa icon="sync" :class="{ spinning: loading }"></fa>
            </button>
        </div>

        <p v-if="chainError" class="error_msg">{{ chainError }}</p>

        <!-- ── Market ── -->
        <section v-if="market" class="moat_panel">
            <h2>Market</h2>
            <div class="tiles">
                <div class="tile">
                    <label>AVXTO price</label>
                    <p class="big">${{ price(market.priceUsd) }}</p>
                    <span :class="market.priceChange24h >= 0 ? 'up' : 'down'">
                        {{ market.priceChange24h >= 0 ? '+' : '' }}{{ market.priceChange24h.toFixed(2) }}% 24h
                    </span>
                </div>
                <div class="tile">
                    <label>Market cap</label>
                    <p>{{ usd(market.marketCapUsd) }}</p>
                </div>
                <div class="tile">
                    <label>FDV</label>
                    <p>{{ usd(market.fdvUsd) }}</p>
                </div>
                <div class="tile">
                    <label>Liquidity</label>
                    <p>{{ usd(market.liquidityUsd) }}</p>
                </div>
                <div class="tile">
                    <label>24h volume</label>
                    <p>{{ usd(market.volume24hUsd) }}</p>
                </div>
            </div>
            <a v-if="market.pairUrl" class="small_link" :href="market.pairUrl" target="_blank" rel="noopener noreferrer">
                {{ market.dex }} pair on DexScreener ↗
            </a>
        </section>

        <!-- ── Moat totals ── -->
        <section class="moat_panel">
            <h2>Moat totals</h2>
            <div v-if="moat" class="tiles">
                <div class="tile">
                    <label>Total value in moat</label>
                    <p class="big">{{ tok(moat.totalInContract) }} AVXTO</p>
                    <span v-if="market">{{ usdOf(moat.totalInContract) }}</span>
                </div>
                <div class="tile">
                    <label>Staked</label>
                    <p>{{ tok(moat.totalStaked) }} AVXTO</p>
                    <span>{{ share(moat.totalStaked, moatActive) }} of staked + locked</span>
                </div>
                <div class="tile">
                    <label>Locked</label>
                    <p>{{ tok(moat.totalLocked) }} AVXTO</p>
                    <span>{{ share(moat.totalLocked, moatActive) }} of staked + locked</span>
                </div>
                <div class="tile">
                    <label>Burned</label>
                    <p>{{ tok(moat.totalBurned) }} AVXTO</p>
                    <span v-if="market">{{ usdOf(moat.totalBurned) }} destroyed</span>
                </div>
                <div class="tile">
                    <label>Total points</label>
                    <p>{{ pts(moat.totalPoints) }}</p>
                    <span>AVXTO-weighted</span>
                </div>
                <div class="tile">
                    <label>Active users</label>
                    <p>{{ moat.activeUsers.toLocaleString() }}</p>
                </div>
                <div v-if="api && api.averageLock" class="tile">
                    <label>Average lock</label>
                    <p>{{ days(api.averageLock.seconds) }}</p>
                    <span>across {{ api.averageLock.count }} locks</span>
                </div>
            </div>
            <p v-else class="muted">{{ loading ? 'Reading the moat…' : '--' }}</p>
        </section>

        <!-- ── Your position ── -->
        <section v-if="user" class="moat_panel">
            <div class="panel_head">
                <h2>Your position</h2>
                <span class="mono muted">{{ short(user.address) }}</span>
            </div>
            <div class="tiles">
                <div class="tile">
                    <label>Wallet balance</label>
                    <p class="big">{{ tok(user.state.balance) }} AVXTO</p>
                    <span v-if="market">{{ usdOf(user.state.balance) }}</span>
                </div>
                <div class="tile">
                    <label>Staked</label>
                    <p>{{ tok(user.state.userStaked) }} AVXTO</p>
                    <router-link to="/wallet/moats/stake" class="small_link">Stake more</router-link>
                </div>
                <div class="tile">
                    <label>Locked</label>
                    <p>{{ tok(user.state.userLocked) }} AVXTO</p>
                    <router-link to="/wallet/moats/lock" class="small_link">Lock more</router-link>
                </div>
                <div class="tile">
                    <label>Burned</label>
                    <p>{{ tok(user.state.userBurned) }} AVXTO</p>
                    <router-link to="/wallet/moats/burn" class="small_link">Burn more</router-link>
                </div>
                <div class="tile">
                    <label>Your points</label>
                    <p>{{ pts(user.currentPoints) }}</p>
                    <span v-if="moat">{{ share(user.currentPoints, moat.totalPoints) }} of the moat</span>
                </div>
                <div class="tile">
                    <label>Pending rewards</label>
                    <p v-if="!user.pendingRewards.length">None</p>
                    <p v-for="r in user.pendingRewards" :key="r.address">
                        {{ fmtUnits(r.amount, r.decimals) }} {{ r.symbol }}
                    </p>
                </div>
            </div>

            <div v-if="user.state.userLocks.length" class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Lock</th>
                            <th>Amount</th>
                            <th>Duration</th>
                            <th>Multiplier</th>
                            <th>Unlocks</th>
                            <th>Leaving now costs</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="lock in user.state.userLocks" :key="lock.index">
                            <td>#{{ lock.index }}</td>
                            <td>{{ tok(lock.amount) }}</td>
                            <td>{{ days(lock.originalDuration) }}</td>
                            <td>{{ multiplier(lock.originalDuration) }}</td>
                            <td>{{ date(lock.end) }}</td>
                            <td v-if="user.earlyExit[lock.index]">
                                {{ tok(user.earlyExit[lock.index].fee) }}
                                ({{ share(user.earlyExit[lock.index].fee, lock.amount) }})
                            </td>
                            <td v-else>
                                {{ moat ? `${moat.unstakeFeeBps / 100}% (ended)` : '--' }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
        <section v-else-if="!loading" class="moat_panel">
            <h2>Your position</h2>
            <p class="muted">
                Connect an Avalanche wallet or the EVM platform to see your balance, stakes, locks
                and points here.
            </p>
        </section>

        <!-- ── moats.app points ── -->
        <section v-if="api && (api.userPoints || api.leaderboard)" class="moat_panel">
            <div class="panel_head">
                <h2>moats.app points</h2>
                <span v-if="epochLabel" class="muted">{{ epochLabel }}</span>
            </div>
            <p class="muted note">
                Reported by moats.app's API. They weigh stakes, locks and burns differently from the
                contract's own points above.
            </p>

            <div v-if="api.userPoints" class="tiles">
                <div class="tile">
                    <label>Your moats.app points</label>
                    <p class="big">{{ api.userPoints.points.toLocaleString() }}</p>
                    <span>{{ api.userPoints.boosted ? `${api.userPoints.boostMultiplier}x boost` : api.userPoints.boostReason }}</span>
                </div>
                <div v-if="userRank" class="tile">
                    <label>Rank</label>
                    <p>#{{ userRank.rank }}</p>
                    <span>{{ userRank.weight.toFixed(2) }}% of the epoch</span>
                </div>
                <div v-for="src in pointSources" :key="src.key" class="tile">
                    <label>From {{ src.label }}</label>
                    <p>{{ Math.round(api.userPoints.breakdown[src.key]).toLocaleString() }}</p>
                    <span>
                        {{ api.userPoints.breakdownPercent[src.key].toFixed(1) }}% ·
                        {{ api.userPoints.tokenAmounts[src.key].toLocaleString() }} AVXTO
                    </span>
                </div>
                <div v-if="api.mapScore" class="tile">
                    <label>MAPS score</label>
                    <p>{{ api.mapScore.score.toLocaleString() }}</p>
                    <span v-if="api.mapScore.epochNumber !== null">epoch {{ api.mapScore.epochNumber }}</span>
                </div>
            </div>

            <div v-if="api.leaderboard && api.leaderboard.entries.length" class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Holder</th>
                            <th>Points</th>
                            <th>Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="row in api.leaderboard.entries"
                            :key="row.address"
                            :class="{ me: isMe(row.address) }"
                        >
                            <td>{{ row.rank }}</td>
                            <td class="mono">
                                {{ row.username.toLowerCase() === row.address.toLowerCase() ? short(row.address) : row.username }}
                                <span v-if="isMe(row.address)" class="you">you</span>
                            </td>
                            <td>{{ row.points.toLocaleString() }}</td>
                            <td>{{ row.weight.toFixed(2) }}%</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- ── Voting epoch ── -->
        <section v-if="api && api.votingEpoch" class="moat_panel">
            <h2>Voting epoch</h2>
            <div class="tiles">
                <div class="tile">
                    <label>Epoch</label>
                    <p class="big">{{ api.votingEpoch.epochNumber }}</p>
                </div>
                <div class="tile">
                    <label>Emission</label>
                    <p>{{ api.votingEpoch.emission.toLocaleString() }}</p>
                </div>
                <div class="tile">
                    <label>Started</label>
                    <p>{{ isoDate(api.votingEpoch.startDate) }}</p>
                </div>
                <div class="tile">
                    <label>Ends</label>
                    <p>{{ isoDate(api.votingEpoch.endDate) }}</p>
                    <span>{{ timeLeft(api.votingEpoch.endDate) }}</span>
                </div>
            </div>
        </section>

        <!-- ── Rules & config ── -->
        <section v-if="moat" class="moat_panel">
            <h2>Rules &amp; configuration</h2>
            <div class="flags">
                <span v-for="flag in flags" :key="flag.label" class="flag" :class="flag.good ? 'on' : 'off'">
                    {{ flag.label }}: {{ flag.value }}
                </span>
            </div>
            <dl class="rules">
                <div>
                    <dt>Unstake / exit fee</dt>
                    <dd>{{ moat.unstakeFeeBps / 100 }}%</dd>
                </div>
                <div>
                    <dt>Early lock exit</dt>
                    <dd>up to 95%, shrinking to the exit fee as the lock ends</dd>
                </div>
                <div>
                    <dt>Lock duration</dt>
                    <dd>1 to 730 days</dd>
                </div>
                <div>
                    <dt>Points per AVXTO</dt>
                    <dd>1x staked · 2x–5x locked · 10x burned</dd>
                </div>
                <div>
                    <dt>Minimum amount</dt>
                    <dd>{{ fmtUnits(moat.minAmount, moat.token.decimals) }} AVXTO</dd>
                </div>
                <div>
                    <dt>Reward tokens</dt>
                    <dd v-if="!moat.rewardTokens.length">None configured</dd>
                    <dd v-for="r in moat.rewardTokens" :key="r.address">
                        {{ r.symbol }}: {{ fmtUnits(r.deposited, r.decimals) }} deposited,
                        {{ fmtUnits(r.claimed, r.decimals) }} claimed,
                        {{ fmtUnits(r.unallocated, r.decimals) }} unallocated
                    </dd>
                </div>
                <div v-if="api && api.config && api.config.rewardStrategy">
                    <dt>Reward strategy</dt>
                    <dd>{{ api.config.rewardStrategy }}</dd>
                </div>
                <div v-if="api && api.config">
                    <dt>Moat version</dt>
                    <dd>v{{ api.config.moatVersion }}</dd>
                </div>
                <div>
                    <dt>Contract</dt>
                    <dd><a class="mono" :href="explorer(contractAddress)" target="_blank" rel="noopener noreferrer">{{ short(contractAddress) }}</a></dd>
                </div>
                <div>
                    <dt>Owner</dt>
                    <dd><a class="mono" :href="explorer(moat.owner)" target="_blank" rel="noopener noreferrer">{{ short(moat.owner) }}</a></dd>
                </div>
                <div>
                    <dt>Fee collector</dt>
                    <dd><a class="mono" :href="explorer(moat.feeCollector)" target="_blank" rel="noopener noreferrer">{{ short(moat.feeCollector) }}</a></dd>
                </div>
            </dl>
        </section>

        <p v-if="updatedAt" class="muted updated">Updated {{ updatedAt }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { MOATS_CONTRACT_ADDRESS, lockMultiplier } from '@/js/Moats'
import {
    readAvxtoMarket,
    readMoatsApi,
    readMoatsOnChain,
    pointsAsTokens,
    type AvxtoMarket,
    type MoatsApiStats,
    type MoatsContractStats,
    type MoatsUserStats,
} from '@/js/MoatsStats'

const SNOWTRACE = 'https://snowtrace.io/address/'

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing the figures from the last visit.
    name: 'moats_dashboard',
    setup() {
        const address = computed(() => activeEvmSigner()?.address ?? null)

        const moat = ref<MoatsContractStats | null>(null)
        const user = ref<MoatsUserStats | null>(null)
        const api = ref<MoatsApiStats | null>(null)
        const market = ref<AvxtoMarket | null>(null)
        const loading = ref(false)
        const chainError = ref('')
        const updatedAt = ref('')

        let generation = 0
        const load = async () => {
            const me = address.value
            const mine = ++generation
            loading.value = true
            chainError.value = ''
            // Each source lands on its own, so a slow API never holds up the
            // on-chain figures (or the other way round).
            const onChain = readMoatsOnChain(me)
                .then((r) => {
                    if (mine !== generation) return
                    moat.value = r.moat
                    user.value = r.user
                })
                .catch((e) => {
                    console.warn('[MoatsDashboard] contract read failed:', e)
                    if (mine === generation) chainError.value = 'Could not read the Moats contract. Try refreshing.'
                })
            const offChain = readMoatsApi(me).then((r) => {
                if (mine === generation) api.value = r
            })
            const price = readAvxtoMarket().then((r) => {
                if (mine === generation) market.value = r
            })
            await Promise.all([onChain, offChain, price])
            if (mine === generation) {
                loading.value = false
                updatedAt.value = new Date().toLocaleTimeString()
            }
        }

        watch(
            address,
            () => {
                user.value = null
                load()
            },
            { immediate: true }
        )

        // ── formatting ──
        const decimals = computed(() => moat.value?.token.decimals ?? 18)
        const toNumber = (wei: BN, d: number) => Number(Big(wei.toString()).div(Big(10).pow(d)).toString())
        const fmtUnits = (wei: BN, d: number) =>
            toNumber(wei, d).toLocaleString(undefined, { maximumFractionDigits: 6 })
        const tok = (wei: BN) => toNumber(wei, decimals.value).toLocaleString(undefined, { maximumFractionDigits: 2 })
        const pts = (points: BN) =>
            moat.value
                ? Math.round(pointsAsTokens(points, moat.value.pointsScalingFactor, decimals.value)).toLocaleString()
                : '--'
        const usd = (v: number) =>
            v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: v < 100 ? 2 : 0 })
        const usdOf = (wei: BN) => (market.value ? usd(toNumber(wei, decimals.value) * market.value.priceUsd) : '')
        const price = (v: number) => v.toPrecision(4)
        const share = (part: BN, whole: BN) => {
            if (whole.isZero()) return '0%'
            return `${Big(part.toString()).div(whole.toString()).times(100).toFixed(2)}%`
        }
        const days = (sec: number) => {
            const d = sec / 86_400
            return d >= 1 ? `${Math.round(d).toLocaleString()} days` : `${Math.round(sec / 3600)} hours`
        }
        const date = (unixSec: number) =>
            new Date(unixSec * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        const isoDate = (iso: string) => (iso ? date(Date.parse(iso) / 1000) : '--')
        const timeLeft = (iso: string) => {
            const ms = Date.parse(iso) - Date.now()
            if (!Number.isFinite(ms) || ms <= 0) return 'ended'
            const d = Math.floor(ms / 86_400_000)
            const h = Math.floor((ms % 86_400_000) / 3_600_000)
            return `${d}d ${h}h left`
        }
        const multiplier = (sec: number) => `${lockMultiplier(sec).toFixed(2).replace(/\.?0+$/, '')}x`
        const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
        const explorer = (a: string) => SNOWTRACE + a
        const isMe = (a: string) => !!address.value && a.toLowerCase() === address.value.toLowerCase()

        const moatActive = computed(() =>
            moat.value ? moat.value.totalStaked.add(moat.value.totalLocked) : new BN(0)
        )
        const userRank = computed(
            () => api.value?.leaderboard?.entries.find((r) => isMe(r.address)) ?? null
        )
        const epochLabel = computed(() => {
            const e = api.value?.userPoints?.currentEpoch ?? api.value?.leaderboard?.epoch
            return e ? `Epoch ${e.epochNumber}${e.isComplete ? ' (complete)' : ''}` : ''
        })
        const pointSources = [
            { key: 'staked' as const, label: 'staking' },
            { key: 'locked' as const, label: 'locks' },
            { key: 'burnt' as const, label: 'burns' },
        ]
        const flags = computed(() => {
            const m = moat.value
            if (!m) return []
            const yes = (b: boolean) => (b ? 'on' : 'off')
            return [
                { label: 'Staking', value: yes(m.stakingEnabled), good: m.stakingEnabled },
                { label: 'Locking', value: yes(m.lockingEnabled), good: m.lockingEnabled },
                { label: 'Burning', value: yes(m.burningEnabled), good: m.burningEnabled },
                { label: 'Early exit', value: yes(m.earlyExitEnabled), good: m.earlyExitEnabled },
                { label: 'Emergency unlock', value: yes(m.emergencyUnlockEnabled), good: !m.emergencyUnlockEnabled },
                { label: 'Paused', value: m.paused ? 'yes' : 'no', good: !m.paused },
            ]
        })

        return {
            moat,
            user,
            api,
            market,
            loading,
            chainError,
            updatedAt,
            load,
            moatActive,
            userRank,
            epochLabel,
            pointSources,
            flags,
            contractAddress: MOATS_CONTRACT_ADDRESS,
            moatsAppUrl: `https://moats.app/moat/${MOATS_CONTRACT_ADDRESS}`,
            fmtUnits,
            tok,
            pts,
            usd,
            usdOf,
            price,
            share,
            days,
            date,
            isoDate,
            timeLeft,
            multiplier,
            short,
            explorer,
            isMe,
        }
    },
})
</script>

<style lang="scss" scoped>
.moats_dash {
    max-width: 980px;
    color: var(--primary-color);

    .desc {
        color: var(--primary-color-light);
        line-height: 1.6;

        a {
            color: var(--secondary-color);
        }
    }
}

.dash_header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 20px;

    h1 {
        margin-bottom: 6px;
    }
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

.tags {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: 8px;
    vertical-align: middle;
}

.tag {
    border: 1px solid var(--primary-color-light);
    border-radius: 10px;
    padding: 0 8px;
    font-size: 11px;
    line-height: 18px;

    &.status {
        border-color: var(--success);
        color: var(--success);
    }
}

.moat_panel {
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

.panel_head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;

    h2 {
        margin-bottom: 14px;
    }
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: 12px;
}

.tile {
    background: var(--bg);
    border-radius: 8px;
    padding: 12px 14px;
    min-width: 0;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }

    p {
        font-size: 15px;
        font-weight: 600;
        margin-top: 4px !important;
        word-break: break-word;
    }

    .big {
        font-size: 19px;
    }

    span {
        display: block;
        margin-top: 2px;
        font-size: 12px;
        color: var(--primary-color-light);
    }

    .up {
        color: var(--success);
    }

    .down {
        color: var(--error);
    }
}

.small_link {
    display: inline-block;
    margin-top: 10px;
    font-size: 12px;
    color: var(--secondary-color) !important;
}

.tile .small_link {
    margin-top: 4px;
}

.table_wrap {
    margin-top: 16px;
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
    color: var(--primary-color);

    th {
        text-align: left;
        font-weight: 600;
        font-size: 12px;
        color: var(--primary-color-light);
        padding: 6px 10px;
        border-bottom: 1px solid var(--bg);
        white-space: nowrap;
    }

    td {
        padding: 8px 10px;
        border-bottom: 1px solid var(--bg);
        white-space: nowrap;
    }

    tr.me td {
        background: rgba(var(--info-1), 0.15);
    }

    .you {
        margin-left: 6px;
        font-size: 11px;
        color: var(--secondary-color);
    }
}

.flags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
}

.flag {
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 12px;

    &.on {
        background: rgba(107, 198, 136, 0.15);
        color: var(--success);
    }

    &.off {
        background: rgba(232, 73, 112, 0.15);
        color: var(--error);
    }
}

.rules {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px 24px;
    margin: 0;

    dt {
        font-size: 12px;
        color: var(--primary-color-light);
        font-weight: 400;
    }

    dd {
        margin: 2px 0 0;
        font-size: 14px;
    }

    a {
        color: var(--secondary-color);
    }
}

.mono {
    font-family: monospace;
}

.muted {
    color: var(--primary-color-light);
    font-size: 13px;
}

.note {
    margin-bottom: 12px !important;
}

.updated {
    text-align: right;
    font-size: 12px;
}

.error_msg {
    color: var(--error);
    margin-bottom: 12px !important;
}
</style>
