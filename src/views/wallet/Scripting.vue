<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Wallet Scripts: write TypeScript/JavaScript against a small wallet API and
  run it in a QuickJS sandbox (src/scripting). Two modes:

   - Plan (default): the script runs, and every tx.* call is recorded, not
     signed. The user reviews the resulting list — full addresses, amounts,
     chains, totals — and approving executes exactly that list.
   - Live (opt-in): tx.* sends during the run, within a per-asset budget and a
     transaction cap set beforehand, with Abort always available.

  Writing and plan-running scripts is open to everyone; approving a plan and
  starting a live run are premium actions behind the Moats burn gate.
-->
<template>
    <div class="scripting">
        <div class="head">
            <h1>Wallet Scripts</h1>
            <p class="desc">
                Automate balance checks and payments with a short script. Scripts run in an isolated engine
                with no internet, page or key access — they can only call the wallet API below. By default a
                script only <strong>plans</strong>: you review every transaction before anything is signed.
            </p>
        </div>

        <!-- Library -->
        <section class="bar">
            <select v-model="selectedId" class="field lib_select" aria-label="Saved scripts" @change="openSelected">
                <option value="">— New script —</option>
                <optgroup v-if="saved.length" label="Saved">
                    <option v-for="s in saved" :key="s.id" :value="s.id">{{ s.name }}{{ s.imported ? ' (imported)' : '' }}</option>
                </optgroup>
                <optgroup label="Examples">
                    <option v-for="(e, i) in examples" :key="'ex' + i" :value="'example:' + i">{{ e.name }}</option>
                </optgroup>
            </select>
            <input v-model="name" class="field name_input" placeholder="Script name" aria-label="Script name" />
            <div class="bar_buttons">
                <button type="button" class="small_btn" :disabled="running" @click="save">{{ dirty ? 'Save*' : 'Save' }}</button>
                <button type="button" class="small_btn" :disabled="running" @click="startNew">New</button>
                <button type="button" class="small_btn" :disabled="running" @click="showImport = !showImport">Import</button>
                <button type="button" class="small_btn" @click="copySource">Copy</button>
                <button v-if="current" type="button" class="small_btn danger" :disabled="running" @click="remove">Delete</button>
            </div>
        </section>
        <p v-if="libMessage" class="muted small">{{ libMessage }}</p>

        <section v-if="showImport" class="import_box">
            <p class="warn_text">
                Only import scripts you can read and understand. A shared script can ask to send your funds
                anywhere — the plan review is your last check.
            </p>
            <input v-model="importName" class="field" placeholder="Name for the imported script" />
            <textarea v-model="importSource" class="field code small_code" rows="8" spellcheck="false" placeholder="Paste the script here"></textarea>
            <div class="row_end">
                <button type="button" class="small_btn" @click="showImport = false">Cancel</button>
                <button type="button" class="small_btn primary" :disabled="!importSource.trim()" @click="doImport">Import</button>
            </div>
        </section>

        <div v-if="needsReview" class="review_banner">
            <strong>You did not write this script.</strong>
            Read all of it — every line, including any far to the right or below — before running it.
            <label class="ack">
                <input type="checkbox" :checked="false" @change="acknowledge" />
                I have read the whole script and understand what it does
            </label>
        </div>

        <!-- Editor -->
        <textarea
            ref="editorEl"
            v-model="source"
            class="field code editor"
            spellcheck="false"
            autocomplete="off"
            :readonly="running"
            aria-label="Script source"
            @keydown.tab.prevent="insertTab"
        ></textarea>
        <p class="muted small">{{ lineCount }} lines · TypeScript or JavaScript · amounts as strings, e.g. "1.5"</p>

        <!-- Mode -->
        <section class="mode">
            <label :class="{ on: mode === 'plan' }">
                <input v-model="mode" type="radio" value="plan" :disabled="running" />
                <span>
                    <strong>Plan</strong> — record transactions for review. Nothing is signed until you approve.
                </span>
            </label>
            <label :class="{ on: mode === 'live', live: true }">
                <input v-model="mode" type="radio" value="live" :disabled="running" />
                <span>
                    <strong>Live</strong> — send during the run, within the budget you set. For scripts that must
                    react to the result of a send.
                </span>
            </label>
        </section>

        <section v-if="mode === 'live'" class="live_box">
            <p class="warn_text">
                Live mode signs real transactions while the script runs. Only assets you give a budget can be
                spent, never more than that, and at most {{ maxSendsText }} transactions. One password prompt
                covers the run (per wallet).
            </p>
            <div class="live_row">
                <label for="script-max-sends">Max transactions</label>
                <input id="script-max-sends" v-model.number="maxSends" type="number" min="1" max="50" class="field narrow" :disabled="running" />
            </div>
            <div class="budget_head">
                <strong>Budget</strong>
                <button type="button" class="small_btn" :disabled="running || loadingBudget" @click="loadBudget">
                    {{ loadingBudget ? 'Reading balances…' : budget.length ? 'Reload assets' : 'Load my assets' }}
                </button>
            </div>
            <p v-if="!budget.length" class="muted small">Load your assets, then enter how much of each the script may spend.</p>
            <table v-else class="budget">
                <thead>
                    <tr><th>Asset</th><th>Chain</th><th class="num">Balance</th><th class="num">May spend</th></tr>
                </thead>
                <tbody>
                    <tr v-for="b in budget" :key="b.key">
                        <td>{{ b.symbol }}</td>
                        <td class="muted">{{ b.label }}</td>
                        <td class="num">{{ b.balance }}</td>
                        <td class="num">
                            <input v-model.trim="b.max" class="field narrow" inputmode="decimal" placeholder="0" :disabled="running" :aria-label="'Budget for ' + b.symbol" />
                        </td>
                    </tr>
                </tbody>
            </table>
            <div class="add_token">
                <select v-model="tokenPlatform" class="field narrow" aria-label="Token platform">
                    <option value="avalanche">Avalanche C</option>
                    <option value="evm">EVM</option>
                    <option value="solana">Solana</option>
                </select>
                <input v-model.trim="tokenAddress" class="field code" placeholder="Token address to budget" />
                <button type="button" class="small_btn" :disabled="!tokenAddress || running" @click="addTokenBudget">Add</button>
            </div>
            <p v-if="budgetError" class="form_error">{{ budgetError }}</p>
        </section>

        <!-- Run -->
        <section class="run_row">
            <template v-if="!running">
                <v-btn
                    v-if="mode === 'plan'"
                    class="button_primary"
                    depressed
                    :disabled="!canRun"
                    @click="runPlan"
                >
                    Run and plan
                </v-btn>
                <v-btn
                    v-else
                    class="button_primary live_btn"
                    depressed
                    :disabled="!canRun || !hasBudget || isBlocked"
                    @click="gatedAction(runLive)"
                >
                    Run live
                </v-btn>
            </template>
            <v-btn v-else class="button_secondary" depressed @click="abort">Abort</v-btn>
            <span v-if="running" class="muted small">{{ runningLabel }}</span>
        </section>

        <!-- Console -->
        <section class="console" aria-live="polite">
            <div class="console_head">
                <strong>Console</strong>
                <button type="button" class="link_btn" @click="lines = []">Clear</button>
            </div>
            <pre v-if="lines.length" class="console_body"><span v-for="(l, i) in lines" :key="i" :class="l.kind">{{ l.text }}
</span></pre>
            <p v-else class="muted small">Output from log() appears here.</p>
        </section>

        <!-- Live progress -->
        <section v-if="liveSteps.length" class="plan">
            <h3>Sent this run</h3>
            <ol class="plan_list">
                <li v-for="s in liveSteps" :key="s.intent.index" :class="s.result.status">
                    <div class="step_line">
                        <span class="status_tag" :class="s.result.status">{{ statusText(s.result.status) }}</span>
                        {{ s.intent.summary }}
                    </div>
                    <p v-if="s.result.txId" class="tx_line">
                        <a v-if="s.result.explorerUrl" :href="s.result.explorerUrl" target="_blank" rel="noopener noreferrer">{{ s.result.txId }} ↗</a>
                        <span v-else class="code">{{ s.result.txId }}</span>
                    </p>
                    <p v-if="s.result.error" class="form_error">{{ s.result.error }}</p>
                </li>
            </ol>
        </section>

        <!-- Plan review -->
        <section v-if="plan.length" class="plan review">
            <h3>This script will:</h3>
            <ol class="plan_list">
                <li v-for="(i, n) in plan" :key="i.index" :class="resultFor(n).status">
                    <div class="step_line">
                        <span class="net_tag" :class="{ testnet: i.isTestnet }">{{ i.isTestnet ? 'TESTNET' : 'MAINNET' }}</span>
                        <strong>{{ actionText(i) }} {{ i.amount }} {{ i.asset.symbol }}</strong>
                        <span class="muted">on {{ i.chainLabel }}</span>
                    </div>
                    <div class="addr_line">
                        <span class="muted">{{ i.kind === 'crossChain' ? 'to your ' + i.toChain + '-Chain address' : 'to' }}</span>
                        <code class="addr">{{ i.to }}</code>
                    </div>
                    <div v-if="i.asset.id !== 'native'" class="addr_line">
                        <span class="muted">token</span>
                        <code class="addr">{{ i.asset.id }}</code>
                    </div>
                    <p v-if="i.kind === 'crossChain'" class="muted small">Export and import fees are paid on top, from {{ i.chain }}-Chain.</p>
                    <p v-if="blockerFor(n)" class="form_error">{{ blockerFor(n) }}</p>
                    <p v-if="resultFor(n).status !== 'pending'" class="tx_line">
                        <span class="status_tag" :class="resultFor(n).status">{{ statusText(resultFor(n).status) }}</span>
                        <a v-if="resultFor(n).explorerUrl" :href="resultFor(n).explorerUrl" target="_blank" rel="noopener noreferrer">{{ resultFor(n).txId }} ↗</a>
                        <span v-else-if="resultFor(n).txId" class="code">{{ resultFor(n).txId }}</span>
                    </p>
                    <p v-if="resultFor(n).error" class="form_error">{{ resultFor(n).error }}</p>
                </li>
            </ol>
            <div class="totals">
                <strong>Total out:</strong>
                <span v-for="t in review.totals" :key="t.key">{{ fmt(t.total, t.decimals) }} {{ t.symbol }} <span class="muted">({{ t.chainLabel }})</span></span>
            </div>
            <p class="muted small">
                Approving executes exactly these {{ plan.length }} transaction{{ plan.length === 1 ? '' : 's' }}, in order — the script does
                not run again. Expect {{ review.prompts }} password prompt{{ review.prompts === 1 ? '' : 's' }} (one per wallet), plus any
                extension or Ledger confirmations. Execution stops at the first failure.
            </p>
            <div class="row_end">
                <button type="button" class="small_btn" :disabled="executing" @click="discardPlan">{{ planFinished ? 'Done' : 'Discard' }}</button>
                <v-btn
                    v-if="!planFinished"
                    class="button_primary"
                    depressed
                    :loading="executing"
                    :disabled="!canApprove || isBlocked"
                    @click="gatedAction(approve)"
                >
                    Approve and execute
                </v-btn>
            </div>
            <p v-if="planError" class="form_error">{{ planError }}</p>
        </section>

        <!-- Reference -->
        <section class="reference">
            <button type="button" class="link_btn" @click="showReference = !showReference">
                {{ showReference ? 'Hide' : 'Show' }} the script API
            </button>
            <template v-if="showReference">
                <pre class="code ref_body">{{ reference }}</pre>
                <button type="button" class="small_btn" @click="copyReference">Copy as .d.ts</button>
            </template>
        </section>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onBeforeUnmount } from 'vue'

import { runScript, executePlan, reviewPlan, DEFAULT_MAX_SENDS } from '@/scripting/runner'
import { budgetCandidates, tokenBudgetLine, type BudgetCandidate } from '@/scripting/budget'
import { savedScripts, saveScript, deleteScript, newScriptId, EXAMPLES, API_REFERENCE, type SavedScript } from '@/scripting/library'
import { ScopeHolder } from '@/scripting/scope'
import { fromBaseUnits, type Intent, type RunMode, type StepResult, type ScriptPlatform } from '@/scripting/types'
import { SessionAuthCancelled } from '@/js/security/authorize'
import { useBaseAssetGate } from '@/composables/useBaseAssetGate'

interface ConsoleLine {
    kind: 'log' | 'error' | 'result' | 'system'
    text: string
}

const BLANK = `// Read balances, then plan transactions with tx.send / tx.crossChain.\nconst bal = await wallet.balance('avalanche', { chain: 'C' })\nlog('C-Chain AVAX: ' + bal)\n`

export default defineComponent({
    // Listed in Wallet.vue's keep-alive `exclude`: leaving the page must abort
    // a run and close any authorization it holds.
    name: 'wallet_scripts',
    setup() {
        // Premium: approving a plan and starting a live run (useBaseAssetGate).
        const { isBlocked, gatedAction } = useBaseAssetGate()

        // ── library ──
        const saved = computed(() => savedScripts.value)
        const examples = EXAMPLES
        const selectedId = ref('')
        const current = ref<SavedScript | null>(null)
        const name = ref('Untitled script')
        const source = ref(BLANK)
        const savedSource = ref(BLANK)
        const libMessage = ref('')
        const dirty = computed(() => source.value !== savedSource.value || (!!current.value && current.value.name !== name.value))
        const needsReview = computed(() => !!current.value && current.value.imported && !current.value.reviewed)

        const resetRun = () => {
            plan.value = []
            planResults.value = []
            planError.value = ''
            liveSteps.value = []
        }
        const load = (s: { name: string; source: string }, saved: SavedScript | null) => {
            current.value = saved
            name.value = s.name
            source.value = s.source
            savedSource.value = s.source
            libMessage.value = ''
            resetRun()
        }
        const openSelected = () => {
            const id = selectedId.value
            if (!id) return startNew()
            if (id.startsWith('example:')) {
                const e = examples[Number(id.slice(8))]
                load({ name: e.name, source: e.source }, null)
                return
            }
            const s = saved.value.find((x) => x.id === id)
            if (s) load(s, s)
        }
        const startNew = () => {
            selectedId.value = ''
            load({ name: 'Untitled script', source: BLANK }, null)
        }
        const save = () => {
            try {
                const s: SavedScript = {
                    id: current.value?.id ?? newScriptId(),
                    name: name.value.trim() || 'Untitled script',
                    source: source.value,
                    imported: current.value?.imported ?? false,
                    reviewed: current.value?.reviewed ?? false,
                    updatedAt: Date.now(),
                }
                saveScript(s)
                current.value = s
                selectedId.value = s.id
                savedSource.value = s.source
                libMessage.value = 'Saved in this browser.'
            } catch (e: any) {
                libMessage.value = e.message
            }
        }
        const remove = () => {
            const s = current.value
            if (!s) return
            deleteScript(s.id)
            startNew()
            libMessage.value = `Deleted "${s.name}".`
        }
        const copyText = async (text: string, what: string) => {
            try {
                await navigator.clipboard.writeText(text)
                libMessage.value = `${what} copied.`
            } catch {
                libMessage.value = 'Copy failed — select the text and copy it manually.'
            }
        }
        const copySource = () => copyText(source.value, 'Script')

        const showImport = ref(false)
        const importName = ref('')
        const importSource = ref('')
        const doImport = () => {
            const s: SavedScript = {
                id: newScriptId(),
                name: importName.value.trim() || 'Imported script',
                source: importSource.value,
                imported: true,
                reviewed: false,
                updatedAt: Date.now(),
            }
            try {
                saveScript(s)
            } catch (e: any) {
                libMessage.value = e.message
                return
            }
            load(s, s)
            selectedId.value = s.id
            showImport.value = false
            importName.value = ''
            importSource.value = ''
        }
        const acknowledge = () => {
            const s = current.value
            if (!s) return
            const next = Object.assign({}, s, { reviewed: true })
            saveScript(next)
            current.value = next
        }

        // ── editor ──
        const editorEl = ref<HTMLTextAreaElement | null>(null)
        const lineCount = computed(() => source.value.split('\n').length)
        const insertTab = () => {
            const el = editorEl.value
            if (!el) return
            const { selectionStart: a, selectionEnd: b } = el
            source.value = source.value.slice(0, a) + '  ' + source.value.slice(b)
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
        }

        // ── mode / budget ──
        const mode = ref<RunMode>('plan')
        const maxSends = ref(DEFAULT_MAX_SENDS)
        const maxSendsText = computed(() => String(Math.max(1, Math.min(50, Number(maxSends.value) || 1))))
        const budget = ref<BudgetCandidate[]>([])
        const loadingBudget = ref(false)
        const budgetError = ref('')
        const tokenPlatform = ref<ScriptPlatform>('avalanche')
        const tokenAddress = ref('')
        const loadBudget = async () => {
            loadingBudget.value = true
            budgetError.value = ''
            try {
                const old = new Map(budget.value.map((b) => [b.key, b.max]))
                const fresh = await budgetCandidates()
                // Keep limits already typed, and token rows added by hand.
                const kept = budget.value.filter((b) => !fresh.some((f) => f.key === b.key))
                budget.value = fresh.map((b) => Object.assign(b, { max: old.get(b.key) ?? '' })).concat(kept)
                if (!budget.value.length) budgetError.value = 'No connected wallet has a balance to budget.'
            } catch (e: any) {
                budgetError.value = e.message
            } finally {
                loadingBudget.value = false
            }
        }
        const addTokenBudget = async () => {
            budgetError.value = ''
            try {
                const line = await tokenBudgetLine(tokenPlatform.value, tokenAddress.value)
                if (!budget.value.some((b) => b.key === line.key)) budget.value = budget.value.concat([line])
                tokenAddress.value = ''
            } catch (e: any) {
                budgetError.value = e.message
            }
        }
        const hasBudget = computed(() => budget.value.some((b) => b.max && !/^0*\.?0*$/.test(b.max)))

        // ── running ──
        const running = ref(false)
        const runningLabel = ref('')
        const lines = ref<ConsoleLine[]>([])
        let controller: AbortController | null = null
        let scope: ScopeHolder | null = null
        const push = (kind: ConsoleLine['kind'], text: string) => {
            lines.value = lines.value.concat([{ kind, text }]).slice(-1000)
        }
        const canRun = computed(() => !running.value && !executing.value && !needsReview.value && !!source.value.trim())

        const plan = ref<Intent[]>([])
        const planResults = ref<StepResult[]>([])
        const planError = ref('')
        const executing = ref(false)
        const liveSteps = ref<{ intent: Intent; result: StepResult }[]>([])

        const finish = (res: { ok: boolean; error?: string; value?: unknown; elapsedMs: number }) => {
            if (res.ok) {
                if (res.value !== null && res.value !== undefined) push('result', `← ${JSON.stringify(res.value)}`)
                push('system', `Finished in ${(res.elapsedMs / 1000).toFixed(1)} s.`)
            } else {
                push('error', res.error ?? 'The script failed.')
            }
        }

        const execute = async (m: RunMode) => {
            resetRun()
            running.value = true
            controller = new AbortController()
            scope = m === 'live' ? new ScopeHolder() : null
            runningLabel.value = m === 'live' ? 'Running live — transactions are being sent…' : 'Running…'
            push('system', m === 'live' ? '▶ Live run' : '▶ Planning run (nothing will be signed)')
            const recorded: Intent[] = []
            try {
                const res = await runScript(source.value, {
                    mode: m,
                    onLog: (l) => push('log', l),
                    onIntent: (i) => {
                        recorded.push(i)
                        push('system', `planned #${i.index}: ${i.summary}`)
                    },
                    onStep: (intent, result) => {
                        const copy = Object.assign({}, result)
                        const i = liveSteps.value.findIndex((s) => s.intent.index === intent.index)
                        if (i >= 0) liveSteps.value.splice(i, 1, { intent, result: copy })
                        else liveSteps.value = liveSteps.value.concat([{ intent, result: copy }])
                    },
                    budget: budget.value,
                    maxSends: Number(maxSendsText.value),
                    signal: controller.signal,
                    scope: scope ?? undefined,
                })
                finish(res)
                if (m === 'plan' && res.ok && recorded.length) {
                    plan.value = recorded
                    planResults.value = recorded.map((i) => ({ index: i.index, status: 'pending' as const }))
                } else if (m === 'plan' && !res.ok && recorded.length) {
                    push('system', 'The script failed, so its plan was discarded — nothing will be executed.')
                } else if (m === 'plan' && res.ok) {
                    push('system', 'No transactions were planned.')
                }
            } catch (e: any) {
                push('error', e?.message ?? String(e))
            } finally {
                running.value = false
                runningLabel.value = ''
                controller = null
                if (scope) await scope.releaseNow()
                scope = null
            }
        }
        const runPlan = () => execute('plan')
        const runLive = () => execute('live')
        const abort = () => {
            controller?.abort()
            push('system', 'Abort requested — stopping before the next transaction.')
        }

        // ── plan review ──
        const review = computed(() => reviewPlan(plan.value))
        const planFinished = computed(() => planResults.value.length > 0 && planResults.value.every((r) => r.status !== 'pending' && r.status !== 'running'))
        const canApprove = computed(
            () => plan.value.length > 0 && !executing.value && !running.value && review.value.blockers.every((b) => !b) && !planFinished.value
        )
        const blockerFor = (n: number) => review.value.blockers[n] ?? ''
        const resultFor = (n: number): StepResult => planResults.value[n] ?? { index: n + 1, status: 'pending' }
        const approve = async () => {
            if (!canApprove.value) return
            executing.value = true
            planError.value = ''
            controller = new AbortController()
            scope = new ScopeHolder()
            try {
                await executePlan(plan.value, {
                    signal: controller.signal,
                    scope,
                    onResult: (r) => {
                        const n = plan.value.findIndex((i) => i.index === r.index)
                        if (n >= 0) planResults.value.splice(n, 1, Object.assign({}, r))
                    },
                })
                push('system', 'Plan executed.')
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) {
                    planError.value = 'Cancelled at the password prompt. Steps already sent stay sent.'
                    planResults.value = planResults.value.map((r) =>
                        r.status === 'failed' ? Object.assign({}, r, { error: 'Cancelled.' }) : r
                    )
                } else {
                    planError.value = e?.message ?? String(e)
                }
            } finally {
                executing.value = false
                controller = null
                scope = null
            }
        }
        const discardPlan = () => resetRun()

        onBeforeUnmount(() => {
            controller?.abort()
            scope?.releaseNow()
        })

        // ── display ──
        const showReference = ref(false)
        const reference = API_REFERENCE
        const copyReference = () => copyText(API_REFERENCE, 'API declarations')
        const fmt = (v: bigint, d: number) => fromBaseUnits(v, d)
        const actionText = (i: Intent) => (i.kind === 'crossChain' ? `Move` : 'Send')
        const statusText = (s: string) =>
            ({ pending: 'Pending', running: 'Sending…', done: 'Sent', failed: 'Failed', skipped: 'Skipped' }[s] ?? s)

        return {
            isBlocked,
            gatedAction,
            saved,
            examples,
            selectedId,
            current,
            name,
            source,
            dirty,
            needsReview,
            libMessage,
            openSelected,
            startNew,
            save,
            remove,
            copySource,
            showImport,
            importName,
            importSource,
            doImport,
            acknowledge,
            editorEl,
            lineCount,
            insertTab,
            mode,
            maxSends,
            maxSendsText,
            budget,
            loadingBudget,
            budgetError,
            tokenPlatform,
            tokenAddress,
            loadBudget,
            addTokenBudget,
            hasBudget,
            running,
            runningLabel,
            lines,
            canRun,
            runPlan,
            runLive,
            abort,
            plan,
            planError,
            executing,
            liveSteps,
            review,
            planFinished,
            canApprove,
            blockerFor,
            resultFor,
            approve,
            discardPlan,
            showReference,
            reference,
            copyReference,
            fmt,
            actionText,
            statusText,
        }
    },
})
</script>

<style lang="scss" scoped>
.scripting {
    max-width: 860px;
    margin: 0 auto;
    color: var(--primary-color);
}

.head {
    text-align: center;
    margin-bottom: 18px;

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

.field {
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--bg-light);
    color: var(--primary-color);
    border: 1px solid transparent;
    outline: none;

    &:focus {
        border-color: var(--secondary-color);
    }
}

.narrow {
    width: 120px;
}

.code {
    font-family: monospace;
    font-size: 13px;
}

.bar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    .lib_select {
        flex: 1 1 220px;
    }

    .name_input {
        flex: 1 1 200px;
    }
}

.bar_buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.small_btn {
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    background: var(--bg-light);
    color: var(--primary-color);

    &:disabled {
        opacity: 0.5;
    }

    &.primary {
        background: var(--secondary-color);
        color: #fff;
    }

    &.danger {
        color: var(--error);
    }
}

.link_btn {
    font-size: 12px;
    color: var(--secondary-color);
}

.import_box,
.live_box {
    background: var(--bg-light);
    border-radius: 12px;
    padding: 14px;
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .field {
        background: var(--bg);
    }
}

.live_box {
    border: 2px solid var(--error);
}

.warn_text {
    font-size: 13px;
    color: var(--error);
}

.review_banner {
    margin-top: 12px;
    padding: 12px 14px;
    border-radius: 10px;
    border: 2px solid var(--error);
    font-size: 14px;

    .ack {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
        cursor: pointer;
    }
}

.editor {
    margin-top: 12px;
    min-height: 320px;
    resize: vertical;
    line-height: 1.5;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
}

.small_code {
    min-height: 140px;
    white-space: pre;
}

.mode {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 14px;

    label {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--bg-light);
        border: 2px solid transparent;
        cursor: pointer;
        font-size: 14px;

        input {
            margin-top: 4px;
        }

        &.on {
            border-color: var(--secondary-color);
        }

        &.live.on {
            border-color: var(--error);
        }
    }
}

.live_row,
.budget_head,
.add_token {
    display: flex;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
}

.add_token {
    justify-content: flex-start;
}

.budget {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;

    th,
    td {
        padding: 4px 6px;
        text-align: left;
    }

    .num {
        text-align: right;
    }
}

.run_row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 0;
}

.live_btn {
    background: var(--error) !important;
}

.console {
    background: var(--bg-light);
    border-radius: 12px;
    padding: 10px 14px;
}

.console_head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}

.console_body {
    max-height: 280px;
    overflow: auto;
    font-family: monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;

    .error {
        color: var(--error);
    }

    .system {
        color: var(--primary-color-light);
    }

    .result {
        color: var(--success);
    }
}

.plan {
    margin-top: 16px;
    background: var(--bg-light);
    border-radius: 12px;
    padding: 14px;

    h3 {
        font-weight: normal;
        margin-bottom: 8px;
    }

    &.review {
        border: 2px solid var(--secondary-color);
    }
}

.plan_list {
    padding-left: 22px;
    margin: 0;

    li {
        padding: 8px 0;
        border-bottom: 1px solid var(--bg);
    }
}

.step_line {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
}

.addr_line {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-top: 4px;
    font-size: 13px;
}

.addr {
    font-family: monospace;
    font-size: 13px;
    word-break: break-all;
    background: var(--bg);
    padding: 2px 6px;
    border-radius: 4px;
}

.net_tag {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--error);
    color: #fff;

    &.testnet {
        background: var(--primary-color-light);
    }
}

.status_tag {
    font-size: 11px;
    font-weight: 700;

    &.done {
        color: var(--success);
    }

    &.failed {
        color: var(--error);
    }

    &.skipped {
        color: var(--primary-color-light);
    }
}

.tx_line {
    font-size: 12px;
    margin-top: 4px !important;
    word-break: break-all;
}

.totals {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 10px 0;
}

.row_end {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
}

.reference {
    margin-top: 20px;
}

.ref_body {
    background: var(--bg-light);
    border-radius: 10px;
    padding: 12px;
    max-height: 420px;
    overflow: auto;
    white-space: pre;
    margin: 8px 0;
}

.muted {
    color: var(--primary-color-light);
}

.small {
    font-size: 12px;
}

.form_error {
    color: var(--error);
    font-size: 13px;
    margin-top: 4px !important;
}
</style>
