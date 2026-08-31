<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Bitcoin's actual HD receive/change chains — the one platform here where "HD"
  means what it does on Avalanche's X-chain: a growing set of addresses
  derived from an account key, scanned out to the BIP-44 gap limit past the
  last one that was ever used (see bitcoin/discovery.ts). Unlike the Avalanche
  page's synthetic "show at least 100" floor, this list is exactly what the
  wallet actually scanned — an address never checked for use is not something
  this page can show without an extra indexer request, and the gap-limited set
  IS the industry-standard answer to "what are this wallet's addresses"
  (Electrum and Ledger Live both stop at the same boundary).

  A single-key wallet (an imported WIF, or a watched address) has no chain to
  scan at all — see `BitcoinWallet.getScannedAddresses()`, which every kind
  populates uniformly, so this page needs no branching on wallet class to
  handle that case: it just renders whatever came back, and an empty Change
  section for a single-key wallet is the correct, honest answer.
-->
<template>
    <div class="btc_addresses_page">
        <div class="head">
            <h1>Addresses</h1>
            <p class="desc">
                Every address {{ isScanning ? 'found so far' : 'this wallet has scanned' }},
                derived by the {{ addressTypeLabel }} standard. Bitcoin generates a fresh
                address per payment for privacy — the ones already used are shown alongside
                the unused ones this wallet keeps in reserve.
            </p>
        </div>

        <div v-if="!wallet" class="unsupported">
            <p>No Bitcoin wallet is connected.</p>
        </div>

        <div v-else class="sections">
            <div class="section">
                <div class="section_head">
                    <span class="chain_badge receive">R</span>
                    <h2>Receive</h2>
                    <span class="count">{{ receiveAddresses.length }}</span>
                    <button class="refresh_but" @click="refresh" :disabled="isScanning">
                        <fa icon="sync"></fa>
                        {{ isScanning ? 'Scanning…' : 'Refresh' }}
                    </button>
                </div>
                <div class="addr_list">
                    <div v-if="receiveAddresses.length === 0" class="empty">
                        No addresses found{{ isScanning ? ' yet — still scanning.' : '.' }}
                    </div>
                    <div
                        v-for="item in receiveAddresses"
                        :key="'r-' + item.index"
                        class="addr_row"
                        :class="{ used: item.used }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <a
                            :href="addressUrl(item.address)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="addr mono"
                        >
                            {{ item.address }}
                        </a>
                        <span class="amt mono">{{ formatSats(item.balanceSats) }}</span>
                        <span class="status" :class="{ used: item.used }">
                            {{ item.used ? 'Used' : 'Unused' }}
                        </span>
                        <Tooltip text="Copy address to clipboard" class="icon_btn">
                            <CopyText :value="item.address" />
                        </Tooltip>
                    </div>
                </div>
            </div>

            <div class="section" v-if="!isSingleAddress">
                <div class="section_head">
                    <span class="chain_badge change">C</span>
                    <h2>Change</h2>
                    <span class="count">{{ changeAddresses.length }}</span>
                </div>
                <div class="addr_list">
                    <div v-if="changeAddresses.length === 0" class="empty">
                        No addresses found{{ isScanning ? ' yet — still scanning.' : '.' }}
                    </div>
                    <div
                        v-for="item in changeAddresses"
                        :key="'c-' + item.index"
                        class="addr_row"
                        :class="{ used: item.used }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <a
                            :href="addressUrl(item.address)"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="addr mono"
                        >
                            {{ item.address }}
                        </a>
                        <span class="amt mono">{{ formatSats(item.balanceSats) }}</span>
                        <span class="status" :class="{ used: item.used }">
                            {{ item.used ? 'Used' : 'Unused' }}
                        </span>
                        <Tooltip text="Copy address to clipboard" class="icon_btn">
                            <CopyText :value="item.address" />
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref, onMounted, watch } from 'vue'
import Big from 'big.js'

import CopyText from '@/components/misc/CopyText.vue'
import Tooltip from '@/components/misc/Tooltip.vue'
import { useBitcoinStore } from '@/platforms/bitcoin/store'
import { getBitcoinAddressUrl, SATS_PER_BTC } from '@/bitcoin/networks'
import type { ScannedAddress } from '@/bitcoin/discovery'

export default defineComponent({
    name: 'BitcoinAddresses',
    components: { CopyText, Tooltip },
    setup() {
        const btc = useBitcoinStore()
        const error = ref('')

        const wallet = computed(() => btc.wallet)
        const isScanning = computed(() => btc.isScanning)
        const addressTypeLabel = computed(() => wallet.value?.addressTypeLabel ?? '')

        // scanEpoch is what makes this re-read after a scan — the wallet
        // object is a shallowRef that mutates internally, so nothing here
        // would otherwise know a refresh had happened. Same pattern as
        // BitcoinFungibles.vue.
        const scannedAddresses = computed((): ScannedAddress[] => {
            void btc.scanEpoch
            // Rows merged in from another derivation scheme entirely (see
            // `ExtraCandidate` in platforms/bitcoin/wallet.ts) carry a
            // `scheme` label and do not belong to THIS wallet's own
            // receive/change chain — showing them here as if they were index-N
            // of this account would be simply wrong about what path they are
            // actually at.
            return (wallet.value?.getScannedAddresses() ?? []).filter((a) => !a.scheme)
        })

        const receiveAddresses = computed(() =>
            scannedAddresses.value.filter((a) => a.chain === 'receive')
        )
        const changeAddresses = computed(() =>
            scannedAddresses.value.filter((a) => a.chain === 'change')
        )

        // True for a single imported key, a watched single address, or the
        // Core-compatible candidate — none of which have a second chain to
        // send change to (see HdScanningWallet.getChangeAddress). Detected
        // from the scan's own shape rather than the wallet's class: every kind
        // populates `getScannedAddresses()` uniformly (see wallet.ts), so this
        // needs no `instanceof` branching to tell single-address wallets apart
        // from HD ones — a wallet with no change entries at all simply has
        // none to send to.
        const isSingleAddress = computed(
            () => receiveAddresses.value.length <= 1 && changeAddresses.value.length === 0
        )

        const addressUrl = (a: string) => getBitcoinAddressUrl(a, btc.network)

        const formatSats = (sats: number): string =>
            `${Big(sats).div(SATS_PER_BTC).toFixed(8).replace(/\.?0+$/, '') || '0'} ${
                btc.network.native.symbol
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
            // every time this page opens. Portfolio's own Bitcoin tab already
            // triggers this if it was visited first; this covers landing here
            // directly.
            if (scannedAddresses.value.length === 0) void refresh()
        })

        watch(() => btc.network.id, refresh)

        return {
            wallet,
            isScanning,
            addressTypeLabel,
            receiveAddresses,
            changeAddresses,
            isSingleAddress,
            addressUrl,
            formatSats,
            refresh,
            error,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

h1 {
    font-weight: normal;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.head {
    margin-bottom: 20px;
}

.unsupported {
    color: var(--primary-color-light);
    padding: 20px 0;
}

.sections {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.section {
    background-color: var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
}

.section_head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--bg);

    h2 {
        font-weight: 500;
        font-size: 1em;
        margin: 0;
        flex: 1;
    }
}

.chain_badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 0.7em;
    font-weight: bold;
    color: #fff;

    &.receive {
        background-color: #4caf50;
    }
    &.change {
        background-color: #9e9e9e;
    }
}

.count {
    font-size: 0.8em;
    color: var(--primary-color-light);
    background-color: var(--bg);
    border-radius: 10px;
    padding: 2px 8px;
}

.refresh_but {
    color: var(--secondary-color);
    font-size: 12px;
    opacity: 0.8;

    &:hover {
        opacity: 1;
    }
    &:disabled {
        opacity: 0.4;
        cursor: default;
    }
}

.addr_list {
    max-height: 320px;
    overflow-y: auto;
}

.empty {
    padding: 14px 16px;
    color: var(--primary-color-light);
    font-size: 0.85em;
}

.addr_row {
    display: grid;
    grid-template-columns: 32px 1fr max-content 60px auto;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    font-size: 0.83em;

    &:nth-child(even) {
        background-color: var(--bg);
    }
}

.idx {
    color: var(--primary-color-light);
    text-align: right;
    font-family: sans-serif;
    font-size: 0.85em;
}

.mono {
    font-family: monospace;
}

.addr {
    word-break: break-all;
    color: var(--primary-color);
    text-decoration: none;

    &:hover {
        color: var(--secondary-color);
    }
}

.amt {
    color: var(--primary-color-light);
    white-space: nowrap;
}

.status {
    font-size: 0.78em;
    color: var(--primary-color-light);
    text-align: right;

    &.used {
        color: var(--secondary-color);
    }
}

.icon_btn {
    display: inline-flex;

    :deep(.copyBut) {
        margin: 0;
    }

    :deep(.copyBut img) {
        max-height: 14px;
    }
}

.error {
    color: var(--error);
    font-size: 0.85em;
    margin-top: 14px;
}

@include main.mobile-device {
    .addr_row {
        grid-template-columns: 24px 1fr auto;
        font-size: 0.75em;

        .amt,
        .status {
            display: none;
        }
    }
}
</style>
