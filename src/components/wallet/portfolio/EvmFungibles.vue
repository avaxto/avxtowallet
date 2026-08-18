<template>
    <div class="evm_fungibles">
        <div class="filter_row">
            <label class="hide_zero_toggle">
                <input type="checkbox" v-model="hideDust" />
                Hide dust
            </label>
            <button class="refresh_but" @click="refresh" :disabled="loading">
                <fa icon="sync"></fa>
                Refresh
            </button>
        </div>

        <div class="headers">
            <p class="icon_col"></p>
            <p class="name_col">Asset</p>
            <p class="network_col">Network</p>
            <p class="balance_col">Balance</p>
        </div>

        <div class="scrollable no_scroll_bar">
            <div
                v-for="token in visibleTokens"
                :key="token.key"
                class="asset row"
            >
                <div class="icon_col">
                    <img v-if="token.logoUri" :src="token.logoUri" alt="" />
                    <span v-else class="icon_fallback">?</span>
                </div>
                <div class="name_col">
                    <p class="name">
                        {{ token.name || token.symbol }}
                        <span class="sym">({{ token.symbol }})</span>
                        <span v-if="token.isNative" class="native_tag">native</span>
                    </p>
                    <a
                        v-if="!token.isNative"
                        :href="explorerLink(token)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="addr"
                    >
                        {{ shortAddress(token.address) }}
                    </a>
                </div>
                <div class="network_col">
                    <span class="net_chip" :style="{ borderColor: token.network.color }">
                        <span class="net_dot" :style="{ backgroundColor: token.network.color }"></span>
                        {{ token.network.shortName }}
                    </span>
                </div>
                <div class="balance_col">
                    <p>{{ formatBalance(token.balance) }}</p>
                </div>
            </div>

            <div v-if="loading && !visibleTokens.length" class="empty">
                <Spinner class="spinner"></Spinner>
                <p>Scanning {{ networkCount }} networks…</p>
            </div>
            <div v-else-if="!visibleTokens.length" class="empty">
                <p>No assets found on any known EVM network.</p>
            </div>
        </div>

        <div v-if="degraded.length" class="degraded alert alert-warning">
            <p>
                Could not read
                {{ degraded.length }}
                {{ degraded.length === 1 ? 'network' : 'networks' }}:
                {{ degraded.map((d) => d.network.shortName).join(', ') }}.
                Everything else above is complete.
                <button
                    v-if="missingKeyNetworks.length"
                    type="button"
                    class="key_prompt_but"
                    @click="showKeyForm = !showKeyForm"
                >
                    {{ showKeyForm ? 'Hide' : 'Add Etherscan API key' }}
                </button>
            </p>
            <EtherscanKeyForm
                v-if="showKeyForm"
                :affected-networks="missingKeyNetworks.map((d) => d.network.shortName).join(', ')"
                @saved="onKeySaved"
                @close="showKeyForm = false"
            ></EtherscanKeyForm>
        </div>
    </div>
</template>

<script lang="ts">
/**
 * The unified EVM platform's asset list.
 *
 * Separate from `Fungibles.vue` rather than an extension of it: that component
 * is built around Avalanche's X/P chain assets and the Avalanche assets store,
 * none of which exist here, and its rows resolve balances through the
 * Avalanche web3 singleton. Sharing it would mean threading "which platform am
 * I?" through every row.
 */
import { defineComponent, computed, ref, watch, onMounted } from 'vue'
import Big from 'big.js'

import Spinner from '@/components/misc/Spinner.vue'
import EtherscanKeyForm from '@/components/wallet/portfolio/EtherscanKeyForm.vue'
import {
    useEvmPortfolioStore,
    type EvmNetworkResult,
    type EvmPortfolioToken,
} from '@/stores/evmPortfolio'
import { useActivePlatformStore } from '@/platforms'
import { useEvmStore } from '@/platforms/evm/store'

/** Below this, a balance is almost certainly airdropped spam rather than a holding. */
const DUST_THRESHOLD = Big('0.000001')

export default defineComponent({
    name: 'EvmFungibles',
    components: { Spinner, EtherscanKeyForm },
    props: {
        search: { type: String, default: '' },
    },
    setup(props) {
        const portfolio = useEvmPortfolioStore()
        const platformStore = useActivePlatformStore()
        const evmStore = useEvmStore()

        const hideDust = ref(true)

        const address = computed((): string | null => {
            return platformStore.activeWallet?.getPrimaryAddress() ?? null
        })

        const loading = computed(() => portfolio.loading)
        const networkCount = computed(() => portfolio.results.length)

        /** Networks that returned nothing usable, so a short list is never mistaken for an empty wallet. */
        const degraded = computed(() => portfolio.failedNetworks)

        /** The subset of `degraded` an Etherscan key would actually unblock. */
        const missingKeyNetworks = computed((): EvmNetworkResult[] =>
            degraded.value.filter((d) => d.network.explorerApi.requiresKey)
        )

        const showKeyForm = ref(false)

        const visibleTokens = computed((): EvmPortfolioToken[] => {
            let list = portfolio.tokens
            if (hideDust.value) {
                // Never hide the native asset — a nearly-empty gas balance is
                // exactly what a user needs to see before trying to send.
                list = list.filter((t) => t.isNative || t.balance.gte(DUST_THRESHOLD))
            }
            const q = props.search.trim().toLowerCase()
            if (q) {
                list = list.filter(
                    (t) =>
                        t.symbol.toLowerCase().includes(q) ||
                        t.name.toLowerCase().includes(q) ||
                        t.address.toLowerCase().includes(q) ||
                        t.network.shortName.toLowerCase().includes(q)
                )
            }
            return list
        })

        const formatBalance = (value: Big): string => {
            // Big.toFixed avoids the exponent notation Number would produce for
            // very small balances, which reads as a different number entirely.
            const fixed = value.toFixed(6)
            return fixed.replace(/\.?0+$/, '') || '0'
        }

        const shortAddress = (addr: string): string =>
            addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr

        const explorerLink = (token: EvmPortfolioToken): string =>
            `${token.network.explorerUrl}/token/${token.address}`

        /** The Refresh button — an explicit user request, so always re-scan. */
        const refresh = async () => {
            if (!address.value) return
            await portfolio.fetch(address.value, evmStore.network.isTestnet)
        }

        /**
         * Mount / wallet-change: load only if this scan has not been done.
         * Navigating back to the portfolio, or opening the token picker, then
         * reuses the existing list instead of re-scanning every network.
         */
        const load = async () => {
            if (!address.value) return
            await portfolio.ensureLoaded(address.value, evmStore.network.isTestnet)
        }

        const onKeySaved = () => {
            showKeyForm.value = false
            refresh()
        }

        watch(address, load)
        onMounted(load)

        return {
            hideDust,
            loading,
            networkCount,
            degraded,
            missingKeyNetworks,
            showKeyForm,
            onKeySaved,
            visibleTokens,
            formatBalance,
            shortAddress,
            explorerLink,
            refresh,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.evm_fungibles {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.filter_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    color: var(--primary-color-light);
    margin-bottom: 8px;
}

.refresh_but {
    color: var(--secondary-color);
    font-size: 13px;
    opacity: 0.8;

    &:hover { opacity: 1; }
    &:disabled { opacity: 0.4; cursor: default; }
}

.headers,
.row {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) max-content minmax(0, 140px);
    column-gap: 14px;
    align-items: center;
}

.headers {
    font-size: 12px;
    color: var(--primary-color-light);
    border-bottom: 1px solid var(--bg-light);
    padding-bottom: 4px;
}

.row {
    padding: 8px 0;
    border-bottom: 1px solid var(--bg-light);
}

.icon_col {
    img {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: contain;
    }
}

.icon_fallback {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background-color: var(--bg-light);
    color: var(--primary-color-light);
    font-size: 12px;
}

.name_col {
    min-width: 0;

    .name {
        font-size: 14px;
        color: var(--primary-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .sym {
        color: var(--primary-color-light);
        font-size: 12px;
    }

    .addr {
        font-family: monospace;
        font-size: 11px;
        color: var(--primary-color-light);
        text-decoration: none;

        &:hover { color: var(--secondary-color); }
    }
}

.native_tag {
    margin-left: 6px;
    font-size: 10px;
    text-transform: uppercase;
    color: var(--primary-color-light);
    border: 1px solid var(--bg-light);
    border-radius: 3px;
    padding: 0 4px;
}

.net_chip {
    display: inline-flex;
    align-items: center;
    font-size: 11px;
    white-space: nowrap;
    color: var(--primary-color);
    border: 1px solid var(--bg-light);
    border-radius: 10px;
    padding: 1px 8px 1px 6px;
}

.net_dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    margin-right: 5px;
    flex-shrink: 0;
}

.balance_col {
    text-align: right;
    font-size: 14px;
    white-space: nowrap;
}

.degraded {
    font-size: 12px;
    margin: 8px 0;
    padding: 6px 10px;
}

.key_prompt_but {
    color: var(--secondary-color);
    text-decoration: underline;
    margin-left: 4px;
    font-size: 12px;
}

.scrollable {
    overflow-y: auto;
    flex-grow: 1;
}

.empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 30px 12px;
    color: var(--primary-color-light);
}

.spinner {
    font-size: 28px;
    margin-bottom: 14px;
    color: var(--secondary-color);
}

@include main.mobile-device {
    .headers,
    .row {
        grid-template-columns: 32px minmax(0, 1fr) minmax(0, 100px);
    }

    .network_col {
        grid-column: 2 / 3;
        grid-row: 2;
    }
}
</style>
