<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Pharaoh's AutoVault at a glance — what phar.gg's AutoVault page shows, from
  the same sources (see js/PharAutoVault.ts): the vault, xPHAR, Minter and
  Voter contracts, and Pharaoh's API for prices, protocol figures and pools.

  Works on any tab: the contracts are read through a C-Chain connection of its
  own. "Your position" needs an EVM address, so it appears whenever there is an
  EVM signer, whichever chain it is on.

  Panels are named `phar_panel`, not `card`: Bootstrap's `.card` forces
  near-black text.
-->
<template>
    <div class="phar_dash">
        <div class="dash_header">
            <div>
                <h1>Pharaoh AutoVault</h1>
                <p class="desc">
                    Deposit xPHAR once; the vault votes with it every epoch and pays the voting rewards
                    out in the token you choose. Live figures from the vault and
                    <a :href="appUrl" target="_blank" rel="noopener noreferrer">phar.gg</a>.
                </p>
            </div>
            <button type="button" class="refresh_btn" :disabled="loading" title="Refresh" @click="load">
                <fa icon="sync" :class="{ spinning: loading }"></fa>
            </button>
        </div>

        <p v-if="chainError" class="error_msg">{{ chainError }}</p>

        <!-- ── Your position ── -->
        <section v-if="user && vault" class="phar_panel">
            <div class="panel_head">
                <h2>Your position</h2>
                <span class="mono muted">{{ short(user.address) }}</span>
            </div>
            <div class="tiles">
                <div class="tile">
                    <label>Deposited</label>
                    <p class="big">{{ amt(user.shares, 18) }} xPHAR</p>
                    <span v-if="xpharPrice">{{ usd(units(user.shares, 18) * xpharPrice) }}</span>
                </div>
                <div class="tile">
                    <label>Share of the vault</label>
                    <p>{{ pct(user.shares, vault.totalShares, 4) }}</p>
                </div>
                <div class="tile">
                    <label>Paid out in</label>
                    <p>{{ sym(user.outputPreference) }}</p>
                    <span v-if="user.shares.isZero()">no deposit</span>
                </div>
                <div class="tile">
                    <label>Claimable</label>
                    <p>{{ amt(user.earned, dec(user.outputPreference)) }} {{ sym(user.outputPreference) }}</p>
                    <span v-if="valueOf(user.earned, user.outputPreference) && !user.earned.isZero()">
                        {{ valueOf(user.earned, user.outputPreference) }}
                    </span>
                    <span v-else-if="user.earned.isZero()">nothing to claim right now</span>
                </div>
                <div class="tile">
                    <label>xPHAR in wallet</label>
                    <p>{{ amt(user.xpharBalance, 18) }}</p>
                    <span v-if="xpharPrice && !user.xpharBalance.isZero()">
                        {{ usd(units(user.xpharBalance, 18) * xpharPrice) }}
                    </span>
                </div>
                <div class="tile">
                    <label>Vault allowance</label>
                    <p>{{ allowanceText }}</p>
                    <span>xPHAR the vault may take on deposit</span>
                </div>
            </div>
            <a :href="appUrl" target="_blank" rel="noopener noreferrer" class="small_link">
                Deposit, withdraw or claim on phar.gg ↗
            </a>
        </section>
        <section v-else-if="!loading && vault" class="phar_panel">
            <h2>Your position</h2>
            <p class="muted">Connect an Avalanche wallet or the EVM platform to see your deposit and rewards.</p>
        </section>

        <!-- ── Vault ── -->
        <section class="phar_panel">
            <h2>Vault</h2>
            <div v-if="vault" class="tiles">
                <div class="tile">
                    <label>Total deposited</label>
                    <p class="big">{{ amt(vault.totalShares, 18) }} xPHAR</p>
                    <span v-if="xpharPrice">{{ usd(units(vault.totalShares, 18) * xpharPrice) }}</span>
                </div>
                <div class="tile">
                    <label>Of all xPHAR</label>
                    <p>{{ pct(vault.totalShares, vault.xpharTotalSupply, 2) }}</p>
                </div>
                <div class="tile">
                    <label>Status</label>
                    <p :class="vault.isUnlocked ? 'up' : 'down'">{{ vault.isUnlocked ? 'Unlocked' : 'Locked' }}</p>
                    <span>{{ vault.isUnlocked ? 'deposits and withdrawals open' : 'locked by the operator this epoch' }}</span>
                </div>
                <div class="tile">
                    <label>Epoch</label>
                    <p>{{ vault.period }}</p>
                    <span>next in {{ timeLeft(periodStart(vault.period + 1)) }}</span>
                </div>
                <div class="tile">
                    <label>Queued reward swaps</label>
                    <p>{{ vault.pendingSwaps.length }}</p>
                </div>
                <div class="tile">
                    <label>Reward tokens claimed</label>
                    <p>{{ vault.claimedInputTokens.length }}</p>
                    <span>voting rewards to swap into payouts</span>
                </div>
            </div>
            <p v-else class="muted">{{ loading ? 'Reading the vault…' : '--' }}</p>

            <div v-if="vault && vault.outputs.length" class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Payout token</th>
                            <th>Deposits choosing it</th>
                            <th>Share</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="o in vault.outputs" :key="o.token" :class="{ me: isMyOutput(o.token) }">
                            <td>
                                {{ sym(o.token) }}
                                <span v-if="isMyOutput(o.token)" class="you">yours</span>
                            </td>
                            <td>{{ amt(o.shares, 18) }} xPHAR</td>
                            <td>{{ pct(o.shares, vault.totalShares, 2) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="vault && vault.pendingSwaps.length" class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Queued swap</th>
                            <th>Amount</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="(s, i) in vault.pendingSwaps" :key="i">
                            <td>{{ sym(s.input) }} → {{ sym(s.output) }}</td>
                            <td>{{ amt(s.amount, dec(s.input)) }} {{ sym(s.input) }}</td>
                            <td>{{ valueOf(s.amount, s.input) || '--' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- ── Votes ── -->
        <section v-if="vault && (vault.votesThisPeriod.length || vault.votesNextPeriod.length)" class="phar_panel">
            <div class="panel_head">
                <h2>Vault votes</h2>
                <div class="toggle" role="group">
                    <button type="button" :class="{ selected: !showNext }" @click="showNext = false">
                        Epoch {{ vault.period }}
                    </button>
                    <button type="button" :class="{ selected: showNext }" @click="showNext = true">
                        Epoch {{ vault.period + 1 }}
                    </button>
                </div>
            </div>
            <p class="muted note">
                How the vault splits its votes across pools. Your part of each vote follows your share of the
                vault.
            </p>
            <div class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Pool</th>
                            <th>Vault votes</th>
                            <th>Share</th>
                            <th v-if="user && !user.shares.isZero()">Your part</th>
                            <th>Vote APR</th>
                            <th>Pool TVL</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="v in shownVotes" :key="v.pool">
                            <td>
                                <span :class="{ mono: !poolOf(v.pool) }">{{ poolName(v.pool) }}</span>
                            </td>
                            <td>{{ amt(v.weight, 18) }}</td>
                            <td>{{ pct(v.weight, shownVotesTotal, 2) }}</td>
                            <td v-if="user && !user.shares.isZero()">{{ amt(myPart(v.weight), 18) }}</td>
                            <td>{{ poolApr(v.pool) }}</td>
                            <td>{{ poolTvl(v.pool) }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- ── Protocol ── -->
        <section v-if="protocol" class="phar_panel">
            <h2>Pharaoh</h2>
            <div class="tiles">
                <div class="tile">
                    <label>PHAR price</label>
                    <p class="big">${{ protocol.pharPriceUSD.toPrecision(4) }}</p>
                </div>
                <div class="tile">
                    <label>PHAR circulating</label>
                    <p>{{ n(protocol.pharCirculating) }}</p>
                    <span>{{ usd(protocol.pharCirculatingUSD) }}</span>
                </div>
                <div class="tile">
                    <label>xPHAR staked</label>
                    <p>{{ n(protocol.xpharStaked) }}</p>
                    <span>{{ usd(protocol.xpharStakedUSD) }}</span>
                </div>
                <div class="tile">
                    <label>Voted this epoch</label>
                    <p>{{ (protocol.pctVoted * 100).toFixed(1) }}%</p>
                    <span>{{ n(protocol.totalVotes) }} xPHAR</span>
                </div>
                <div class="tile">
                    <label>Voter rewards</label>
                    <p>{{ usd(protocol.voterRewardsUSD) }}</p>
                    <span>this epoch</span>
                </div>
                <div class="tile">
                    <label>Emissions</label>
                    <p>{{ n(protocol.currentEpochEmissions) }} PHAR</p>
                    <span>{{ usd(protocol.currentEpochEmissionsUSD) }} this epoch</span>
                </div>
                <div class="tile">
                    <label>Next epoch emissions</label>
                    <p>{{ n(protocol.nextEpochEmissions) }} PHAR</p>
                    <span>{{ usd(protocol.nextEpochEmissionsUSD) }}</span>
                </div>
                <div class="tile">
                    <label>PHAR total supply</label>
                    <p>{{ n(protocol.pharTotalSupply) }}</p>
                </div>
            </div>
        </section>

        <!-- ── Contracts ── -->
        <section v-if="vault" class="phar_panel">
            <h2>Contracts &amp; rules</h2>
            <dl class="rules">
                <div>
                    <dt>xPHAR instant exit to PHAR</dt>
                    <dd>{{ (vault.xpharExitPenalty * 100).toFixed(0) }}% penalty</dd>
                </div>
                <div>
                    <dt>Weekly emissions (Minter)</dt>
                    <dd>{{ amt(vault.weeklyEmissions, 18) }} PHAR</dd>
                </div>
                <div>
                    <dt>AutoVault</dt>
                    <dd><a class="mono" :href="explorer(addrs.vault)" target="_blank" rel="noopener noreferrer">{{ short(addrs.vault) }}</a></dd>
                </div>
                <div>
                    <dt>xPHAR</dt>
                    <dd><a class="mono" :href="explorer(addrs.xphar)" target="_blank" rel="noopener noreferrer">{{ short(addrs.xphar) }}</a></dd>
                </div>
                <div>
                    <dt>Voter</dt>
                    <dd><a class="mono" :href="explorer(addrs.voter)" target="_blank" rel="noopener noreferrer">{{ short(addrs.voter) }}</a></dd>
                </div>
                <div>
                    <dt>Minter</dt>
                    <dd><a class="mono" :href="explorer(addrs.minter)" target="_blank" rel="noopener noreferrer">{{ short(addrs.minter) }}</a></dd>
                </div>
                <div>
                    <dt>Vault operator</dt>
                    <dd><a class="mono" :href="explorer(vault.operator)" target="_blank" rel="noopener noreferrer">{{ short(vault.operator) }}</a></dd>
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
import {
    AUTOVAULT_ADDRESS,
    AUTOVAULT_APP_URL,
    PHAR_MINTER_ADDRESS,
    PHAR_VOTER_ADDRESS,
    XPHAR_ADDRESS,
    periodStart,
    readAutoVaultOnChain,
    readPharaohApi,
    readTokenInfo,
    type AutoVaultStats,
    type AutoVaultUser,
    type PharPool,
    type PharProtocolInfo,
    type TokenInfo,
} from '@/js/PharAutoVault'

const SNOWTRACE = 'https://snowtrace.io/address/'
const MAX_UINT = new BN(2).pow(new BN(256)).sub(new BN(1))

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing the figures from the last visit.
    name: 'phar_autovault',
    setup() {
        const address = computed(() => activeEvmSigner()?.address ?? null)

        const vault = ref<AutoVaultStats | null>(null)
        const user = ref<AutoVaultUser | null>(null)
        const protocol = ref<PharProtocolInfo | null>(null)
        const tokens = ref(new Map<string, TokenInfo>())
        const pools = ref(new Map<string, PharPool>())
        const loading = ref(false)
        const chainError = ref('')
        const updatedAt = ref('')
        const showNext = ref(false)

        /** Tokens the API didn't list, read from the chain once both sources are in. */
        const fillMissingTokens = async (mine: number) => {
            const v = vault.value
            if (!v) return
            const wanted = new Set<string>(
                v.outputs
                    .map((o) => o.token)
                    .concat(v.pendingSwaps.flatMap((s) => [s.input, s.output]))
                    .concat(user.value ? [user.value.outputPreference] : [])
            )
            const missing = Array.from(wanted).filter(
                (a) => a && !/^0x0{40}$/i.test(a) && !tokens.value.has(a.toLowerCase())
            )
            if (!missing.length) return
            const found = await readTokenInfo(missing).catch(() => [])
            if (mine !== generation) return
            const next = new Map(tokens.value)
            for (const t of found) next.set(t.address.toLowerCase(), t)
            tokens.value = next
        }

        let generation = 0
        const load = async () => {
            const me = address.value
            const mine = ++generation
            loading.value = true
            chainError.value = ''
            // Each source lands on its own, so a slow API never holds up the
            // on-chain figures (or the other way round).
            const onChain = readAutoVaultOnChain(me)
                .then((r) => {
                    if (mine !== generation) return
                    vault.value = r.vault
                    user.value = r.user
                })
                .catch((e) => {
                    console.warn('[PharAutoVault] contract read failed:', e)
                    if (mine === generation) chainError.value = 'Could not read the AutoVault contract. Try refreshing.'
                })
            const offChain = readPharaohApi().then((r) => {
                if (mine !== generation) return
                protocol.value = r.protocol
                tokens.value = r.tokens
                pools.value = r.pools
            })
            await Promise.all([onChain, offChain])
            await fillMissingTokens(mine)
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

        // ── tokens ──
        const tokenOf = (a: string) => tokens.value.get(String(a).toLowerCase()) ?? null
        const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
        const sym = (a: string) => {
            if (!a || /^0x0{40}$/i.test(a)) return '--'
            return tokenOf(a)?.symbol || short(a)
        }
        const dec = (a: string) => tokenOf(a)?.decimals ?? 18
        const priceOf = (a: string) => tokenOf(a)?.price ?? null
        const xpharPrice = computed(() => priceOf(XPHAR_ADDRESS) ?? protocol.value?.pharPriceUSD ?? null)

        // ── formatting ──
        const units = (v: BN, d: number) => Number(Big(v.toString()).div(Big(10).pow(d)).toString())
        const amt = (v: BN, d: number) => {
            const x = units(v, d)
            return x.toLocaleString(undefined, { maximumFractionDigits: x >= 1000 ? 0 : x >= 1 ? 2 : 6 })
        }
        const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 0 })
        const usd = (x: number) =>
            x.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: x < 100 ? 2 : 0 })
        const pct = (part: BN, whole: BN, digits: number) => {
            if (whole.isZero()) return '0%'
            return `${Big(part.toString()).div(whole.toString()).times(100).toFixed(digits)}%`
        }
        const timeLeft = (ms: number) => {
            const left = ms - Date.now()
            if (left <= 0) return 'moments'
            const d = Math.floor(left / 86_400_000)
            const h = Math.floor((left % 86_400_000) / 3_600_000)
            return d > 0 ? `${d}d ${h}h` : `${h}h`
        }
        const explorer = (a: string) => SNOWTRACE + a
        /** USD value of `amount` of `token`, or '' when the token has no price. */
        const valueOf = (amount: BN, token: string) => {
            const price = priceOf(token)
            return price ? usd(units(amount, dec(token)) * price) : ''
        }

        const allowanceText = computed(() => {
            const a = user.value?.xpharAllowance
            if (!a || a.isZero()) return 'Not approved'
            // Anything within 1% of the max is an "infinite" approval.
            if (a.gte(MAX_UINT.divn(100).muln(99))) return 'Unlimited'
            return `${amt(a, 18)} xPHAR`
        })

        const isMyOutput = (token: string) =>
            !!user.value && !user.value.shares.isZero() && token.toLowerCase() === user.value.outputPreference.toLowerCase()

        // ── votes ──
        const shownVotes = computed(() => {
            const v = vault.value
            if (!v) return []
            const list = showNext.value ? v.votesNextPeriod : v.votesThisPeriod
            return list.slice().sort((a, b) => b.weight.cmp(a.weight))
        })
        const shownVotesTotal = computed(() => shownVotes.value.reduce((s, v) => s.add(v.weight), new BN(0)))
        const poolOf = (a: string) => pools.value.get(a.toLowerCase()) ?? null
        const poolName = (a: string) => poolOf(a)?.symbol || short(a)
        const poolApr = (a: string) => {
            const p = poolOf(a)
            return p ? `${p.voteApr.toFixed(1)}%` : '--'
        }
        const poolTvl = (a: string) => {
            const p = poolOf(a)
            return p ? usd(p.tvlUsd) : '--'
        }
        const myPart = (weight: BN) => {
            const v = vault.value
            const u = user.value
            if (!v || !u || v.totalShares.isZero()) return new BN(0)
            return weight.mul(u.shares).div(v.totalShares)
        }

        return {
            vault,
            user,
            protocol,
            loading,
            chainError,
            updatedAt,
            showNext,
            load,
            sym,
            dec,
            priceOf,
            xpharPrice,
            units,
            amt,
            n,
            usd,
            pct,
            timeLeft,
            short,
            explorer,
            periodStart,
            allowanceText,
            isMyOutput,
            shownVotes,
            shownVotesTotal,
            poolOf,
            poolName,
            poolApr,
            poolTvl,
            valueOf,
            myPart,
            appUrl: AUTOVAULT_APP_URL,
            addrs: {
                vault: AUTOVAULT_ADDRESS,
                xphar: XPHAR_ADDRESS,
                voter: PHAR_VOTER_ADDRESS,
                minter: PHAR_MINTER_ADDRESS,
            },
        }
    },
})
</script>

<style lang="scss" scoped>
.phar_dash {
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

.phar_panel {
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
    margin-top: 12px;
    font-size: 12px;
    color: var(--secondary-color) !important;
}

.toggle {
    display: inline-flex;
    border: 1px solid var(--bg);
    border-radius: 6px;
    overflow: hidden;

    button {
        padding: 4px 10px;
        font-size: 12px;
        color: var(--primary-color-light);
        background: transparent;

        &.selected {
            background: var(--bg);
            color: var(--primary-color);
            font-weight: 600;
        }
    }
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
    margin-bottom: 4px !important;
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
