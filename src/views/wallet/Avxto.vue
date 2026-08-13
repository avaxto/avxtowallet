<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="avxto_page">
        <h1>AVXTO Activity</h1>
        <p class="desc">
            Latest ERC-20 transfer activity for the {{ tokenSymbol }} contract on the Avalanche
            C-Chain, sourced directly from the on-chain transfer log via the same explorer data
            API used by the Activity page.
        </p>

        <div class="card contract_card">
            <div class="contract_row">
                <img v-if="tokenIcon" :src="tokenIcon" class="token_icon" alt="" />
                <div class="contract_info">
                    <div class="token_title">{{ tokenName }} ({{ tokenSymbol }})</div>
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
import { ava } from '@/AVA'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { Avalanche as ChainKitAvalanche } from '@avalanche-sdk/chainkit'
import Big from 'big.js'
import CopyText from '@/components/misc/CopyText.vue'
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

// How far back (in blocks) to scan for transfers. The list-transfers API does
// not expose a sort order, so we bound the range to the recent chain tip and
// sort the collected results client-side to guarantee newest-first display.
const BLOCK_RANGE = 300_000
const MAX_PAGES = 10
const DISPLAY_LIMIT = 50

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
        const transfers = ref<TransferRow[]>([])

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
                transfers.value = collected.slice(0, DISPLAY_LIMIT)
            } catch (e: any) {
                console.error('Failed to fetch AVXTO contract transfers:', e)
                error.value = e?.message || 'Failed to load AVXTO activity.'
            } finally {
                isLoading.value = false
            }
        }

        const refresh = () => {
            if (!isMainnet) return
            fetchTransfers()
        }

        onMounted(() => {
            if (isMainnet) {
                fetchTransfers()
            }
        })

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
    max-width: 760px;

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
