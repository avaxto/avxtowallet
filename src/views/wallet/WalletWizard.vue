<template>
    <div class="wallet_wizard">
        <h1 class="wizard_heading">Wallet Wizard</h1>
        <p class="wizard_intro">
            Wallet Wizard is an AVXTO Toolbox tool that allows you to create a brand new wallet and
            migrate all assets to the newly created wallet. Refer to
            <a href="https://avax.to" target="_blank" rel="noopener noreferrer">avax.to</a>
            website for more about Wallet Wizard.
        </p>

        <!-- Step indicator -->
        <div class="step_indicator">
            <div
                v-for="n in 4"
                :key="n"
                class="step_dot"
                :class="{ active: step === n, done: step > n }"
            >
                <div class="step_circle">{{ n }}</div>
                <span class="step_label">{{ stepLabels[n - 1] }}</span>
            </div>
        </div>

        <!-- ─── Step 1: Generate & Verify Mnemonic ─── -->
        <div v-if="step === 1" class="card">
            <h2>Generate New Wallet</h2>
            <p class="desc">
                A new 24-word recovery phrase will be generated. Write it down on paper and store it
                somewhere safe — it cannot be recovered if lost. Do not share it with anyone.
            </p>

            <div v-if="!newMnemonic" class="empty_state">
                <v-btn class="button_primary" @click="generateMnemonic">
                    Generate New Mnemonic
                </v-btn>
            </div>

            <template v-else>
                <div class="mnemonic_grid">
                    <div
                        v-for="(word, idx) in newWords"
                        :key="idx"
                        class="mnemonic_word"
                        :class="{ highlight: quizIndices.includes(idx) }"
                    >
                        <span class="word_num">{{ idx + 1 }}</span>
                        <span class="word_val notranslate" translate="no">{{ word }}</span>
                    </div>
                </div>

                <div class="quiz_section">
                    <p class="quiz_title">
                        To confirm you have recorded your mnemonic, enter the
                        <strong>highlighted</strong> words below:
                    </p>
                    <div v-for="idx in quizIndices" :key="idx" class="quiz_row">
                        <label class="quiz_label">Word #{{ idx + 1 }}</label>
                        <input
                            v-model="quizAnswers[idx]"
                            type="text"
                            class="quiz_input"
                            :placeholder="`Word ${idx + 1}`"
                            autocomplete="off"
                            autocorrect="off"
                            spellcheck="false"
                        />
                    </div>
                    <p v-if="quizError" class="err_msg">{{ quizError }}</p>
                </div>

                <div class="actions">
                    <v-btn class="button_secondary" @click="generateMnemonic">Regenerate</v-btn>
                    <v-btn class="button_primary" @click="goToStep2">
                        Next: Review Assets
                    </v-btn>
                </div>
            </template>
        </div>

        <!-- ─── Step 2: Asset Discovery ─── -->
        <div v-if="step === 2" class="card">
            <h2>Review Assets to Transfer</h2>
            <p class="desc">
                The following assets were found in your current wallet. Review the list carefully.
                Assets on P-chain require a manual Cross Chain export and cannot be migrated
                automatically.
            </p>

            <div v-if="discoveredAssets.length === 0" class="empty_state">
                <p>No transferable assets found in your wallet.</p>
            </div>

            <div v-else class="asset_table">
                <div class="asset_row header">
                    <span>Chain</span>
                    <span>Asset</span>
                    <span class="amount_col">Amount</span>
                    <span class="note_col">Notes</span>
                </div>
                <div v-for="(asset, i) in discoveredAssets" :key="i" class="asset_row">
                    <span class="chain_badge" :class="'chain_' + asset.chain.toLowerCase()">
                        {{ asset.chain }}
                    </span>
                    <span>{{ asset.name }} <small>({{ asset.symbol }})</small></span>
                    <span class="amount_col">{{ asset.amount }} {{ asset.symbol }}</span>
                    <span class="note_col note_text">{{ asset.note }}</span>
                </div>
            </div>

            <div class="new_wallet_preview">
                <p class="preview_label">Assets will be sent to your new wallet addresses:</p>
                <div class="addr_row">
                    <label>X-Chain</label>
                    <span class="addr notranslate" translate="no">{{ newXAddr }}</span>
                </div>
                <div class="addr_row">
                    <label>C-Chain</label>
                    <span class="addr notranslate" translate="no">{{ newCAddr }}</span>
                </div>
            </div>

            <div class="confirm_section">
                <p class="confirm_label">
                    Type <strong>EXECUTE</strong> to confirm you want to proceed with the transfers:
                </p>
                <input
                    v-model="confirmWord"
                    type="text"
                    class="confirm_input"
                    placeholder="EXECUTE"
                    autocomplete="off"
                />
            </div>

            <div class="actions">
                <v-btn class="button_secondary" @click="step = 1">Back</v-btn>
                <v-btn
                    class="button_primary"
                    :disabled="confirmWord !== 'EXECUTE' || discoveredAssets.length === 0"
                    @click="goToStep3"
                >
                    Execute Transfer
                </v-btn>
            </div>
        </div>

        <!-- ─── Step 3: Execute ─── -->
        <div v-if="step === 3" class="card">
            <h2>Executing Transfers</h2>
            <p class="desc">
                <span v-if="isExecuting">{{ currentStep3Label }}</span>
                <span v-else>All transfers have been processed. Click View Report to continue.</span>
            </p>

            <div class="transfer_list">
                <div
                    v-for="(t, i) in transfers"
                    :key="i"
                    class="transfer_row"
                    :class="'status_' + t.status"
                >
                    <span class="chain_badge" :class="'chain_' + t.chain.toLowerCase()">
                        {{ t.chain }}
                    </span>
                    <span class="t_asset">{{ t.asset }}</span>
                    <span class="t_amount">{{ t.amount }}</span>
                    <span class="t_status">
                        <span v-if="t.status === 'pending'">⏳ Pending…</span>
                        <span v-else-if="t.status === 'success'" class="ok">✓ Success</span>
                        <span v-else-if="t.status === 'skipped'" class="skip">→ Skipped</span>
                        <span v-else class="fail">✗ {{ t.error }}</span>
                    </span>
                </div>
                <div v-if="isExecuting && transfers.length === 0" class="executing_spinner">
                    <span>Preparing…</span>
                </div>
            </div>

            <div class="actions" v-if="!isExecuting">
                <v-btn class="button_primary" @click="goToStep4">View Report</v-btn>
            </div>
        </div>

        <!-- ─── Step 4: Report ─── -->
        <div v-if="step === 4" class="card">
            <h2>Migration Report</h2>
            <p class="desc">
                Summary of all transfers performed. Save this report for your records.
            </p>

            <div class="report_table">
                <div class="asset_row header">
                    <span>Chain</span>
                    <span>Asset</span>
                    <span>Amount</span>
                    <span>Status</span>
                    <span class="tx_col">TX / Note</span>
                </div>
                <div
                    v-for="(t, i) in transfers"
                    :key="i"
                    class="asset_row"
                    :class="'status_' + t.status"
                >
                    <span class="chain_badge" :class="'chain_' + t.chain.toLowerCase()">
                        {{ t.chain }}
                    </span>
                    <span>{{ t.asset }}</span>
                    <span>{{ t.amount }}</span>
                    <span>
                        <span v-if="t.status === 'success'" class="ok">Success</span>
                        <span v-else-if="t.status === 'skipped'" class="skip">Skipped</span>
                        <span v-else class="fail">Failed</span>
                    </span>
                    <span class="tx_col">
                        <span v-if="t.txId" class="notranslate tx_hash" translate="no">
                            {{ t.txId.length > 20 ? t.txId.substring(0, 20) + '…' : t.txId }}
                        </span>
                        <span v-else class="err_detail">{{ t.error || '—' }}</span>
                    </span>
                </div>
            </div>

            <div class="report_actions">
                <v-btn class="button_secondary" @click="copyReport">Copy to Clipboard</v-btn>
                <v-btn class="button_secondary" @click="downloadReport">Download as TXT</v-btn>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import * as bip39 from 'bip39'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { useMainStore } from '@/stores/main'
import { useAssetsStore } from '@/stores/assets'
import { WalletHelper } from '@/helpers/wallet_helper'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { ITransaction } from '@/components/wallet/transfer/types'
import { bnToBig } from '@/helpers/helper'
import { IssueBatchTxInput } from '@/types'

interface AssetEntry {
    chain: 'X' | 'P' | 'C'
    name: string
    symbol: string
    amount: string
    assetId: string
    rawAmount: BN
    note: string
}

interface TransferRecord {
    chain: string
    asset: string
    amount: string
    status: 'pending' | 'success' | 'error' | 'skipped'
    txId?: string
    error?: string
}

export default defineComponent({
    name: 'WalletWizard',
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()

        const step = ref<1 | 2 | 3 | 4>(1)
        const stepLabels = ['Generate', 'Review', 'Execute', 'Report']

        // ─── Step 1: Mnemonic generation & quiz ─────────────────────────────
        const newMnemonic = ref<string | null>(null)
        const newWords = ref<string[]>([])
        const quizIndices = ref<number[]>([])
        const quizAnswers = ref<Record<number, string>>({})
        const quizError = ref<string | null>(null)

        // Derived new-wallet addresses (computed once mnemonic is set)
        const _newWallet = ref<MnemonicWallet | null>(null)
        const newXAddr = computed(() => _newWallet.value?.getCurrentAddressAvm() ?? '')
        const newCAddr = computed(() => _newWallet.value?.getEvmChecksumAddress() ?? '')

        const generateMnemonic = () => {
            const mnemonic = bip39.generateMnemonic(256)
            newMnemonic.value = mnemonic
            newWords.value = mnemonic.split(' ')
            quizAnswers.value = {}
            quizError.value = null

            // Pick 3 unique random word positions
            const indices = new Set<number>()
            while (indices.size < 3) {
                indices.add(Math.floor(Math.random() * 24))
            }
            quizIndices.value = [...indices].sort((a, b) => a - b)

            // Derive target wallet addresses immediately
            try {
                _newWallet.value = new MnemonicWallet(mnemonic)
            } catch (e) {
                console.warn('Failed to derive new wallet addresses:', e)
            }
        }

        const verifyQuiz = (): boolean => {
            for (const idx of quizIndices.value) {
                const expected = newWords.value[idx]
                const given = (quizAnswers.value[idx] ?? '').trim().toLowerCase()
                if (given !== expected.toLowerCase()) {
                    quizError.value = `Word #${idx + 1} is incorrect. Please check your mnemonic.`
                    return false
                }
            }
            quizError.value = null
            return true
        }

        // ─── Step 2: Asset discovery ─────────────────────────────────────────
        const confirmWord = ref('')
        const discoveredAssets = ref<AssetEntry[]>([])

        const discoverAssets = () => {
            const wallet = mainStore.activeWallet as any
            const entries: AssetEntry[] = []

            // X-chain assets from balance dict
            const balDict = assetsStore.balanceDict
            const assDict = assetsStore.assetsDict
            for (const [assetId, bal] of Object.entries(balDict)) {
                if (!bal.available.gt(new BN(0))) continue
                const asset = assDict[assetId]
                if (!asset) continue
                const denom = asset.denomination ?? 0
                const big = bnToBig(bal.available, denom)
                entries.push({
                    chain: 'X',
                    name: asset.name || assetId.substring(0, 8),
                    symbol: asset.symbol || '?',
                    amount: big.toFixed(denom > 0 ? Math.min(denom, 9) : 0),
                    assetId,
                    rawAmount: bal.available.clone(),
                    note: 'Will be transferred directly',
                })
            }

            // P-chain AVAX
            const pBal = assetsStore.walletPlatformBalance
            if (pBal.available.gt(new BN(0))) {
                const big = bnToBig(pBal.available, 9)
                entries.push({
                    chain: 'P',
                    name: 'Avalanche',
                    symbol: 'AVAX',
                    amount: big.toFixed(9),
                    assetId: '__AVAX_P__',
                    rawAmount: pBal.available.clone(),
                    note: 'Requires manual export via Cross Chain tab',
                })
            }

            // C-chain AVAX (ETH)
            const ethBalance: BN = wallet?.ethBalance ?? new BN(0)
            if (ethBalance.gt(new BN(0))) {
                const big = bnToBig(ethBalance, 18)
                entries.push({
                    chain: 'C',
                    name: 'Avalanche',
                    symbol: 'AVAX',
                    amount: big.toFixed(9),
                    assetId: '__AVAX_C__',
                    rawAmount: ethBalance.clone(),
                    note: 'Will be transferred (gas reserved)',
                })
            }

            // C-chain ERC20 tokens
            const allErc20 = [...assetsStore.erc20Tokens, ...assetsStore.erc20TokensCustom]
            for (const token of allErc20) {
                if (!token.balanceBN.gt(new BN(0))) continue
                const denom = parseInt(String(token.data.decimals), 10) || 18
                entries.push({
                    chain: 'C',
                    name: token.data.name,
                    symbol: token.data.symbol,
                    amount: token.balanceBig.toFixed(Math.min(denom, 9)),
                    assetId: token.data.address,
                    rawAmount: token.balanceBN.clone(),
                    note: 'Will be transferred directly',
                })
            }

            discoveredAssets.value = entries
        }

        // ─── Step 3: Execute transfers ────────────────────────────────────────
        const isExecuting = ref(false)
        const transfers = ref<TransferRecord[]>([])
        const currentStep3Label = ref('')

        const executeTransfers = async () => {
            if (!newMnemonic.value || !_newWallet.value) return
            isExecuting.value = true
            transfers.value = []

            const wallet = mainStore.activeWallet as any
            const targetXAddr = newXAddr.value
            const targetCAddr = newCAddr.value

            // Get C-chain gas price
            let gasPrice = new BN(String(25_000_000_000)) // 25 nAVAX fallback
            try {
                const gp = await web3.eth.getGasPrice()
                gasPrice = new BN(String(gp))
            } catch {
                // use fallback
            }

            // ── X-chain: batch all available X assets in one TX ──────────────
            const xAssets = discoveredAssets.value.filter((a) => a.chain === 'X')
            if (xAssets.length > 0) {
                const orders: ITransaction[] = xAssets
                    .map((a) => ({
                        uuid: Math.random().toString(36).slice(2),
                        asset: assetsStore.assetsDict[a.assetId],
                        amount: a.rawAmount,
                    }))
                    .filter((o) => o.asset != null)

                if (orders.length > 0) {
                    const combinedLabel = orders
                        .map((o) => o.asset.symbol)
                        .filter((v, i, arr) => arr.indexOf(v) === i)
                        .join(', ')

                    const combinedAmount = orders
                        .map((o) => {
                            const d = o.asset.denomination ?? 0
                            return bnToBig(o.amount, d).toFixed(d > 0 ? 9 : 0) + ' ' + o.asset.symbol
                        })
                        .join(', ')

                    const txRecord: TransferRecord = {
                        chain: 'X',
                        asset: combinedLabel,
                        amount: combinedAmount,
                        status: 'pending',
                    }
                    transfers.value.push(txRecord)
                    currentStep3Label.value = 'Sending X-chain assets…'

                    try {
                        const input: IssueBatchTxInput = { toAddress: targetXAddr, orders }
                        const txId = await mainStore.issueBatchTx(input)
                        txRecord.txId = txId
                        txRecord.status = 'success'
                    } catch (e: any) {
                        txRecord.status = 'error'
                        txRecord.error = e?.message ?? String(e)
                    }
                }
            }

            // ── P-chain: skip — requires manual cross-chain export ────────────
            const pAssets = discoveredAssets.value.filter((a) => a.chain === 'P')
            for (const pa of pAssets) {
                transfers.value.push({
                    chain: 'P',
                    asset: pa.symbol,
                    amount: `${pa.amount} ${pa.symbol}`,
                    status: 'skipped',
                    error: 'Use Cross Chain → Export to move P-chain AVAX to X or C, then transfer to new wallet',
                })
            }

            // ── C-chain AVAX ──────────────────────────────────────────────────
            const cEthAsset = discoveredAssets.value.find((a) => a.assetId === '__AVAX_C__')
            if (cEthAsset) {
                const gasLimit = 21000
                // Reserve 3× the gas cost to be safe
                const gasCost = gasPrice.muln(gasLimit).muln(3)
                const sendAmount = cEthAsset.rawAmount.sub(gasCost)

                if (sendAmount.gt(new BN(0))) {
                    const txRecord: TransferRecord = {
                        chain: 'C',
                        asset: 'AVAX',
                        amount: bnToBig(sendAmount, 18).toFixed(9) + ' AVAX',
                        status: 'pending',
                    }
                    transfers.value.push(txRecord)
                    currentStep3Label.value = 'Sending C-chain AVAX…'

                    try {
                        const txHash = await WalletHelper.sendEth(
                            wallet,
                            targetCAddr,
                            sendAmount,
                            gasPrice,
                            gasLimit
                        )
                        txRecord.txId = txHash
                        txRecord.status = 'success'
                    } catch (e: any) {
                        txRecord.status = 'error'
                        txRecord.error = e?.message ?? String(e)
                    }
                } else {
                    transfers.value.push({
                        chain: 'C',
                        asset: 'AVAX',
                        amount: `${cEthAsset.amount} AVAX`,
                        status: 'skipped',
                        error: 'Balance too low to cover gas fees',
                    })
                }
            }

            // ── C-chain ERC20 tokens ──────────────────────────────────────────
            const allErc20 = [...assetsStore.erc20Tokens, ...assetsStore.erc20TokensCustom]
            for (const token of allErc20) {
                if (!token.balanceBN.gt(new BN(0))) continue

                const denom = parseInt(String(token.data.decimals), 10) || 18
                const txRecord: TransferRecord = {
                    chain: 'C',
                    asset: token.data.symbol,
                    amount: token.balanceBig.toFixed(Math.min(denom, 9)) + ' ' + token.data.symbol,
                    status: 'pending',
                }
                transfers.value.push(txRecord)
                currentStep3Label.value = `Sending ${token.data.symbol}…`

                try {
                    const txHash = await WalletHelper.sendErc20(
                        wallet,
                        targetCAddr,
                        token.balanceBN,
                        gasPrice,
                        100_000,
                        token
                    )
                    txRecord.txId = txHash
                    txRecord.status = 'success'
                } catch (e: any) {
                    txRecord.status = 'error'
                    txRecord.error = e?.message ?? String(e)
                }
            }

            isExecuting.value = false
            currentStep3Label.value = 'All transfers processed.'
        }

        // ─── Step 4: Report ───────────────────────────────────────────────────
        const buildReportText = (): string => {
            const header = 'Chain | Asset | Amount | Status | TX ID / Note'
            const rows = transfers.value.map(
                (t) =>
                    `${t.chain} | ${t.asset} | ${t.amount} | ${t.status} | ${
                        t.txId ?? t.error ?? '—'
                    }`
            )
            return [header, ...rows].join('\n')
        }

        const copyReport = () => {
            navigator.clipboard.writeText(buildReportText())
        }

        const downloadReport = () => {
            const text = buildReportText()
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `wallet-migration-${Date.now()}.txt`
            a.click()
            URL.revokeObjectURL(url)
        }

        // ─── Navigation ───────────────────────────────────────────────────────
        const goToStep2 = () => {
            if (!verifyQuiz()) return
            discoverAssets()
            confirmWord.value = ''
            step.value = 2
        }

        const goToStep3 = () => {
            if (confirmWord.value !== 'EXECUTE') return
            step.value = 3
            executeTransfers()
        }

        const goToStep4 = () => {
            step.value = 4
        }

        return {
            step,
            stepLabels,
            // step 1
            newMnemonic,
            newWords,
            quizIndices,
            quizAnswers,
            quizError,
            generateMnemonic,
            goToStep2,
            // step 2
            confirmWord,
            discoveredAssets,
            newXAddr,
            newCAddr,
            goToStep3,
            // step 3
            isExecuting,
            transfers,
            currentStep3Label,
            goToStep4,
            // step 4
            copyReport,
            downloadReport,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.wizard_heading {
    font-size: 24px;
    font-weight: 700;
    margin-bottom: 8px;
}

.wizard_intro {
    font-size: 14px;
    color: var(--primary-color-light);
    max-width: 740px;
    line-height: 1.6;
    margin-bottom: 28px;

    a {
        color: var(--secondary-color);
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}

h2 {
    font-weight: 600;
    font-size: 20px;
    margin-bottom: 8px;
}

.desc {
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 24px;
    max-width: 740px;
    line-height: 1.5;
}

/* ── Step indicator ──────────────────────────────────────────────────── */
.step_indicator {
    display: flex;
    align-items: flex-start;
    gap: 0;
    margin-bottom: 28px;
    max-width: 520px;
}

.step_dot {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    position: relative;

    &:not(:last-child)::after {
        content: '';
        position: absolute;
        top: 14px;
        left: calc(50% + 14px);
        right: calc(-50% + 14px);
        height: 2px;
        background: var(--bg-light);
    }

    &.done::after {
        background: var(--secondary-color);
    }

    .step_circle {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--bg-light);
        color: var(--primary-color-light);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 600;
        z-index: 1;
    }

    .step_label {
        font-size: 11px;
        color: var(--primary-color-light);
        margin-top: 4px;
        text-align: center;
    }

    &.active .step_circle {
        background: var(--secondary-color);
        color: #fff;
    }

    &.done .step_circle {
        background: var(--secondary-color);
        color: #fff;
        opacity: 0.6;
    }
}

/* ── Card ────────────────────────────────────────────────────────────── */
.card {
    background-color: var(--bg-light);
    border-radius: 8px;
    padding: 32px;
    max-width: 860px;
}

/* ── Empty state ─────────────────────────────────────────────────────── */
.empty_state {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
    color: var(--primary-color-light);
}

/* ── Mnemonic grid ───────────────────────────────────────────────────── */
.mnemonic_grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px;
    margin-bottom: 28px;

    @media (max-width: 700px) {
        grid-template-columns: repeat(4, 1fr);
    }
    @media (max-width: 460px) {
        grid-template-columns: repeat(3, 1fr);
    }
}

.mnemonic_word {
    background: var(--bg-body);
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    gap: 6px;

    .word_num {
        font-size: 10px;
        color: var(--primary-color-light);
        min-width: 18px;
    }

    .word_val {
        font-size: 13px;
        font-weight: 500;
    }

    &.highlight {
        border-color: var(--secondary-color);
        background: color-mix(in srgb, var(--secondary-color) 10%, transparent);
    }
}

/* ── Quiz ────────────────────────────────────────────────────────────── */
.quiz_section {
    margin-bottom: 24px;
}

.quiz_title {
    font-size: 14px;
    margin-bottom: 14px;
    color: var(--primary-color-light);
}

.quiz_row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
}

.quiz_label {
    font-size: 13px;
    min-width: 80px;
    color: var(--primary-color-light);
}

.quiz_input {
    background: var(--bg-body);
    border: 1px solid var(--bg-light-2, #d0d0d0);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 14px;
    color: var(--primary-color);
    width: 180px;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.err_msg {
    color: var(--error);
    font-size: 13px;
    margin-top: 6px;
}

/* ── Asset table ─────────────────────────────────────────────────────── */
.asset_table,
.report_table {
    margin-bottom: 24px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--bg-body);
}

.asset_row {
    display: grid;
    grid-template-columns: 60px 1fr 140px 1fr;
    gap: 0 12px;
    padding: 10px 14px;
    font-size: 13px;
    align-items: center;

    &.header {
        background: var(--bg-body);
        font-weight: 600;
        font-size: 12px;
        color: var(--primary-color-light);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    &:not(.header):nth-child(even) {
        background: color-mix(in srgb, var(--bg-body) 40%, transparent);
    }

    &.status_error {
        border-left: 3px solid var(--error);
    }

    &.status_success {
        border-left: 3px solid #4caf50;
    }

    &.status_skipped {
        border-left: 3px solid var(--primary-color-light);
        opacity: 0.75;
    }
}

.amount_col {
    text-align: right;
}

.note_col {
    font-size: 12px;
}

.note_text {
    color: var(--primary-color-light);
    font-style: italic;
}

/* ── Chain badge ─────────────────────────────────────────────────────── */
.chain_badge {
    display: inline-block;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 700;
    text-align: center;

    &.chain_x {
        background: #e3f2fd;
        color: #1565c0;
    }
    &.chain_p {
        background: #fce4ec;
        color: #880e4f;
    }
    &.chain_c {
        background: #e8f5e9;
        color: #2e7d32;
    }
}

@include main.night-mode {
    .chain_badge {
        &.chain_x {
            background: #1a3a5c;
            color: #90caf9;
        }
        &.chain_p {
            background: #4a1020;
            color: #f48fb1;
        }
        &.chain_c {
            background: #1b3a1f;
            color: #a5d6a7;
        }
    }
}

/* ── New wallet preview ──────────────────────────────────────────────── */
.new_wallet_preview {
    background: var(--bg-body);
    border-radius: 6px;
    padding: 16px;
    margin-bottom: 24px;

    .preview_label {
        font-size: 13px;
        color: var(--primary-color-light);
        margin-bottom: 10px;
    }
}

.addr_row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 6px;
    flex-wrap: wrap;

    label {
        font-size: 12px;
        font-weight: 600;
        color: var(--primary-color-light);
        min-width: 60px;
    }

    .addr {
        font-family: monospace;
        font-size: 12px;
        color: var(--primary-color);
        word-break: break-all;
    }
}

/* ── Confirm section ─────────────────────────────────────────────────── */
.confirm_section {
    margin-bottom: 24px;
}

.confirm_label {
    font-size: 14px;
    margin-bottom: 10px;
    color: var(--primary-color-light);
}

.confirm_input {
    background: var(--bg-body);
    border: 1px solid var(--bg-light-2, #d0d0d0);
    border-radius: 4px;
    padding: 8px 12px;
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-color);
    width: 200px;
    letter-spacing: 0.08em;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

/* ── Transfer list (step 3) ──────────────────────────────────────────── */
.transfer_list {
    margin-bottom: 24px;
}

.transfer_row {
    display: grid;
    grid-template-columns: 60px 160px 1fr 1fr;
    gap: 0 12px;
    padding: 10px 14px;
    font-size: 13px;
    align-items: center;
    border-bottom: 1px solid var(--bg-body);

    &.status_error {
        border-left: 3px solid var(--error);
    }
    &.status_success {
        border-left: 3px solid #4caf50;
    }
    &.status_skipped {
        border-left: 3px solid var(--primary-color-light);
        opacity: 0.75;
    }
}

.executing_spinner {
    padding: 16px;
    font-size: 13px;
    color: var(--primary-color-light);
}

.t_asset {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.ok {
    color: #4caf50;
    font-weight: 600;
}

.fail {
    color: var(--error);
    font-size: 12px;
}

.skip {
    color: var(--primary-color-light);
}

/* ── Report (step 4) ─────────────────────────────────────────────────── */
.report_table .asset_row {
    grid-template-columns: 60px 1fr 160px 80px 1fr;
}

.tx_col {
    font-size: 12px;
    font-family: monospace;
    word-break: break-all;
}

.tx_hash {
    color: var(--secondary-color);
}

.err_detail {
    color: var(--primary-color-light);
    font-family: inherit;
    font-size: 12px;
}

/* ── Actions row ─────────────────────────────────────────────────────── */
.actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
}

.report_actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 20px;
}
</style>
