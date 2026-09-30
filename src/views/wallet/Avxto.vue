<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="avxto_page">
        <h1>AVXTO Dashboard</h1>
        <p class="desc">
            Price, volume, supply and transfer activity for the {{ tokenSymbol }} token on the Avalanche
            C-Chain. Market figures come from DexScreener; supply is read from the token contract; activity
            is computed from the on-chain transfer log.
        </p>

        <div class="card contract_card">
            <div class="contract_row">
                <img v-if="tokenIcon" :src="tokenIcon" class="token_icon" alt="" />
                <div class="contract_info">
                    <div class="token_title">
                        {{ tokenName }} ({{ tokenSymbol }})
                        <RegistryCheck :address="contractAddress"></RegistryCheck>
                    </div>
                    <CopyText :value="contractAddress" class="addr_copy">
                        {{ shortAddr(contractAddress) }}
                    </CopyText>
                </div>
                <div class="contract_links">
                    <a :href="snowtraceTokenUrl" target="_blank" rel="noopener noreferrer">
                        Snowtrace ↗
                    </a>
                </div>
            </div>
        </div>

        <p v-if="!isMainnet" class="state_msg">Switch to Mainnet to view the AVXTO dashboard.</p>

        <!-- ── Market ── -->
        <img v-if="isMainnet && market && market.headerImage" :src="market.headerImage" class="header_img" alt="" />
        <section v-if="isMainnet" class="av_panel">
            <div class="table_head_row">
                <h2>Market</h2>
                <a v-if="market && market.pairUrl" class="panel_link" :href="market.pairUrl" target="_blank" rel="noopener noreferrer">
                    DexScreener ↗
                </a>
            </div>
            <div v-if="market" class="tiles">
                <div class="tile">
                    <label>Price</label>
                    <p class="big">${{ priceText(market.priceUsd) }}</p>
                    <span>{{ priceText(market.priceNative) }} {{ market.quoteSymbol }}</span>
                </div>
                <div v-if="estimate" class="tile">
                    <label>Estimated price</label>
                    <p class="big">${{ priceText(estimate.usd) }}</p>
                    <span>
                        {{ priceText(estimate.ratio) }} AVAX × ${{ estimate.avaxUsd.toFixed(2) }} ({{ avaxPriceSource }})
                    </span>
                    <span :class="{ up: estimate.gapPct >= 0, down: estimate.gapPct < 0 }">
                        {{ estimate.gapPct >= 0 ? '+' : '' }}{{ estimate.gapPct.toFixed(2) }}% vs DexScreener
                    </span>
                </div>
                <div class="tile">
                    <label>Price change</label>
                    <div class="changes">
                        <span v-for="w in windows" :key="w" :class="changeClass(market.priceChange[w])">
                            {{ w }} {{ changeText(market.priceChange[w]) }}
                        </span>
                    </div>
                </div>
                <div class="tile">
                    <label>Market cap</label>
                    <p>{{ usd(market.marketCapUsd) }}</p>
                    <span>FDV {{ usd(market.fdvUsd) }}</span>
                </div>
                <div class="tile">
                    <label>Liquidity</label>
                    <p>{{ usd(market.totalLiquidityUsd) }}</p>
                    <span>across {{ market.pairCount }} {{ market.pairCount === 1 ? 'pair' : 'pairs' }}</span>
                </div>
                <div class="tile">
                    <label>24h volume</label>
                    <p>{{ usd(market.totalVolume24hUsd) }}</p>
                    <span>6h {{ usd(market.volumeUsd.h6) }} · 1h {{ usd(market.volumeUsd.h1) }}</span>
                </div>
                <div class="tile">
                    <label>24h trades</label>
                    <p>{{ market.txns.h24.buys + market.txns.h24.sells }}</p>
                    <span>{{ market.txns.h24.buys }} buys · {{ market.txns.h24.sells }} sells</span>
                </div>
                <div class="tile">
                    <label>Pooled</label>
                    <p>{{ amount(market.pooledBase) }} {{ tokenSymbol }}</p>
                    <span>{{ amount(market.pooledQuote) }} {{ market.quoteSymbol }}</span>
                </div>
                <div class="tile">
                    <label>Main pair</label>
                    <p>{{ tokenSymbol }}/{{ market.quoteSymbol }}</p>
                    <span>{{ market.dex }}<template v-if="market.pairCreatedAt"> · since {{ date(market.pairCreatedAt) }}</template></span>
                </div>
            </div>

            <div v-if="market" class="table_wrap">
                <table>
                    <thead>
                        <tr>
                            <th></th>
                            <th v-for="w in windows" :key="w">{{ windowLabels[w] }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>Price change</td>
                            <td v-for="w in windows" :key="w" :class="changeClass(market.priceChange[w])">
                                {{ changeText(market.priceChange[w]) }}
                            </td>
                        </tr>
                        <tr>
                            <td>Volume</td>
                            <td v-for="w in windows" :key="w">{{ usd(market.volumeUsd[w]) }}</td>
                        </tr>
                        <tr>
                            <td>Buys / sells</td>
                            <td v-for="w in windows" :key="w">{{ market.txns[w].buys }} / {{ market.txns[w].sells }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div v-if="market && (market.links.length || profile)" class="links_row">
                <a v-for="l in market.links" :key="l.url" :href="l.url" target="_blank" rel="noopener noreferrer" class="panel_link">
                    {{ l.label }} ↗
                </a>
                <span v-if="profile && profile.status" class="profile_tag">
                    DexScreener profile {{ profile.status }}<template v-if="profile.since"> · {{ date(profile.since) }}</template>
                </span>
            </div>
            <p v-else class="state_msg">{{ marketLoading ? 'Loading market data…' : 'Market data unavailable right now.' }}</p>
        </section>

        <!-- ── Supply ── -->
        <section v-if="isMainnet" class="av_panel">
            <h2>Supply</h2>
            <div v-if="supply" class="tiles">
                <div class="tile">
                    <label>Total supply</label>
                    <p class="big">{{ tokens(supply.total) }}</p>
                </div>
                <div class="tile">
                    <label>Burned</label>
                    <p>{{ tokens(supply.burned) }}</p>
                    <span>{{ share(supply.burned, supply.total) }} of supply</span>
                </div>
                <div class="tile">
                    <label>Circulating</label>
                    <p>{{ tokens(supply.circulating) }}</p>
                    <span>total minus burned</span>
                </div>
                <div class="tile">
                    <label>Held in Moats</label>
                    <p>{{ tokens(supply.inMoats) }}</p>
                    <span>{{ share(supply.inMoats, supply.circulating) }} of circulating, staked + locked</span>
                    <router-link :to="`/wallet/moats/dashboard/${moatsAddress}`" class="panel_link small">Moats dashboard</router-link>
                </div>
            </div>
            <p v-else class="state_msg">{{ supplyError || 'Reading the token contract…' }}</p>
        </section>

        <!-- ── Activity ── -->
        <section v-if="isMainnet && summary" class="av_panel">
            <div class="table_head_row">
                <h2>Transfer activity</h2>
                <span class="window_note">
                    {{ summary.transfers.toLocaleString() }} transfers since {{ dateTime(summary.windowStart) }}
                </span>
            </div>
            <div class="tiles">
                <div class="tile">
                    <label>Last 24h</label>
                    <p class="big">{{ summary.last24h.transfers.toLocaleString() }}</p>
                    <span>{{ amount(summary.last24h.volume) }} {{ tokenSymbol }} moved</span>
                </div>
                <div class="tile">
                    <label>Moved in window</label>
                    <p>{{ amount(summary.volume) }}</p>
                    <span>{{ summary.transactions.toLocaleString() }} transactions</span>
                </div>
                <div class="tile">
                    <label>Active addresses</label>
                    <p>{{ summary.uniqueAddresses.toLocaleString() }}</p>
                </div>
                <div class="tile">
                    <label>Into Moats</label>
                    <p>{{ amount(summary.toMoats.volume) }}</p>
                    <span>{{ summary.toMoats.transfers }} burns, stakes and locks</span>
                </div>
                <div class="tile">
                    <label>Burned</label>
                    <p>{{ amount(summary.burned.volume) }}</p>
                    <span>{{ summary.burned.transfers }} transfers to the dead address</span>
                </div>
                <div v-if="summary.largest" class="tile">
                    <label>Largest transfer</label>
                    <p>{{ formatAmount(summary.largest.value) }}</p>
                    <a class="panel_link small" :href="txUrl(summary.largest.txHash)" target="_blank" rel="noopener noreferrer">
                        {{ dateTime(summary.largest.blockTimestamp) }} ↗
                    </a>
                </div>
            </div>

            <div v-if="summary.mostActive.length" class="active_table">
                <h3>Most active addresses</h3>
                <div v-for="a in summary.mostActive" :key="a.address" class="active_row">
                    <span class="addr_cell">{{ a.name || shortAddr(a.address) }}</span>
                    <span>{{ a.transfers }} transfers</span>
                    <span class="amount_cell">{{ amount(a.volume) }} {{ tokenSymbol }}</span>
                </div>
            </div>
        </section>

        <div class="card">
            <div class="table_head_row">
                <h2>Latest Transfers</h2>
                <button class="refresh_btn" :disabled="isLoading" @click="refresh">
                    {{ isLoading ? 'Loading…' : 'Refresh' }}
                </button>
            </div>

            <p v-if="!isMainnet" class="state_msg">
                Switch to Mainnet to view AVXTO activity.
            </p>
            <p v-else-if="isLoading && !transfers.length" class="state_msg">
                Loading latest transfers…
            </p>
            <p v-else-if="error" class="state_msg err_text">
                {{ error }}
            </p>
            <p v-else-if="!transfers.length" class="state_msg">
                No transfers found in the recent block range.
            </p>

            <div v-else class="tx_table">
                <div class="tx_header">
                    <span>Time</span>
                    <span>From</span>
                    <span>To</span>
                    <span>Amount</span>
                    <span>Tx</span>
                </div>
                <div v-for="t in transfers" :key="t.txHash + t.logIndex" class="tx_row">
                    <span class="time_cell">{{ formatTime(t.blockTimestamp) }}</span>
                    <span class="addr_cell">{{ addrLabel(t.from) }}</span>
                    <span class="addr_cell">{{ addrLabel(t.to) }}</span>
                    <span class="amount_cell">{{ formatAmount(t.value) }} {{ tokenSymbol }}</span>
                    <span>
                        <a
                            :href="txUrl(t.txHash)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="tx_link"
                        >
                            {{ shortAddr(t.txHash) }} ↗
                        </a>
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import { ava } from '@/AVA'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { Avalanche as ChainKitAvalanche } from '@avalanche-sdk/chainkit'
import Big from 'big.js'
import CopyText from '@/components/misc/CopyText.vue'
import RegistryCheck from '@/components/misc/RegistryCheck.vue'
import { web3 } from '@/evm'
import {
    AVXTO_CONTRACT_ADDRESS,
    AVXTO_SYMBOL,
    AVXTO_NAME,
    AVXTO_ICON,
    TESTNET_AVXTO_CONTRACT_ADDRESS,
    TESTNET_AVXTO_SYMBOL,
    TESTNET_AVXTO_NAME,
    TESTNET_AVXTO_ICON,
} from '@/avxto/AVXTOConf'
import {
    readAvxtoMarket,
    readDexProfileStatus,
    MARKET_WINDOWS,
    type DexProfileStatus,
    type TokenMarket,
} from '@/js/MoatsStats'
import { MOATS_CONTRACT_ADDRESS } from '@/js/Moats'
import { getPriceService, getPriceUSD } from '@/prices'
import { summarizeTransfers, DEAD_ADDRESS, ZERO_ADDRESS, type ActivitySummary } from '@/js/avxtoActivity'

// How far back (in blocks) to scan for transfers. The list-transfers API does
// not expose a sort order, so we bound the range to the recent chain tip and
// sort the collected results client-side to guarantee newest-first display.
const BLOCK_RANGE = 300_000
const MAX_PAGES = 10
const DISPLAY_LIMIT = 50
const TOKEN_DECIMALS = 18

interface SupplyStats {
    total: Big
    burned: Big
    circulating: Big
    inMoats: Big
}

interface TransferRow {
    txHash: string
    logIndex: number
    blockTimestamp: number
    from: { address: string; name?: string }
    to: { address: string; name?: string }
    value: string
}

export default defineComponent({
    name: 'avxto',
    components: {
        CopyText,
        RegistryCheck,
    },
    setup() {
        const netID = ava.getNetworkID()
        const isMainnet = isMainnetNetworkID(netID)

        const contractAddress = isMainnet ? AVXTO_CONTRACT_ADDRESS : TESTNET_AVXTO_CONTRACT_ADDRESS
        const tokenSymbol = isMainnet ? AVXTO_SYMBOL : TESTNET_AVXTO_SYMBOL
        const tokenName = isMainnet ? AVXTO_NAME : TESTNET_AVXTO_NAME
        const tokenIcon = isMainnet ? AVXTO_ICON : TESTNET_AVXTO_ICON
        const chainkitChainId = isMainnet ? '43114' : '43113'
        const evmChainId = isMainnet ? 43114 : 43113

        const isLoading = ref(false)
        const error = ref('')
        /** Everything loaded — the stats use all of it; the table shows the newest. */
        const allTransfers = ref<TransferRow[]>([])
        const transfers = computed(() => allTransfers.value.slice(0, DISPLAY_LIMIT))
        const summary = ref<ActivitySummary | null>(null)

        const market = ref<TokenMarket | null>(null)
        const profile = ref<DexProfileStatus | null>(null)
        const avaxUsd = ref<number | null>(null)
        const avaxPriceSource = ref('')

        /**
         * AVXTO's dollar price from its AVAX ratio: the pool's AVXTO→AVAX
         * price times AVAX's dollar price from the chosen price service. An
         * independent check on DexScreener's own dollar figure — shown only
         * when the main pair is actually quoted in (W)AVAX.
         */
        const estimate = computed(() => {
            const m = market.value
            const avax = avaxUsd.value
            if (!m || !avax || !m.priceNative) return null
            if (!/^W?AVAX$/.test(m.quoteSymbol)) return null
            const usd = m.priceNative * avax
            const gapPct = m.priceUsd ? ((usd - m.priceUsd) / m.priceUsd) * 100 : 0
            return { ratio: m.priceNative, avaxUsd: avax, usd, gapPct }
        })
        const marketLoading = ref(false)
        const supply = ref<SupplyStats | null>(null)
        const supplyError = ref('')

        const snowtraceTokenUrl = computed(() => {
            const base = evmChainId === 43113 ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
            return `${base}/token/${contractAddress}`
        })

        const shortAddr = (addr: string): string => {
            if (!addr || addr.length < 12) return addr
            return addr.slice(0, 6) + '…' + addr.slice(-4)
        }

        const addrLabel = (party: { address: string; name?: string }): string => {
            return party?.name || shortAddr(party?.address || '') || '—'
        }

        const formatAmount = (rawValue: string): string => {
            try {
                const val = new Big(rawValue).div(new Big(10).pow(18))
                return val.toFixed(4).replace(/\.?0+$/, '')
            } catch {
                return rawValue ?? ''
            }
        }

        const formatTime = (blockTimestamp: number): string => {
            const date = new Date(blockTimestamp * 1000)
            return date.toLocaleString()
        }

        const txUrl = (hash: string): string => {
            const base = evmChainId === 43113 ? 'https://testnet.snowtrace.io' : 'https://snowtrace.io'
            return `${base}/tx/${hash}`
        }

        const fetchTransfers = async () => {
            isLoading.value = true
            error.value = ''
            try {
                const chainkit = new ChainKitAvalanche({ chainId: chainkitChainId, enableTelemetry: false })

                let startBlock: number | undefined
                try {
                    const currentBlock = Number(await web3.eth.getBlockNumber())
                    if (currentBlock > 0) {
                        startBlock = Math.max(0, currentBlock - BLOCK_RANGE)
                    }
                } catch {
                    startBlock = undefined
                }

                const collected: TransferRow[] = []
                const pages = await chainkit.data.evm.contracts.listTransfers({
                    address: contractAddress,
                    chainId: chainkitChainId,
                    startBlock,
                    pageSize: 100,
                })

                let pageCount = 0
                for await (const page of pages) {
                    for (const t of page.result.transfers as any[]) {
                        if ('erc20Token' in t) {
                            collected.push({
                                txHash: t.txHash,
                                logIndex: t.logIndex,
                                blockTimestamp: t.blockTimestamp,
                                from: t.from,
                                to: t.to,
                                value: t.value,
                            })
                        }
                    }
                    pageCount++
                    if (pageCount >= MAX_PAGES) break
                }

                collected.sort((a, b) => b.blockTimestamp - a.blockTimestamp)
                allTransfers.value = collected
                summary.value = collected.length
                    ? summarizeTransfers(collected, {
                          nowSec: Math.floor(Date.now() / 1000),
                          decimals: TOKEN_DECIMALS,
                          moatsAddress: MOATS_CONTRACT_ADDRESS,
                      })
                    : null
            } catch (e: any) {
                console.error('Failed to fetch AVXTO contract transfers:', e)
                error.value = e?.message || 'Failed to load AVXTO activity.'
            } finally {
                isLoading.value = false
            }
        }

        const fetchMarket = async () => {
            marketLoading.value = true
            try {
                const [m, p, avax] = await Promise.all([
                    readAvxtoMarket(),
                    readDexProfileStatus(contractAddress),
                    // The user's chosen price service (Settings); a failure only hides the estimate.
                    getPriceUSD('AVAX').catch((e) => {
                        console.warn('[Avxto] AVAX price unavailable:', e)
                        return null
                    }),
                ])
                market.value = m
                profile.value = p
                avaxUsd.value = avax
                avaxPriceSource.value = getPriceService().name
            } finally {
                marketLoading.value = false
            }
        }

        /** Supply from the token itself: total, what sits at the burn addresses, and what Moats holds. */
        const fetchSupply = async () => {
            supplyError.value = ''
            try {
                // @ts-ignore - web3 typing for dynamic ABI
                const t = new web3.eth.Contract(ERC20Abi.abi as any, contractAddress).methods
                const [total, dead, zero, moats] = await Promise.all([
                    t.totalSupply().call(),
                    t.balanceOf(DEAD_ADDRESS).call(),
                    t.balanceOf(ZERO_ADDRESS).call(),
                    t.balanceOf(MOATS_CONTRACT_ADDRESS).call(),
                ])
                const scale = new Big(10).pow(TOKEN_DECIMALS)
                const totalBig = new Big(String(total)).div(scale)
                const burned = new Big(String(dead)).plus(String(zero)).div(scale)
                supply.value = {
                    total: totalBig,
                    burned,
                    circulating: totalBig.minus(burned),
                    inMoats: new Big(String(moats)).div(scale),
                }
            } catch (e) {
                console.warn('Failed to read AVXTO supply:', e)
                supplyError.value = 'Could not read the token contract.'
            }
        }

        const refresh = () => {
            if (!isMainnet) return
            fetchTransfers()
            fetchMarket()
            fetchSupply()
        }

        onMounted(refresh)

        // ── formatting ──
        const usd = (v: number) =>
            v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: v < 100 ? 2 : 0 })
        // Four significant digits, always in plain decimals: toPrecision turns
        // anything under 1e-6 (AVXTO's AVAX ratio, for one) into "2.795e-7".
        const priceText = (v: number) =>
            v ? v.toLocaleString('en-US', { maximumSignificantDigits: 4, useGrouping: false }) : '0'
        const changeText = (v: number | null) => (v === null ? '--' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`)
        const changeClass = (v: number | null) => (v === null ? '' : v >= 0 ? 'up' : 'down')
        const windowLabels = { m5: '5m', h1: '1h', h6: '6h', h24: '24h' }
        const amount = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: v >= 1000 ? 0 : 2 })
        const tokens = (v: Big) => amount(Number(v.toString()))
        const share = (part: Big, whole: Big) => (whole.eq(0) ? '0%' : `${part.div(whole).times(100).toFixed(2)}%`)
        const date = (ms: number) =>
            new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        const dateTime = (sec: number) =>
            new Date(sec * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

        return {
            isMainnet,
            contractAddress,
            tokenSymbol,
            tokenName,
            tokenIcon,
            snowtraceTokenUrl,
            isLoading,
            error,
            transfers,
            summary,
            market,
            marketLoading,
            supply,
            supplyError,
            windows: MARKET_WINDOWS,
            moatsAddress: MOATS_CONTRACT_ADDRESS,
            usd,
            priceText,
            changeText,
            changeClass,
            windowLabels,
            profile,
            estimate,
            avaxUsd,
            avaxPriceSource,
            amount,
            tokens,
            share,
            date,
            dateTime,
            shortAddr,
            addrLabel,
            formatAmount,
            formatTime,
            txUrl,
            refresh,
        }
    },
})
</script>

<style lang="scss" scoped>
.avxto_page {
    width: 100%;

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
        margin: 0;
        font-size: 18px;
    }
}

.contract_card {
    padding: 16px 24px;
}

.contract_row {
    display: flex;
    align-items: center;
    gap: 14px;
}

.token_icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: contain;
}

.contract_info {
    flex: 1;
    min-width: 0;
}

.token_title {
    font-weight: 700;
    font-size: 15px;
    margin-bottom: 2px;
    color: var(--primary-color);
}

.addr_copy {
    font-family: monospace;
    font-size: 13px;
    color: var(--primary-color-light);
}

.contract_links a {
    color: var(--secondary-color);
    font-weight: 600;
    text-decoration: none;
    font-size: 13px;

    &:hover {
        text-decoration: underline;
    }
}

.av_panel {
    background: var(--bg-light);
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 20px;
    color: var(--primary-color);

    h2 {
        margin: 0 0 14px;
        font-size: 18px;
    }

    h3 {
        font-size: 14px;
        margin: 18px 0 8px;
    }

    .table_head_row h2 {
        margin: 0;
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

    .changes {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2px 8px;
        margin-top: 4px;

        span {
            margin: 0;
            font-weight: 600;
        }
    }

    .up {
        color: var(--success);
    }

    .down {
        color: var(--error);
    }
}

.panel_link {
    color: var(--secondary-color) !important;
    font-weight: 600;
    font-size: 13px;
    text-decoration: none;

    &.small {
        display: inline-block;
        margin-top: 4px;
        font-size: 12px;
    }

    &:hover {
        text-decoration: underline;
    }
}

.header_img {
    display: block;
    width: 100%;
    max-height: 180px;
    object-fit: cover;
    border-radius: 12px;
    margin-bottom: 20px;
}

.table_wrap {
    margin-top: 16px;
    overflow-x: auto;

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        color: var(--primary-color);
    }

    th {
        text-align: right;
        font-size: 12px;
        font-weight: 600;
        color: var(--primary-color-light);
        padding: 6px 10px;
        border-bottom: 1px solid var(--bg);
    }

    td {
        text-align: right;
        padding: 7px 10px;
        border-bottom: 1px solid var(--bg);
        white-space: nowrap;

        &:first-child {
            text-align: left;
            color: var(--primary-color-light);
        }

        &.up {
            color: var(--success);
        }

        &.down {
            color: var(--error);
        }
    }
}

.links_row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin-top: 14px;
}

.profile_tag {
    font-size: 12px;
    color: var(--success);
    border: 1px solid var(--success);
    border-radius: 10px;
    padding: 0 8px;
}

.window_note {
    font-size: 12px;
    color: var(--primary-color-light);
}

.active_table {
    font-size: 13px;

    .active_row {
        display: grid;
        grid-template-columns: 1.4fr 1fr 1fr;
        gap: 10px;
        padding: 8px 0;
        border-top: 1px solid var(--bg);
    }

    .addr_cell {
        font-family: monospace;
    }

    .amount_cell {
        text-align: right;
    }
}

.table_head_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
}

.refresh_btn {
    background: var(--bg);
    border: 1px solid var(--bg-light);
    border-radius: 8px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--primary-color);
    cursor: pointer;

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }
}

.state_msg {
    color: var(--primary-color-light);
    padding: 20px 0;
    text-align: center;
}

.err_text {
    color: #f44336;
}

.tx_table {
    border: 1px solid var(--bg);
    border-radius: 8px;
    overflow: hidden;
    font-size: 13px;

    .tx_header,
    .tx_row {
        display: grid;
        grid-template-columns: 1.4fr 1fr 1fr 1.1fr 1.2fr;
        gap: 10px;
        padding: 10px 14px;
        align-items: center;
    }

    .tx_header {
        background: var(--bg);
        font-weight: 700;
        font-size: 12px;
        color: var(--primary-color-light);
        text-transform: uppercase;
        letter-spacing: 0.03em;
    }

    .tx_row {
        border-top: 1px solid var(--bg);
        // No color of its own meant addr_cell/amount_cell fell back to
        // bootstrap's dark body color instead of this app's light
        // --primary-color — same bug as .asset_row/.transfer_row in
        // WalletWizard.vue and .token_list_name in TokenListPicker.vue.
        color: var(--primary-color);
    }

    .time_cell {
        font-size: 12px;
        color: var(--primary-color-light);
    }

    .addr_cell {
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .amount_cell {
        font-weight: 600;
    }

    .tx_link {
        color: var(--secondary-color);
        font-weight: 600;
        text-decoration: none;
        font-family: monospace;

        &:hover {
            text-decoration: underline;
        }
    }
}

@media (max-width: 640px) {
    .tx_table {
        .tx_header {
            display: none;
        }

        .tx_row {
            grid-template-columns: 1fr;
            gap: 4px;
        }
    }
}
</style>
