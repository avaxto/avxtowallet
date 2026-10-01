<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  PHAR Dashboard: your Pharaoh AutoVault rewards, and claiming them.

  Rebuilt from HARs of phar.gg checking and claiming rewards (with the Core
  extension serving it) — tmp/phar/rewards-moats-20260930/1check-* and
  2claim-*. Checking is the vault's `earned(you)` in your payout token
  (`outputPreference(you)`); claiming is one `claim()` call on the vault, which
  pays all of it. See js/PharAutoVault.ts. The full vault statistics live on
  the AutoVault Dashboard.

  Panels are named `phar_panel`, not `card`: Bootstrap's `.card` forces
  near-black text.
-->
<template>
    <div class="phar_rewards">
        <div class="dash_header">
            <div>
                <h1>PHAR Dashboard</h1>
                <p class="desc">
                    Your Pharaoh AutoVault rewards. The vault votes with your xPHAR every epoch and
                    pays the voting rewards in the token you picked; claim them here whenever they
                    have built up.
                </p>
            </div>
            <button type="button" class="refresh_btn" :disabled="loading" title="Refresh" @click="load">
                <fa icon="sync" :class="{ spinning: loading }"></fa>
            </button>
        </div>

        <section v-if="!address" class="phar_panel">
            <h2>Rewards</h2>
            <p class="muted">
                Connect an Avalanche wallet or the EVM platform to see and claim your AutoVault rewards.
            </p>
        </section>

        <template v-else>
            <p v-if="readError" class="error_msg">{{ readError }}</p>

            <SignedTxExport
                v-if="offline.hasRecords"
                :records="offline.records"
                @done="onOfflineDone"
            ></SignedTxExport>

            <!-- ── Pending rewards ── -->
            <section v-else class="phar_panel rewards_panel">
                <div class="panel_head">
                    <h2>Pending rewards</h2>
                    <span class="mono muted">{{ short(address) }}</span>
                </div>

                <template v-if="user">
                    <div class="reward_figure">
                        <p class="reward_amount">
                            {{ amt(user.earned, dec(user.outputPreference)) }}
                            <span class="reward_symbol">{{ sym(user.outputPreference) }}</span>
                        </p>
                        <p v-if="earnedUsd" class="reward_usd">≈ {{ earnedUsd }}</p>
                    </div>

                    <div v-if="claimed" class="claim_done">
                        <p class="claim_title">
                            <fa icon="circle-check"></fa>
                            Claimed {{ amt(claimed.amount, dec(claimed.token)) }} {{ sym(claimed.token) }}
                        </p>
                        <p class="mono tx_hash">{{ claimed.txHash }}</p>
                        <div class="tx_actions">
                            <CopyText :value="claimed.txHash" class="tx_copy">Copy transaction hash</CopyText>
                            <a :href="txUrl(claimed.txHash)" target="_blank" rel="noopener noreferrer" class="panel_link">
                                View on snowtrace.io ↗
                            </a>
                        </div>
                    </div>

                    <p v-if="claimError" class="error_msg">{{ claimError }}</p>
                    <p v-else-if="wrongChain" class="muted note">
                        Rewards are claimed on Avalanche C-Chain; your wallet is on {{ wrongChain }}. Switch
                        to C-Chain to claim.
                    </p>
                    <p v-else-if="user.earned.isZero() && !claimed" class="muted note">
                        Nothing to claim right now. Rewards are added as the vault's voting rewards are
                        swapped into your payout token after each epoch.
                    </p>

                    <SignOnlyToggle :disabled="claiming"></SignOnlyToggle>
                    <v-btn
                        class="button_primary claim_btn"
                        depressed
                        block
                        :loading="claiming"
                        :disabled="!canClaim"
                        @click="claim"
                    >
                        Claim rewards
                    </v-btn>
                </template>
                <p v-else class="muted">{{ loading ? 'Reading your rewards…' : '--' }}</p>
            </section>

            <!-- ── Position ── -->
            <section v-if="user && vault" class="phar_panel">
                <h2>Your AutoVault position</h2>
                <div class="tiles">
                    <div class="tile">
                        <label>Deposited</label>
                        <p class="big">{{ amt(user.shares, 18) }} xPHAR</p>
                        <span v-if="xpharPrice">{{ usd(units(user.shares, 18) * xpharPrice) }}</span>
                    </div>
                    <div class="tile">
                        <label>Share of the vault</label>
                        <p>{{ pct(user.shares, vault.totalShares) }}</p>
                    </div>
                    <div class="tile">
                        <label>Paid out in</label>
                        <p>{{ sym(user.outputPreference) }}</p>
                    </div>
                    <div class="tile">
                        <label>Epoch</label>
                        <p>{{ vault.period }}</p>
                        <span>next in {{ timeLeft(periodStart(vault.period + 1)) }}</span>
                    </div>
                    <div class="tile">
                        <label>Vault status</label>
                        <p :class="vault.isUnlocked ? 'up' : 'down'">{{ vault.isUnlocked ? 'Unlocked' : 'Locked' }}</p>
                    </div>
                    <div class="tile">
                        <label>Queued reward swaps</label>
                        <p>{{ vault.pendingSwaps.length }}</p>
                        <span>being turned into payouts</span>
                    </div>
                </div>
                <div class="links_row">
                    <router-link to="/wallet/phar/autovault" class="panel_link">AutoVault Dashboard</router-link>
                    <a :href="appUrl" target="_blank" rel="noopener noreferrer" class="panel_link">
                        Deposit or withdraw on phar.gg ↗
                    </a>
                </div>
            </section>
        </template>

        <p v-if="updatedAt" class="muted updated">Updated {{ updatedAt }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { useOfflineSigningStore } from '@/stores'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { errorToString } from '@/helpers/helper'
import {
    AUTOVAULT_APP_URL,
    PHAR_CHAIN_ID,
    XPHAR_ADDRESS,
    claimAutoVaultRewards,
    periodStart,
    readAutoVaultOnChain,
    readPharaohApi,
    readTokenInfo,
    type AutoVaultStats,
    type AutoVaultUser,
    type ClaimResult,
    type TokenInfo,
} from '@/js/PharAutoVault'
import CopyText from '@/components/misc/CopyText.vue'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back showing a stale reward figure.
    name: 'phar_dashboard',
    components: { CopyText, SignOnlyToggle, SignedTxExport },
    setup() {
        const offline = useOfflineSigningStore()
        const signer = computed(() => activeEvmSigner())
        const address = computed(() => signer.value?.address ?? null)

        const vault = ref<AutoVaultStats | null>(null)
        const user = ref<AutoVaultUser | null>(null)
        const tokens = ref(new Map<string, TokenInfo>())
        const xpharPriceApi = ref<number | null>(null)
        const loading = ref(false)
        const readError = ref('')
        const updatedAt = ref('')

        const claiming = ref(false)
        const claimError = ref('')
        const claimed = ref<ClaimResult | null>(null)

        let generation = 0
        const load = async () => {
            const me = address.value
            const mine = ++generation
            if (!me) return
            loading.value = true
            readError.value = ''
            try {
                const [chain, api] = await Promise.all([
                    readAutoVaultOnChain(me),
                    readPharaohApi().catch(() => null),
                ])
                if (mine !== generation) return
                vault.value = chain.vault
                user.value = chain.user
                if (api) {
                    tokens.value = api.tokens
                    xpharPriceApi.value = api.protocol?.pharPriceUSD ?? null
                }
                // The payout token, if Pharaoh's API doesn't list it.
                const pref = chain.user?.outputPreference
                if (pref && !/^0x0{40}$/i.test(pref) && !tokens.value.has(pref.toLowerCase())) {
                    const [info] = await readTokenInfo([pref]).catch(() => [])
                    if (info && mine === generation) {
                        const next = new Map(tokens.value)
                        next.set(pref.toLowerCase(), info)
                        tokens.value = next
                    }
                }
                updatedAt.value = new Date().toLocaleTimeString()
            } catch (e) {
                console.warn('[PharDashboard] read failed:', e)
                if (mine === generation) readError.value = 'Could not read the AutoVault. Try refreshing.'
            } finally {
                if (mine === generation) loading.value = false
            }
        }

        watch(
            address,
            () => {
                user.value = null
                claimed.value = null
                claimError.value = ''
                load()
            },
            { immediate: true }
        )

        const wrongChain = computed(() => {
            const s = signer.value
            return s && s.network.evmChainId !== PHAR_CHAIN_ID ? s.network.name : ''
        })

        const canClaim = computed(
            () => !!signer.value && !!user.value && !user.value.earned.isZero() && !claiming.value && !wrongChain.value
        )

        const claim = async () => {
            const s = signer.value
            if (!s || !canClaim.value) return
            claiming.value = true
            claimError.value = ''
            claimed.value = null
            try {
                const res = await authorizeSingle(s.authSubject, 'Claim Pharaoh AutoVault rewards', () =>
                    claimAutoVaultRewards(s)
                )
                // A captured claim has nothing on chain yet; the export panel shows instead.
                if (!res.offline) claimed.value = res
                await load()
            } catch (e) {
                // A dismissed password prompt is not an error — the user backed out.
                if (e instanceof SessionAuthCancelled) return
                claimError.value = errorToString(e)
            } finally {
                claiming.value = false
            }
        }

        const onOfflineDone = () => {
            offline.clearRecords()
            load()
        }

        // ── formatting ──
        const tokenOf = (a: string) => tokens.value.get(String(a).toLowerCase()) ?? null
        const short = (a: string) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
        const sym = (a: string) => (!a || /^0x0{40}$/i.test(a) ? '--' : tokenOf(a)?.symbol || short(a))
        const dec = (a: string) => tokenOf(a)?.decimals ?? 18
        const units = (v: BN, d: number) => Number(Big(v.toString()).div(Big(10).pow(d)).toString())
        const amt = (v: BN, d: number) => {
            const x = units(v, d)
            return x.toLocaleString(undefined, { maximumFractionDigits: x >= 1000 ? 2 : x >= 1 ? 4 : 8 })
        }
        const usd = (x: number) =>
            x.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: x < 100 ? 2 : 0 })
        const pct = (part: BN, whole: BN) =>
            whole.isZero() ? '0%' : `${Big(part.toString()).div(whole.toString()).times(100).toFixed(4)}%`
        const timeLeft = (ms: number) => {
            const left = ms - Date.now()
            if (left <= 0) return 'moments'
            const d = Math.floor(left / 86_400_000)
            const h = Math.floor((left % 86_400_000) / 3_600_000)
            return d > 0 ? `${d}d ${h}h` : `${h}h`
        }
        const txUrl = (hash: string) => `https://snowtrace.io/tx/${hash}`

        const xpharPrice = computed(() => tokenOf(XPHAR_ADDRESS)?.price ?? xpharPriceApi.value)
        const earnedUsd = computed(() => {
            const u = user.value
            if (!u || u.earned.isZero()) return ''
            const price = tokenOf(u.outputPreference)?.price
            return price ? usd(units(u.earned, dec(u.outputPreference)) * price) : ''
        })

        return {
            offline,
            address,
            vault,
            user,
            loading,
            readError,
            updatedAt,
            claiming,
            claimError,
            claimed,
            wrongChain,
            canClaim,
            load,
            claim,
            onOfflineDone,
            short,
            sym,
            dec,
            units,
            amt,
            usd,
            pct,
            timeLeft,
            txUrl,
            periodStart,
            xpharPrice,
            earnedUsd,
            appUrl: AUTOVAULT_APP_URL,
        }
    },
})
</script>

<style lang="scss" scoped>
.phar_rewards {
    max-width: 760px;
    color: var(--primary-color);

    .desc {
        color: var(--primary-color-light);
        line-height: 1.6;
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
}

.reward_figure {
    margin: 4px 0 18px;
}

.reward_amount {
    font-size: 34px;
    font-weight: 700;
    line-height: 1.2;
    word-break: break-word;

    .reward_symbol {
        font-size: 20px;
        font-weight: 600;
        color: var(--primary-color-light);
    }
}

.reward_usd {
    font-size: 15px;
    color: var(--primary-color-light);
    margin-top: 4px !important;
}

.claim_btn {
    margin-top: 10px;
}

.claim_done {
    border: 1px solid var(--success);
    background: rgba(107, 198, 136, 0.08);
    border-radius: 10px;
    padding: 12px 16px;
    margin-bottom: 14px;

    .claim_title {
        color: var(--success);
        font-weight: 700;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .tx_hash {
        font-size: 12px;
        word-break: break-all;
        margin-top: 6px !important;
        color: var(--primary-color-light);
    }
}

.tx_actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    margin-top: 8px;
    font-size: 13px;
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

.links_row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 20px;
    margin-top: 14px;
}

.panel_link {
    color: var(--secondary-color) !important;
    font-size: 13px;
    text-decoration: none;

    &:hover {
        text-decoration: underline;
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
    margin-bottom: 10px !important;
}

.updated {
    text-align: right;
    font-size: 12px;
}

.error_msg {
    color: var(--error);
    margin-bottom: 12px !important;
    word-break: break-word;
}
</style>
