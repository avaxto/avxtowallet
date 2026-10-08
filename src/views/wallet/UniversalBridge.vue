<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Bridge: move native coins and tokens between every chain the wallet serves —
  EVM networks (Avalanche C-Chain included), Solana and Bitcoin — through the
  universal bridge layer in src/bridge. Every enabled provider that serves the
  pair is quoted side by side (Wormhole for EVM ↔ EVM ↔ Solana and AVXTO's NTT,
  THORChain for native BTC); the user picks a route and the wallet's own
  signers send it. Transfers are remembered so they can be tracked and claimed
  after a reload.

  Quotes are open to everyone; sending and claiming are premium actions behind
  the Moats burn gate (useBaseAssetGate).
-->
<template>
    <div class="universal_bridge">
        <div class="head">
            <h1>Bridge</h1>
            <p class="desc">
                Move AVAX, ETH, BTC, SOL and tokens between Avalanche C-Chain, other EVM chains, Solana
                and Bitcoin. Routes from every enabled provider are compared side by side.
            </p>
            <div class="net_toggle" role="group" aria-label="Network">
                <button type="button" :class="{ on: !testnet }" @click="setTestnet(false)">Mainnet</button>
                <button type="button" :class="{ on: testnet }" @click="setTestnet(true)">Testnet</button>
            </div>
        </div>

        <section class="card">
            <!-- From -->
            <div class="side">
                <div class="side_head">
                    <label for="bridge-from-chain">From</label>
                    <button v-if="balance !== null && fromAsset" type="button" class="balance_btn" @click="setMax">
                        Balance: {{ fmt(balance, fromAsset.decimals) }} {{ fromAsset.symbol }}
                    </button>
                </div>
                <select id="bridge-from-chain" v-model="fromChainId" class="field">
                    <option v-for="c in chains" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>

                <label class="sub_label" for="bridge-from-token">Token</label>
                <select id="bridge-from-token" v-model="fromKey" class="field" :disabled="loadingHeld">
                    <option v-if="loadingHeld" value="">Reading your portfolio…</option>
                    <option v-for="t in heldTokens" :key="t.address" :value="t.address">
                        {{ t.symbol }} — {{ fmt(t.balance, t.decimals) }}{{ t.address === 'native' ? '' : ' · ' + short(t.address) }}{{ t.address !== 'native' && t.verified ? ' ✓' : '' }}
                    </option>
                </select>
                <p v-if="!loadingHeld && heldTokens.length <= 1 && !sender" class="muted small">
                    Connect a wallet on {{ fromChainName }} to see its tokens.
                </p>
                <p v-if="fromAsset && fromAsset.address !== 'native'" class="muted small token_line">
                    {{ fromAsset.symbol }}
                    <RegistryCheck v-if="fromChainEvmId" :address="fromAsset.address" :chain-id="fromChainEvmId"></RegistryCheck>
                    <span class="mono">{{ fromAsset.address }}</span>
                </p>

                <div class="amount_row">
                    <input
                        v-model="amountText"
                        class="amount_input"
                        inputmode="decimal"
                        placeholder="0.0"
                        aria-label="Amount"
                    />
                    <button v-if="balance !== null" type="button" class="max_btn" @click="setMax">MAX</button>
                </div>
                <p v-if="amountError" class="form_error">{{ amountError }}</p>
            </div>

            <div class="flip_row">
                <button type="button" class="flip_btn" title="Swap direction" @click="flip">⇅</button>
            </div>

            <!-- To -->
            <div class="side">
                <div class="side_head">
                    <label for="bridge-to-chain">To</label>
                </div>
                <select id="bridge-to-chain" v-model="toChainId" class="field">
                    <option v-for="c in destChains" :key="c.id" :value="c.id">{{ c.name }}</option>
                </select>
                <label class="sub_label" for="bridge-receive-token">Receive token</label>
                <div class="combo">
                    <input
                        id="bridge-receive-token"
                        v-model="receiveQuery"
                        class="field"
                        :placeholder="receiveToken ? '' : 'Any — type a symbol, e.g. USDC'"
                        spellcheck="false"
                        autocomplete="off"
                        role="combobox"
                        aria-autocomplete="list"
                        :aria-expanded="showSuggestions"
                        @focus="suggestionsOpen = true"
                        @input="onReceiveInput"
                        @keydown.esc="suggestionsOpen = false"
                    />
                    <button v-if="receiveToken || receiveQuery" type="button" class="clear_btn" title="Any token" @click="clearReceive">✕</button>
                    <ul v-if="showSuggestions" class="suggestions" role="listbox">
                        <li v-if="searching" class="muted small">Searching…</li>
                        <li
                            v-for="t in suggestions"
                            :key="t.address"
                            role="option"
                            class="suggestion"
                            @mousedown.prevent="pickReceive(t)"
                        >
                            <span class="sym">{{ t.symbol }}</span>
                            <span class="muted small">{{ t.name }}</span>
                            <span class="muted small mono">{{ t.address === 'native' ? 'native' : short(t.address) }}</span>
                            <span class="src" :class="{ verified: t.verified }">{{ sourceLabel(t) }}</span>
                        </li>
                        <li v-if="!searching && !suggestions.length && receiveQuery.trim()" class="muted small">
                            No token called “{{ receiveQuery.trim() }}” found on {{ toChainName }}.
                        </li>
                    </ul>
                </div>
                <p v-if="receiveToken" class="muted small token_line">
                    Receive {{ receiveToken.symbol }}
                    <span v-if="receiveToken.address !== 'native'" class="mono">{{ receiveToken.address }}</span>
                    <span v-if="receiveUnverified" class="warn_badge">not in the registry — check the address</span>
                </p>
                <p v-if="searchNote" class="muted small">{{ searchNote }}</p>
                <p v-if="receiveError" class="form_error">{{ receiveError }}</p>

                <label class="sub_label" for="bridge-recipient">Recipient</label>
                <input
                    id="bridge-recipient"
                    v-model.trim="recipient"
                    class="field mono"
                    :placeholder="toChain ? `${toChain.name} address` : 'Address'"
                    spellcheck="false"
                    autocomplete="off"
                    @input="recipientTouched = true"
                />
                <p v-if="recipient && recipientErr" class="form_error">{{ recipientErr }}</p>
                <p v-else-if="recipient && recipient === ownDestAddress" class="muted small">Your own {{ toChainName }} address.</p>
                <button
                    v-if="ownDestAddress && recipient !== ownDestAddress"
                    type="button"
                    class="link_btn"
                    @click="useOwnAddress"
                >
                    Use my {{ toChainName }} address
                </button>
            </div>
        </section>

        <!-- Which bridge, and why, for Avalanche ↔ Ethereum and Bitcoin. -->
        <section v-if="usesAvalancheBridge" class="notice" role="note">
            <strong>Using the Avalanche Bridge.</strong>
            Between Avalanche and Ethereum, tokens the official Avalanche Bridge carries always go through it, instead of
            Wormhole or THORChain. You receive <strong>{{ avalancheBridgeReceives }}</strong> at your own address, minus the
            bridge's fee.
            <template v-if="avalancheBridgeOffboardWeth"> Unwrapping WETH to ETH is an optional extra step once it arrives.</template>
        </section>
        <section v-else-if="ethereumNotCarried" class="notice" role="note">
            <strong>Not an Avalanche Bridge token.</strong>
            Between Avalanche and Ethereum the Avalanche Bridge is used whenever it carries the token; it does not carry
            {{ fromAssetSymbol }}, so the route below uses another bridge.
        </section>
        <section v-if="bitcoinPair" class="notice" role="note">
            <strong>Bitcoin.</strong>
            The Avalanche Bridge's Bitcoin route (BTC ↔ BTC.b) is not available in this wallet yet, so Bitcoin transfers use
            THORChain, a native-to-native swap.
        </section>

        <!-- Routes -->
        <section class="routes">
            <p v-if="noProviders" class="muted center">{{ noProvidersReason }}</p>
            <p v-else-if="quoting" class="muted center">Finding routes…</p>
            <template v-else>
                <div
                    v-for="q in sortedQuotes"
                    :key="quoteKey(q)"
                    role="button"
                    tabindex="0"
                    class="route"
                    :class="{ selected: quoteKey(q) === selectedKey }"
                    :aria-pressed="quoteKey(q) === selectedKey"
                    @click="selectedKey = quoteKey(q)"
                    @keydown.enter.prevent="selectedKey = quoteKey(q)"
                    @keydown.space.prevent="selectedKey = quoteKey(q)"
                >
                    <div class="route_head">
                        <span class="route_name">{{ q.routeName }}</span>
                        <span class="eta">~{{ eta(q.etaSeconds) }}</span>
                    </div>
                    <div class="route_receive">
                        You receive <strong>{{ fmt(q.receive.amount, q.receive.asset.decimals) }} {{ q.receive.asset.symbol }}</strong>
                        <span class="kind" :class="q.receive.kind">{{ kindLabel(q.receive.kind) }}</span>
                    </div>
                    <div v-if="q.receive.asset.address !== 'native'" class="dest_token">
                        {{ q.receive.asset.symbol }} on {{ q.request.toChain.name }}:
                        <a :href="tokenLink(q.receive.asset)" target="_blank" rel="noopener noreferrer" class="mono">{{ q.receive.asset.address }}</a>
                    </div>
                    <div v-if="receiveToken" class="match" :class="{ ok: routeMatches(q) }">
                        {{ routeMatches(q) ? `✓ Delivers ${receiveToken.symbol}` : `Delivers ${q.receive.asset.symbol}, not ${receiveToken.symbol}` }}
                    </div>
                    <div v-if="hasMin(q)" class="muted small">
                        At least {{ fmt(minOf(q), q.receive.asset.decimals) }} {{ q.receive.asset.symbol }}, or refunded
                    </div>
                    <ul class="fees">
                        <li v-for="(f, i) in q.fees" :key="i">
                            {{ f.label }}: {{ fmt(f.amount, f.decimals) }} {{ f.symbol }}
                            <span class="muted">({{ paidAsLabel(f.paidAs) }})</span>
                        </li>
                    </ul>
                    <p v-if="q.needsClaim" class="claim_note">
                        Finish with a claim on {{ q.request.toChain.name }} — keep some {{ q.request.toChain.native.symbol }} there for gas.
                    </p>
                    <p v-if="q.providerId === 'wormhole'" class="wormhole_warn">
                        ⚠ Wormhole only works when {{ q.request.from.symbol }} has an equivalent on {{ q.request.toChain.name }}.
                        Check that <strong>{{ q.receive.asset.symbol }}</strong> at the contract address above is the token you
                        expect before bridging — if it isn't, getting your funds back means bridging them back again.
                    </p>
                    <ul v-if="q.warnings.length" class="warnings">
                        <li v-for="(w, i) in q.warnings" :key="i">{{ w }}</li>
                    </ul>
                </div>
                <p v-if="receiveToken && quotes.length && !quotes.some(routeMatches)" class="route_error">
                    No route delivers {{ receiveToken.symbol }} for this pair. The routes above deliver something else — or
                    clear the receive token.
                </p>
                <div v-for="e in quoteErrors" :key="e.providerId" class="route_error">
                    <strong>{{ e.providerName }}:</strong> {{ e.message }}
                </div>
            </template>
        </section>

        <!-- Signer + action -->
        <section class="action">
            <p v-if="selectedProviderName" class="using">
                Bridge in use: <strong>{{ selectedProviderName }}</strong>
                <span v-if="selectedRouteName && selectedRouteName !== selectedProviderName" class="muted">— {{ selectedRouteName }}</span>
            </p>
            <p v-if="offlineOn" class="error_msg">
                Offline signing is on. Bridging needs every transaction broadcast — turn it off to bridge.
            </p>
            <template v-else-if="fromChain && !canSign">
                <p class="error_msg">{{ signHint }}</p>
                <v-btn
                    v-if="canSwitchEvm"
                    class="button_secondary"
                    depressed
                    small
                    :loading="switching"
                    @click="switchEvmChain"
                >
                    Switch EVM wallet to {{ fromChain.name }}
                </v-btn>
            </template>

            <v-btn
                class="button_primary bridge_btn"
                depressed
                block
                :loading="busy"
                :disabled="!canBridge || isBlocked"
                @click="gatedAction(bridge)"
            >
                {{ bridgeLabel }}
            </v-btn>

            <ol v-if="steps.length" class="steps">
                <li v-for="s in steps" :key="s.step" :class="s.state">
                    <span class="dot">{{ s.state === 'done' ? '✓' : '…' }}</span> {{ s.step }}
                </li>
            </ol>
            <p v-if="error" class="error_msg">{{ error }}</p>
            <div v-if="lastTransfer" class="result">
                <p>
                    Sent. {{ statusLabel(lastTransfer) }}
                    <span v-if="lastTransfer.statusDetail">— {{ lastTransfer.statusDetail }}</span>
                </p>
                <p class="links">
                    <a v-if="txLink(lastTransfer.fromChainId, lastTransfer.sourceTxHash)" :href="txLink(lastTransfer.fromChainId, lastTransfer.sourceTxHash)" target="_blank" rel="noopener noreferrer">Source transaction ↗</a>
                    <a :href="trackerUrl(lastTransfer)" target="_blank" rel="noopener noreferrer">Track on {{ trackerName(lastTransfer) }} ↗</a>
                </p>
                <v-btn class="button_secondary" depressed small @click="reset">Done</v-btn>
            </div>
        </section>

        <!-- History -->
        <section v-if="history.length" class="history">
            <div class="history_head">
                <h3>Your transfers</h3>
                <button type="button" class="link_btn" :disabled="refreshingAll" @click="refreshAll">
                    {{ refreshingAll ? 'Refreshing…' : 'Refresh all' }}
                </button>
            </div>
            <div v-for="t in history" :key="t.id" class="transfer">
                <div class="transfer_head">
                    <span>
                        {{ fmtStr(t.amountIn, t.fromDecimals) }} {{ t.fromSymbol }}
                        <span class="muted">{{ chainName(t.fromChainId) }}</span>
                        →
                        {{ t.toSymbol }} <span class="muted">{{ chainName(t.toChainId) }}</span>
                    </span>
                    <span class="status" :class="t.status">{{ statusLabel(t) }}</span>
                </div>
                <p class="muted small">
                    {{ t.routeName }} · {{ when(t.createdAt) }}<span v-if="t.statusDetail"> · {{ t.statusDetail }}</span>
                </p>
                <div class="transfer_actions">
                    <a v-if="txLink(t.fromChainId, t.sourceTxHash)" :href="txLink(t.fromChainId, t.sourceTxHash)" target="_blank" rel="noopener noreferrer">Source ↗</a>
                    <a v-if="t.destTxHash && txLink(t.toChainId, t.destTxHash)" :href="txLink(t.toChainId, t.destTxHash)" target="_blank" rel="noopener noreferrer">Destination ↗</a>
                    <a :href="trackerUrl(t)" target="_blank" rel="noopener noreferrer">{{ trackerName(t) }} ↗</a>
                    <button v-if="pending(t)" type="button" class="link_btn" :disabled="refreshingId === t.id" @click="refreshOne(t)">
                        {{ refreshingId === t.id ? 'Checking…' : 'Refresh' }}
                    </button>
                    <v-btn
                        v-if="t.status === 'ready_to_claim'"
                        class="button_primary"
                        depressed
                        x-small
                        :loading="claimingId === t.id"
                        :disabled="claimingId !== '' || isBlocked"
                        @click="gatedAction(() => claim(t))"
                    >
                        Claim on {{ chainName(t.toChainId) }}
                    </v-btn>
                    <v-btn
                        v-if="followUpLabel(t)"
                        class="button_secondary"
                        depressed
                        x-small
                        :loading="claimingId === t.id"
                        :disabled="claimingId !== '' || isBlocked"
                        @click="gatedAction(() => followUp(t))"
                    >
                        {{ followUpLabel(t) }}
                    </v-btn>
                    <a
                        v-if="t.data && t.data.unwrapTxHash"
                        :href="txLink(t.toChainId, String(t.data.unwrapTxHash))"
                        target="_blank"
                        rel="noopener noreferrer"
                    >Unwrap ↗</a>
                    <button v-if="!pending(t)" type="button" class="link_btn muted" @click="forget(t)">Remove</button>
                </div>
                <p v-if="claimErrors[t.id]" class="form_error">{{ claimErrors[t.id] }}</p>
            </div>
        </section>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'

import { listBridgeChains, getBridgeChain } from '@/bridge/chains'
import { quoteAll, providersFor, getProvider } from '@/bridge/registry'
import { bridgeTransfers, removeTransfer } from '@/bridge/history'
import { canSignOn, ownAddressOn } from '@/bridge/signers'
import { recipientError } from '@/bridge/address'
import { nativeAsset, parseAmount, formatAmount, amountInput, readBalance } from '@/bridge/assets'
import {
    portfolioTokens,
    suggestReceiveTokens,
    resolveToken,
    deliversToken,
    type HeldToken,
    type TokenSuggestion,
} from '@/bridge/tokens'
import { runTransfer, runClaim, runFollowUp, refreshTransfer, isPending } from '@/bridge/run'
import { AVALANCHE_BRIDGE_ID, avalancheBridgeTrackerUrl, bridgeTokenFor, WETH_ETHEREUM } from '@/bridge/avalancheBridge/provider'
import { explorerAddressUrl, getEvmNetworkByChainId } from '@/evm/networkRegistry'
import { wormholescanUrl } from '@/bridge/wormhole/provider'
import { thorchainTrackerUrl, THORCHAIN_ID } from '@/bridge/thorchain/provider'
import { NATIVE, type BridgeAsset, type BridgeChain, type BridgeQuote, type BridgeTransfer, type ReceiveKind } from '@/bridge/types'
import { getPlatform } from '@/platforms'
import { useEvmStore } from '@/platforms/evm/store'
import { useOfflineSigningStore } from '@/stores'
import { SessionAuthCancelled } from '@/js/security/authorize'
import { errorToString } from '@/helpers/helper'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'
import RegistryCheck from '@/components/misc/RegistryCheck.vue'


const DEFAULT_PAIRS: Record<string, [string, string]> = {
    mainnet: ['evm:43114', 'evm:1'],
    testnet: ['evm:43113', 'evm:11155111'],
}
const QUOTE_DEBOUNCE_MS = 600
const SEARCH_DEBOUNCE_MS = 400
const POLL_MS = 30_000
/** Native coin kept back by MAX, for the source chain's own fees. */
const NATIVE_RESERVE: Record<string, bigint> = {
    evm: BigInt('5000000000000000'), // 0.005 of an 18-decimal coin
    solana: BigInt('10000000'), // 0.01 SOL
    bitcoin: BigInt('20000'), // 20,000 sats
}

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: a cached instance would
    // come back with stale quotes and balances.
    name: 'universal_bridge',
    components: { RegistryCheck },
    setup() {
        // Premium feature: sending and claiming check the Moats AVXTO burn
        // requirement first (useBaseAssetGate). Quotes stay open to all.
        const { isBlocked, gatedAction } = useBaseAssetGate()
        const offline = useOfflineSigningStore()
        const evmStore = useEvmStore()

        const testnet = ref(false)
        const chains = computed(() => listBridgeChains().filter((c) => c.isTestnet === testnet.value))
        const fromChainId = ref(DEFAULT_PAIRS.mainnet[0])
        const toChainId = ref(DEFAULT_PAIRS.mainnet[1])
        const fromChain = computed<BridgeChain | undefined>(() => chains.value.find((c) => c.id === fromChainId.value))
        const toChain = computed<BridgeChain | undefined>(() => chains.value.find((c) => c.id === toChainId.value))
        const destChains = computed(() => chains.value.filter((c) => c.id !== fromChainId.value))

        const fromChainName = computed(() => fromChain.value?.name ?? '')
        const fromChainEvmId = computed(() => fromChain.value?.evmChainId)
        const toChainName = computed(() => toChain.value?.name ?? '')

        const setTestnet = (on: boolean) => {
            if (testnet.value === on) return
            testnet.value = on
            const [f, t] = DEFAULT_PAIRS[on ? 'testnet' : 'mainnet']
            fromChainId.value = chains.value.some((c) => c.id === f) ? f : chains.value[0]?.id ?? ''
            toChainId.value = chains.value.some((c) => c.id === t) ? t : destChains.value[0]?.id ?? ''
        }

        // ── what to send: the portfolio on the source chain ──
        const sender = computed(() => (fromChain.value ? ownAddressOn(fromChain.value) : ''))
        const heldTokens = ref<HeldToken[]>([])
        const loadingHeld = ref(false)
        const fromKey = ref<string>(NATIVE)
        const fromAsset = computed<BridgeAsset | null>(() => {
            const c = fromChain.value
            if (!c) return null
            const held = heldTokens.value.find((t) => t.address === fromKey.value)
            if (held) return { chainId: held.chainId, address: held.address, symbol: held.symbol, decimals: held.decimals, name: held.name }
            return fromKey.value === NATIVE ? nativeAsset(c) : null
        })
        let heldSeq = 0
        const loadHeld = async () => {
            const c = fromChain.value
            if (!c) return
            const seq = ++heldSeq
            heldTokens.value = [Object.assign(nativeAsset(c), { balance: BigInt(0), verified: true })]
            loadingHeld.value = true
            try {
                const list = await portfolioTokens(c, sender.value)
                if (seq !== heldSeq) return
                heldTokens.value = list
                if (!list.some((t) => t.address === fromKey.value)) fromKey.value = NATIVE
            } finally {
                if (seq === heldSeq) loadingHeld.value = false
            }
        }
        watch([fromChainId, sender], loadHeld)

        watch(fromChainId, () => {
            fromKey.value = NATIVE
            if (toChainId.value === fromChainId.value || !toChain.value) toChainId.value = destChains.value[0]?.id ?? ''
        })

        // ── what to receive: open ended, suggested ──
        const receiveQuery = ref('')
        const receiveToken = ref<BridgeAsset | null>(null)
        const receiveUnverified = ref(false)
        const suggestions = ref<TokenSuggestion[]>([])
        const searching = ref(false)
        const suggestionsOpen = ref(false)
        const searchNote = ref('')
        const receiveError = ref('')
        const showSuggestions = computed(() => suggestionsOpen.value && !!receiveQuery.value.trim() && (searching.value || suggestions.value.length > 0 || !receiveToken.value))
        let searchTimer: ReturnType<typeof setTimeout> | null = null
        let searchSeq = 0
        const runSearch = async () => {
            const c = toChain.value
            const q = receiveQuery.value.trim()
            const seq = ++searchSeq
            if (!c || !q) {
                suggestions.value = []
                searching.value = false
                return
            }
            searching.value = true
            try {
                const res = await suggestReceiveTokens(c, q)
                if (seq !== searchSeq) return
                suggestions.value = res.suggestions
                searchNote.value = res.webError
                    ? res.webError
                    : res.searchedWeb && res.suggestions.length
                    ? `Not in the local registry — results from public token lists. Check the address before bridging.`
                    : ''
            } catch (e) {
                if (seq === searchSeq) searchNote.value = 'Token search failed.'
            } finally {
                if (seq === searchSeq) searching.value = false
            }
        }
        const onReceiveInput = () => {
            receiveToken.value = null
            receiveError.value = ''
            suggestionsOpen.value = true
            if (searchTimer) clearTimeout(searchTimer)
            searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS)
        }
        const pickReceive = async (t: TokenSuggestion) => {
            const c = toChain.value
            if (!c) return
            suggestionsOpen.value = false
            receiveQuery.value = t.symbol
            receiveError.value = ''
            try {
                receiveToken.value = await resolveToken(c, t)
                receiveUnverified.value = !t.verified
            } catch (e) {
                receiveToken.value = null
                receiveError.value = errorToString(e)
            }
        }
        const clearReceive = () => {
            receiveQuery.value = ''
            receiveToken.value = null
            receiveUnverified.value = false
            suggestions.value = []
            searchNote.value = ''
            receiveError.value = ''
        }
        // A token on one chain means nothing on another.
        watch(toChainId, clearReceive)
        const sourceLabel = (t: TokenSuggestion) =>
            t.source === 'native' ? 'native' : t.verified ? '✓ registry' : t.source === 'tokenlist' ? 'Uniswap list' : 'CoinGecko'
        const routeMatches = (q: BridgeQuote) => (receiveToken.value ? deliversToken(q.receive.asset, receiveToken.value) : true)

        // ── balance ──
        const balance = ref<bigint | null>(null)
        let balanceSeq = 0
        const loadBalance = async () => {
            const c = fromChain.value
            const a = fromAsset.value
            balance.value = null
            if (!c || !a || !sender.value) return
            const seq = ++balanceSeq
            try {
                const b = await readBalance(c, a, sender.value)
                if (seq === balanceSeq) balance.value = b
            } catch (e) {
                console.warn('[Bridge] balance unavailable:', e)
            }
        }
        watch([fromAsset, sender], loadBalance)

        // ── amount ──
        const amountText = ref('')
        const amount = computed(() => (fromAsset.value ? parseAmount(amountText.value, fromAsset.value.decimals) : null))
        const insufficient = computed(() => amount.value !== null && balance.value !== null && amount.value > balance.value)
        const amountError = computed(() => {
            if (!amountText.value || !fromAsset.value) return ''
            if (amount.value === null) return `Enter an amount with at most ${fromAsset.value.decimals} decimals.`
            if (insufficient.value) return `More than your ${fromAsset.value.symbol} balance.`
            return ''
        })
        const setMax = () => {
            const a = fromAsset.value
            const c = fromChain.value
            if (!a || !c || balance.value === null) return
            let v = balance.value
            if (a.address === NATIVE) {
                const reserve = NATIVE_RESERVE[c.kind] ?? BigInt(0)
                v = v > reserve ? v - reserve : BigInt(0)
            }
            amountText.value = v > BigInt(0) ? amountInput(v, a.decimals) : ''
        }

        // ── recipient ──
        const recipient = ref('')
        const recipientTouched = ref(false)
        const ownDestAddress = computed(() => (toChain.value ? ownAddressOn(toChain.value) : ''))
        const recipientErr = computed(() => (toChain.value ? recipientError(toChain.value, recipient.value) : ''))
        const useOwnAddress = () => {
            recipient.value = ownDestAddress.value
            recipientTouched.value = false
        }
        watch(
            ownDestAddress,
            (addr) => {
                if (!recipientTouched.value) recipient.value = addr
            },
            { immediate: true }
        )
        watch(toChainId, () => {
            // A recipient typed for one chain kind is meaningless on another.
            recipientTouched.value = false
            recipient.value = ownDestAddress.value
        })

        const flip = () => {
            const f = fromChainId.value
            const t = toChainId.value
            if (!t) return
            fromChainId.value = t
            toChainId.value = f
        }

        // ── quotes ──
        const quotes = ref<BridgeQuote[]>([])
        const quoteErrors = ref<{ providerId: string; providerName: string; message: string }[]>([])
        const quoting = ref(false)
        const selectedKey = ref('')
        const quoteKey = (q: BridgeQuote) => `${q.providerId}|${q.routeId}`
        const selectedQuote = computed(() => quotes.value.find((q) => quoteKey(q) === selectedKey.value) ?? null)

        const usesAvalancheBridge = computed(
            () => !!fromAsset.value && !!toChain.value && providersFor(fromAsset.value, toChain.value).some((p) => p.id === AVALANCHE_BRIDGE_ID)
        )
        const avalancheBridgeReceives = computed(() => {
            const a = fromAsset.value
            const t = a ? bridgeTokenFor(a.chainId, a.address === NATIVE ? WETH_ETHEREUM : a.address) : undefined
            if (!t) return ''
            return toChain.value?.id === 'evm:43114' ? `${t.symbol}.e on Avalanche` : `${t.symbol} on Ethereum`
        })
        const avalancheBridgeOffboardWeth = computed(() => avalancheBridgeReceives.value === 'WETH on Ethereum')
        const isEthAvalanchePair = computed(() => {
            const ids = [fromChain.value?.id, toChain.value?.id]
            return ids.includes('evm:1') && ids.includes('evm:43114')
        })
        const ethereumNotCarried = computed(() => isEthAvalanchePair.value && !usesAvalancheBridge.value)
        const bitcoinPair = computed(() => fromChain.value?.kind === 'bitcoin' || toChain.value?.kind === 'bitcoin')
        const fromAssetSymbol = computed(() => fromAsset.value?.symbol ?? '')
        const selectedProviderName = computed(() => (selectedQuote.value ? getProvider(selectedQuote.value.providerId)?.name ?? '' : ''))
        const selectedRouteName = computed(() => selectedQuote.value?.routeName ?? '')
        const tokenLink = (a: BridgeAsset) => {
            const c = getBridgeChain(a.chainId)
            const n = c?.evmChainId ? getEvmNetworkByChainId(c.evmChainId) : undefined
            if (n) return explorerAddressUrl(n, a.address)
            if (c?.kind === 'solana') return `https://solscan.io/token/${a.address}${c.isTestnet ? '?cluster=devnet' : ''}`
            return ''
        }
        const noProviders = computed(() => {
            if (!fromAsset.value || !toChain.value) return false
            return providersFor(fromAsset.value, toChain.value).length === 0
        })
        const noProvidersReason = computed(() => {
            const f = fromChain.value
            const t = toChain.value
            if (!f || !t) return ''
            if ((f.kind === 'bitcoin' && t.kind === 'solana') || (f.kind === 'solana' && t.kind === 'bitcoin')) {
                return 'No provider moves Bitcoin to or from Solana directly. Bridge through Avalanche or Ethereum in two steps.'
            }
            if (f.kind === 'bitcoin' || t.kind === 'bitcoin') {
                return testnet.value
                    ? 'Bitcoin bridging runs through THORChain, which has no testnet.'
                    : 'Bitcoin bridges to and from native ETH, AVAX, BNB and Base ETH only (through THORChain).'
            }
            return `No enabled provider serves ${fromAsset.value?.symbol ?? ''} from ${f.name} to ${t.name}. Check Settings → Bridge Providers.`
        })

        let quoteTimer: ReturnType<typeof setTimeout> | null = null
        let quoteSeq = 0
        const buildRequest = () => {
            const a = fromAsset.value
            const t = toChain.value
            if (!a || !t || amount.value === null || insufficient.value || recipientErr.value) return null
            return {
                from: a,
                toChain: t,
                amount: amount.value,
                sender: sender.value,
                recipient: recipient.value,
                receiveToken: receiveToken.value ?? undefined,
            }
        }
        const requote = async () => {
            const req = buildRequest()
            const seq = ++quoteSeq
            if (!req || noProviders.value) {
                quotes.value = []
                quoteErrors.value = []
                quoting.value = false
                return
            }
            quoting.value = true
            try {
                const res = await quoteAll(req)
                if (seq !== quoteSeq) return
                quotes.value = res.quotes
                quoteErrors.value = res.errors
                if (!res.quotes.some((q) => quoteKey(q) === selectedKey.value)) {
                    const best = res.quotes.find(routeMatches) ?? res.quotes[0]
                    selectedKey.value = best ? quoteKey(best) : ''
                }
            } finally {
                if (seq === quoteSeq) quoting.value = false
            }
        }
        const scheduleQuote = () => {
            if (quoteTimer) clearTimeout(quoteTimer)
            quotes.value = []
            quoteErrors.value = []
            quoteTimer = setTimeout(requote, QUOTE_DEBOUNCE_MS)
        }
        watch([fromAsset, toChainId, amount, recipient, insufficient, receiveToken], scheduleQuote)
        // Routes delivering the chosen receive token first.
        const sortedQuotes = computed(() =>
            receiveToken.value ? quotes.value.filter(routeMatches).concat(quotes.value.filter((q) => !routeMatches(q))) : quotes.value
        )

        // ── signing ──
        const offlineOn = computed(() => offline.isActive)
        const canSign = computed(() => {
            // Re-evaluated when the EVM platform changes network.
            void evmStore.network
            return fromChain.value ? canSignOn(fromChain.value) : false
        })
        const evmConnected = computed(() => !!evmStore.wallet || !!getPlatform('evm')?.getActiveWallet())
        const canSwitchEvm = computed(() => fromChain.value?.kind === 'evm' && evmConnected.value && !!fromChain.value.evmNetworkId)
        const signHint = computed(() => {
            const c = fromChain.value
            if (!c) return ''
            if (c.kind === 'evm') {
                // The Avalanche wallet only signs while its tab is in front (see platforms/avalanche).
                const cChain = c.evmChainId === 43114 || c.evmChainId === 43113
                if (cChain && !evmConnected.value) {
                    return `Open the Avalanche tab, or connect an EVM wallet on ${c.name}, to send from C-Chain.`
                }
                return evmConnected.value
                    ? `Your EVM wallet is on another network. Switch it to ${c.name} to send from there.`
                    : `Connect an EVM wallet (or open an Avalanche wallet for C-Chain) to send from ${c.name}.`
            }
            if (c.kind === 'solana') return `Connect a Solana wallet that can sign, on ${c.name}, to send from there.`
            return `Connect a Bitcoin wallet that can sign, on ${c.name}, to send from there.`
        })
        const switching = ref(false)
        const switchEvmChain = async () => {
            const id = fromChain.value?.evmNetworkId
            if (!id) return
            switching.value = true
            error.value = ''
            try {
                await evmStore.setNetwork(id)
            } catch (e) {
                error.value = errorToString(e)
            } finally {
                switching.value = false
            }
        }

        // ── send ──
        const busy = ref(false)
        const error = ref('')
        const steps = ref<{ step: string; state: 'running' | 'done' }[]>([])
        const lastTransfer = ref<BridgeTransfer | null>(null)
        const onProgress = (step: string, state: 'running' | 'done') => {
            const i = steps.value.findIndex((s) => s.step === step)
            if (i >= 0) steps.value.splice(i, 1, { step, state })
            else steps.value = steps.value.concat([{ step, state }])
        }

        const canBridge = computed(
            () => !!selectedQuote.value && canSign.value && !offlineOn.value && !busy.value && !quoting.value && !lastTransfer.value
        )
        const bridgeLabel = computed(() => {
            if (insufficient.value) return `Insufficient ${fromAsset.value?.symbol ?? ''}`
            const q = selectedQuote.value
            if (!q) return 'Bridge'
            return `Bridge ${q.request.from.symbol} to ${q.request.toChain.name} with ${getProvider(q.providerId)?.name ?? q.providerId}`
        })

        const bridge = async () => {
            const chosen = selectedQuote.value
            if (!canBridge.value || !chosen) return
            busy.value = true
            error.value = ''
            steps.value = []
            try {
                // Quotes go stale; send a fresh one from the same route.
                const provider = getProvider(chosen.providerId)
                if (!provider) throw new Error('This route is no longer available.')
                const fresh = await provider.quote(chosen.request)
                lastTransfer.value = await runTransfer(fresh, onProgress)
                amountText.value = ''
                loadBalance()
                loadHeld()
            } catch (e) {
                // A dismissed password prompt is not an error — the user backed out.
                if (e instanceof SessionAuthCancelled) return
                error.value = errorToString(e)
            } finally {
                busy.value = false
            }
        }
        const reset = () => {
            lastTransfer.value = null
            steps.value = []
            error.value = ''
            scheduleQuote()
        }

        // ── history ──
        const history = computed(() =>
            bridgeTransfers.value.filter((t) => {
                const c = getBridgeChain(t.fromChainId)
                return c ? c.isTestnet === testnet.value : !testnet.value
            })
        )
        const refreshingId = ref('')
        const refreshingAll = ref(false)
        const claimingId = ref('')
        const claimErrors = ref<Record<string, string>>({})

        const syncLast = (t: BridgeTransfer) => {
            if (lastTransfer.value?.id === t.id) lastTransfer.value = t
        }
        const refreshOne = async (t: BridgeTransfer) => {
            refreshingId.value = t.id
            try {
                syncLast(await refreshTransfer(t))
            } catch (e) {
                console.warn('[Bridge] status check failed:', e)
            } finally {
                refreshingId.value = ''
            }
        }
        const refreshAll = async () => {
            refreshingAll.value = true
            try {
                const results = await Promise.allSettled(history.value.filter(isPending).map((t) => refreshTransfer(t)))
                results.forEach((r) => r.status === 'fulfilled' && syncLast(r.value))
            } finally {
                refreshingAll.value = false
            }
        }
        const followUpLabel = (t: BridgeTransfer) => {
            const f = getProvider(t.providerId)?.followUp
            return f && f.available(t) ? f.label : ''
        }
        const followUp = async (t: BridgeTransfer) => {
            claimingId.value = t.id
            claimErrors.value = Object.assign({}, claimErrors.value, { [t.id]: '' })
            try {
                syncLast(await runFollowUp(t))
            } catch (e) {
                if (e instanceof SessionAuthCancelled) return
                claimErrors.value = Object.assign({}, claimErrors.value, { [t.id]: errorToString(e) })
            } finally {
                claimingId.value = ''
            }
        }
        const claim = async (t: BridgeTransfer) => {
            claimingId.value = t.id
            claimErrors.value = Object.assign({}, claimErrors.value, { [t.id]: '' })
            try {
                syncLast(await runClaim(t))
            } catch (e) {
                if (e instanceof SessionAuthCancelled) return
                claimErrors.value = Object.assign({}, claimErrors.value, { [t.id]: errorToString(e) })
            } finally {
                claimingId.value = ''
            }
        }
        const forget = (t: BridgeTransfer) => removeTransfer(t.id)

        let poll: ReturnType<typeof setInterval> | null = null
        onMounted(() => {
            loadHeld()
            loadBalance()
            refreshAll()
            poll = setInterval(() => {
                if (history.value.some(isPending)) refreshAll()
            }, POLL_MS)
        })
        onBeforeUnmount(() => {
            if (searchTimer) clearTimeout(searchTimer)
            if (poll) clearInterval(poll)
            if (quoteTimer) clearTimeout(quoteTimer)
        })

        // ── display helpers ──
        const fmt = (v: bigint, decimals: number) => formatAmount(v, decimals)
        const fmtStr = (v: string, decimals: number) => {
            try {
                return formatAmount(BigInt(v), decimals)
            } catch {
                return v
            }
        }
        const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
        const eta = (s: number) => {
            if (s < 90) return `${Math.max(1, Math.round(s))} sec`
            if (s < 5400) return `${Math.round(s / 60)} min`
            return `${(s / 3600).toFixed(1)} h`
        }
        const kindLabel = (k: ReceiveKind) =>
            k === 'native' ? 'native' : k === 'canonical' ? 'original token' : 'Wormhole-wrapped'
        const paidAsLabel = (p: string) =>
            p === 'deducted' ? 'taken from the amount' : p === 'source' ? 'paid on the source chain' : 'paid on the destination'
        const hasMin = (q: BridgeQuote) => q.minReceive !== undefined
        const minOf = (q: BridgeQuote) => q.minReceive ?? BigInt(0)
        const chainName = (id: string) => getBridgeChain(id)?.name ?? id
        const txLink = (chainId: string, hash: string) => getBridgeChain(chainId)?.txUrl(hash) ?? ''
        const trackerUrl = (t: BridgeTransfer) =>
            t.providerId === THORCHAIN_ID
                ? thorchainTrackerUrl(t)
                : t.providerId === AVALANCHE_BRIDGE_ID
                ? avalancheBridgeTrackerUrl(t)
                : wormholescanUrl(t)
        const trackerName = (t: BridgeTransfer) =>
            t.providerId === THORCHAIN_ID
                ? 'RuneScan'
                : t.providerId === AVALANCHE_BRIDGE_ID
                ? avalancheBridgeTrackerUrl(t).includes('etherscan')
                    ? 'Etherscan'
                    : 'Snowtrace'
                : 'Wormholescan'
        const statusLabel = (t: BridgeTransfer) =>
            ({
                in_transit: 'In transit',
                ready_to_claim: 'Ready to claim',
                completed: 'Completed',
                refunded: 'Refunded',
                failed: 'Failed',
            }[t.status] ?? t.status)
        const when = (ms: number) => new Date(ms).toLocaleString()

        return {
            isBlocked,
            gatedAction,
            testnet,
            setTestnet,
            chains,
            destChains,
            fromChainId,
            toChainId,
            fromChain,
            toChain,
            fromChainName,
            fromChainEvmId,
            toChainName,
            heldTokens,
            loadingHeld,
            fromKey,
            sender,
            receiveQuery,
            receiveToken,
            receiveUnverified,
            suggestions,
            searching,
            suggestionsOpen,
            showSuggestions,
            searchNote,
            receiveError,
            onReceiveInput,
            pickReceive,
            clearReceive,
            sourceLabel,
            routeMatches,
            sortedQuotes,
            fromAsset,
            balance,
            amountText,
            amountError,
            setMax,
            recipient,
            recipientTouched,
            recipientErr,
            ownDestAddress,
            useOwnAddress,
            flip,
            quotes,
            quoteErrors,
            quoting,
            selectedKey,
            quoteKey,
            noProviders,
            noProvidersReason,
            offlineOn,
            canSign,
            canSwitchEvm,
            signHint,
            switching,
            switchEvmChain,
            busy,
            error,
            steps,
            lastTransfer,
            canBridge,
            bridgeLabel,
            bridge,
            reset,
            history,
            refreshingId,
            refreshingAll,
            claimingId,
            claimErrors,
            refreshOne,
            refreshAll,
            claim,
            forget,
            pending: isPending,
            fmt,
            fmtStr,
            short,
            eta,
            kindLabel,
            paidAsLabel,
            hasMin,
            minOf,
            chainName,
            txLink,
            trackerUrl,
            trackerName,
            usesAvalancheBridge,
            avalancheBridgeReceives,
            avalancheBridgeOffboardWeth,
            ethereumNotCarried,
            bitcoinPair,
            fromAssetSymbol,
            selectedProviderName,
            selectedRouteName,
            tokenLink,
            followUpLabel,
            followUp,
            statusLabel,
            when,
        }
    },
})
</script>

<style lang="scss" scoped>
.universal_bridge {
    max-width: 560px;
    margin: 0 auto;
    color: var(--primary-color);
}

.head {
    text-align: center;
    margin-bottom: 20px;

    h1 {
        font-weight: normal;
    }

    .desc {
        color: var(--primary-color-light);
        font-size: 0.9em;
        line-height: 1.5;
        margin-top: 4px !important;
    }
}

.net_toggle {
    display: inline-flex;
    margin-top: 12px;
    border-radius: 18px;
    background: var(--bg-light);
    padding: 3px;

    button {
        padding: 5px 16px;
        border-radius: 15px;
        font-size: 13px;
        color: var(--primary-color-light);

        &.on {
            background: var(--secondary-color);
            color: #fff;
        }
    }
}

.card {
    background: var(--bg-light);
    border-radius: 14px;
    padding: 18px;
}

.side {
    background: var(--bg);
    border-radius: 10px;
    padding: 12px 14px;
}

.side_head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;

    label {
        font-size: 12px;
        color: var(--primary-color-light);
    }
}

.sub_label {
    display: block;
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 10px 0 4px;
}

.field {
    width: 100%;
    padding: 9px 12px;
    border-radius: 8px;
    background: var(--bg-light);
    color: var(--primary-color);
    border: 1px solid transparent;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.mono {
    font-family: monospace;
    font-size: 13px;
}

.token_line {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px !important;
}

.balance_btn {
    font-size: 12px;
    color: var(--primary-color-light);

    &:hover {
        color: var(--secondary-color);
    }
}

.amount_row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
}

.amount_input {
    flex: 1;
    min-width: 0;
    font-size: 22px;
    background: transparent;
    color: var(--primary-color);
    border: none;
    outline: none;
}

.max_btn {
    font-size: 12px;
    font-weight: 600;
    color: var(--secondary-color);
    padding: 4px 6px;
}

.dest_token {
    font-size: 12px;
    margin-top: 4px;
    word-break: break-all;
}

.wormhole_warn {
    font-size: 12px;
    margin-top: 6px !important;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--warning, #d08700);
    color: var(--primary-color);
}

.using {
    font-size: 14px;
}

.notice + .notice {
    margin-top: 8px;
}

.notice {
    margin: 14px 0 0;
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid var(--secondary-color);
    background: var(--bg-light);
    font-size: 13px;
    line-height: 1.5;
}

.combo {
    position: relative;

    .clear_btn {
        position: absolute;
        right: 8px;
        top: 8px;
        font-size: 12px;
        color: var(--primary-color-light);
    }
}

.suggestions {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    max-height: 280px;
    overflow: auto;
    list-style: none;
    margin: 0;
    padding: 4px;
    background: var(--bg-light);
    border: 1px solid var(--secondary-color);
    border-radius: 8px;

    li {
        padding: 6px 8px;
    }
}

.suggestion {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    gap: 8px;
    align-items: baseline;
    cursor: pointer;
    border-radius: 6px;

    &:hover {
        background: var(--bg);
    }

    .sym {
        font-weight: 700;
    }

    .src {
        font-size: 11px;
        color: var(--primary-color-light);

        &.verified {
            color: var(--success);
        }
    }
}

.warn_badge {
    font-size: 11px;
    color: var(--warning, #d08700);
}

.match {
    font-size: 12px;
    margin-top: 4px;
    color: var(--warning, #d08700);

    &.ok {
        color: var(--success);
    }
}

.flip_row {
    display: flex;
    justify-content: center;
    margin: -6px 0;
    position: relative;
    z-index: 1;
}

.flip_btn {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--bg-light);
    border: 3px solid var(--bg);
    color: var(--primary-color);
    font-size: 15px;
}

.link_btn {
    font-size: 12px;
    color: var(--secondary-color);
    margin-top: 6px;

    &:disabled {
        opacity: 0.6;
    }
}

.routes {
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.route {
    cursor: pointer;
    text-align: left;
    width: 100%;
    background: var(--bg-light);
    border: 2px solid transparent;
    border-radius: 12px;
    padding: 12px 14px;
    color: var(--primary-color);

    &.selected {
        border-color: var(--secondary-color);
    }
}

.route_head {
    display: flex;
    justify-content: space-between;
    font-weight: 700;
    margin-bottom: 4px;

    .eta {
        font-weight: normal;
        font-size: 13px;
        color: var(--primary-color-light);
    }
}

.route_receive {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}

.kind {
    font-size: 11px;
    padding: 1px 8px;
    border-radius: 10px;
    background: var(--bg);

    &.native,
    &.canonical {
        color: var(--success);
    }

    &.wrapped {
        color: var(--warning, #d08700);
    }
}

.fees {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    font-size: 12px;
}

.claim_note {
    font-size: 12px;
    margin-top: 6px !important;
    color: var(--secondary-color);
}

.warnings {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: 12px;
    color: var(--primary-color-light);
}

.route_error {
    font-size: 12px;
    color: var(--primary-color-light);
    padding: 0 4px;
}

.action {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.bridge_btn {
    margin-top: 4px;
}

.steps {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 13px;

    li.done {
        color: var(--success);
    }

    .dot {
        display: inline-block;
        width: 16px;
    }
}

.result {
    background: var(--bg-light);
    border-radius: 10px;
    padding: 12px 14px;

    .links {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        margin: 6px 0 10px !important;
        font-size: 13px;
    }
}

.history {
    margin-top: 28px;
}

.history_head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;

    h3 {
        font-weight: normal;
    }
}

.transfer {
    background: var(--bg-light);
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 8px;
}

.transfer_head {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    flex-wrap: wrap;
}

.status {
    font-size: 12px;
    font-weight: 600;

    &.completed {
        color: var(--success);
    }

    &.ready_to_claim {
        color: var(--secondary-color);
    }

    &.refunded,
    &.failed {
        color: var(--error);
    }
}

.transfer_actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 6px;
    font-size: 13px;

    .link_btn {
        margin-top: 0;
    }
}

.muted {
    color: var(--primary-color-light);
}

.small {
    font-size: 12px;
}

.center {
    text-align: center;
}

.form_error,
.error_msg {
    color: var(--error);
    font-size: 13px;
}

.form_error {
    margin-top: 6px !important;
}
</style>
