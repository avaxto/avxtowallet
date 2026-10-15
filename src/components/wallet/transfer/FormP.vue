<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Send AVAX from the P-Chain to another P-Chain address, with optional coin
  control. Built and priced by the Avalanche SDK (dynamic fees since Etna):
  see js/pChainSend.ts. The preview shown before sending is the very
  transaction that gets signed.
-->
<template>
    <div class="form_p">
        <slot></slot>

        <p class="balance">
            <span class="label">Available on P-Chain</span>
            <span v-if="loadingUtxos">Loading…</span>
            <span v-else>{{ fmtAvax(spendableTotal) }} AVAX</span>
            <button type="button" class="refresh" :disabled="loadingUtxos || isConfirm" title="Reload UTXOs" @click="loadUtxos">
                <fa icon="sync"></fa>
            </button>
        </p>
        <p v-if="lockedTotal.gt(zero)" class="hint">Plus {{ fmtAvax(lockedTotal) }} AVAX staked or locked, which can't be sent.</p>

        <h4>To</h4>
        <qr-input v-model="toIn" class="qrIn hover_border" placeholder="P-avax1…" :disabled="isConfirm"></qr-input>

        <h4>Amount</h4>
        <div class="amount_row">
            <input v-model="amountIn" class="amount_in" inputmode="decimal" placeholder="0.0" :disabled="isConfirm" />
            <span class="unit">AVAX</span>
        </div>

        <h4>Memo</h4>
        <textarea v-model="memoIn" class="memo" maxlength="256" placeholder="Memo" autocomplete="off" :disabled="isConfirm"></textarea>

        <CoinControl
            v-model="picked"
            v-model:enabled="coinEnabled"
            v-model:sameChange="sameChange"
            :rows="rows"
            :assets="assetMeta"
            :loading="loadingUtxos"
            :error="utxoError"
            :disabled="isConfirm"
        ></CoinControl>

        <div v-if="preview" class="preview">
            <h4>This transaction spends {{ preview.inputs.length }} UTXO{{ preview.inputs.length === 1 ? '' : 's' }}</h4>
            <ul>
                <li v-for="i in preview.inputs" :key="i.utxoId">
                    <span class="mono">{{ shortId(i.utxoId) }}</span>
                    <span>{{ fmtAvax(i.amount) }} AVAX</span>
                </li>
            </ul>
            <p><span class="label">Fee</span> {{ fmtAvax(preview.fee) }} AVAX</p>
            <p><span class="label">Change back to you</span> {{ fmtAvax(preview.change) }} AVAX</p>
            <p v-if="changeOverride" class="hint">Change goes to the spent UTXO’s own address: <span class="mono">{{ changeOverride }}</span></p>
        </div>
        <p v-else-if="previewError" class="err">{{ previewError }}</p>
        <p v-else-if="previewing" class="hint">Working out the fee…</p>

        <div class="checkout">
            <ul v-if="formErrors.length" class="err_list">
                <li v-for="e in formErrors" :key="e">{{ e }}</li>
            </ul>
            <p v-if="err" class="err">{{ err }}</p>

            <template v-if="offline.hasRecords">
                <SignedTxExport :records="offline.records" @done="startAgain"></SignedTxExport>
            </template>
            <template v-else-if="txId">
                <p class="ok"><fa icon="check-circle"></fa> Transaction sent</p>
                <label class="tx_id"><b>ID:</b> {{ txId }}</label>
                <v-btn depressed class="button_primary" block :ripple="false" @click="startAgain">Start again</v-btn>
            </template>
            <template v-else-if="isInjected">
                <SignOnlyToggle :disabled="isAjax"></SignOnlyToggle>
                <v-btn depressed class="button_primary" block :ripple="false" :loading="isAjax" :disabled="!canSend || isAjax" @click="sendOneClick">
                    Send
                </v-btn>
            </template>
            <template v-else-if="!isConfirm">
                <v-btn depressed class="button_primary" block :ripple="false" :disabled="!canSend || previewing" @click="confirm">Confirm</v-btn>
            </template>
            <template v-else>
                <SignOnlyToggle :disabled="isAjax"></SignOnlyToggle>
                <v-btn depressed class="button_primary" block :ripple="false" :loading="isAjax" :disabled="!preview || isAjax" @click="submit">Send</v-btn>
                <v-btn text block small class="cancel" :disabled="isAjax" @click="cancelConfirm">Cancel</v-btn>
            </template>
        </div>
    </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, ref, watch } from 'vue'
import Big from 'big.js'
import type { Utxo } from '@avalabs/avalanchejs'
import { BN } from '@/avalanche'
import { ava, isValidAddress } from '@/AVA'
import { getPreferredHRP } from '@/avalanche/utils'
import { useAssetsStore, useMainStore, useNotificationsStore, useOfflineSigningStore, isOfflineTxId } from '@/stores'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import type { Wallet } from '@/js/wallets/AbstractWallet'
import { QrInput } from '@/vue_components'
import CoinControl from './CoinControl.vue'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'
import { fetchPUtxos, pCoinRows, preparePSend, type PSendPreview } from '@/js/pChainSend'
import type { CoinRow } from '@/js/coinControl'

const NANO = new Big(1e9)

export default defineComponent({
    name: 'FormP',
    components: { QrInput, CoinControl, SignOnlyToggle, SignedTxExport },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()
        const offline = useOfflineSigningStore()
        const wallet = computed(() => mainStore.activeWallet as Wallet | null)
        const isInjected = computed(() => wallet.value?.type === 'injected')
        const hrp = () => getPreferredHRP(ava.getNetworkID())
        const zero = new BN(0)

        const toIn = ref('')
        const amountIn = ref('')
        const memoIn = ref('')
        const formErrors = ref<string[]>([])
        const err = ref('')
        const isConfirm = ref(false)
        const isAjax = ref(false)
        const txId = ref('')

        // ── UTXOs ──
        const utxos = ref<Utxo[]>([])
        const rows = ref<CoinRow[]>([])
        const loadingUtxos = ref(false)
        const utxoError = ref('')
        const coinEnabled = ref(false)
        const picked = ref<string[]>([])
        /** With exactly one UTXO picked: change back to that UTXO's own address. */
        const sameChange = ref(false)
        const changeOverride = computed(() => {
            if (!coinEnabled.value || !sameChange.value || picked.value.length !== 1) return undefined
            return rows.value.find((r) => r.utxoId === picked.value[0])?.ownAddress
        })
        const avaxId = computed(() => assetsStore.AssetAVA?.id ?? '')
        const assetMeta = computed(() => (avaxId.value ? { [avaxId.value]: { symbol: 'AVAX', denomination: 9 } } : {}))
        const spendableTotal = computed(() => rows.value.filter((r) => r.spendable).reduce((s, r) => s.add(r.amount), new BN(0)))
        const lockedTotal = computed(() =>
            rows.value.filter((r) => !r.spendable && r.assetId === avaxId.value).reduce((s, r) => s.add(r.amount), new BN(0))
        )

        const loadUtxos = async () => {
            const w = wallet.value
            if (!w) return
            loadingUtxos.value = true
            utxoError.value = ''
            try {
                const src = await w.pSendSource()
                utxos.value = await fetchPUtxos(src.fromAddresses)
                rows.value = pCoinRows(utxos.value, src.fromAddresses, hrp(), avaxId.value)
                const live = new Set(rows.value.filter((r) => r.spendable).map((r) => r.utxoId))
                picked.value = picked.value.filter((id) => live.has(id))
            } catch (e: any) {
                utxoError.value = e?.message || 'Could not load P-Chain UTXOs.'
            } finally {
                loadingUtxos.value = false
            }
        }
        onMounted(loadUtxos)

        // ── amount and validation ──
        const amountNano = computed((): bigint | null => {
            const v = amountIn.value.trim()
            if (!/^\d*\.?\d*$/.test(v) || v === '' || v === '.') return null
            const n = new Big(v).times(NANO)
            if (!n.eq(n.round(0, 0)) || n.lte(0)) return null
            return BigInt(n.toFixed(0))
        })
        const toValid = computed(() => {
            const a = toIn.value.trim()
            return a.startsWith('P-') && isValidAddress(a) && a.includes(hrp())
        })
        const canSend = computed(
            () => toValid.value && amountNano.value !== null && !(coinEnabled.value && picked.value.length === 0) && !loadingUtxos.value
        )

        const formCheck = () => {
            const errs: string[] = []
            const a = toIn.value.trim()
            if (!a.startsWith('P-')) errs.push('Send to a P-Chain address (P-…).')
            else if (!isValidAddress(a) || !a.includes(hrp())) errs.push('Not a valid P-Chain address for this network.')
            if (amountNano.value === null) errs.push('Enter an amount in AVAX, up to 9 decimals.')
            if (coinEnabled.value && picked.value.length === 0) errs.push('Select at least one UTXO, or turn coin control off.')
            if (new TextEncoder().encode(memoIn.value).length > 256) errs.push('The memo can be at most 256 bytes.')
            formErrors.value = errs
            return errs.length === 0
        }

        // ── preview: the real unsigned transaction ──
        const preview = ref<PSendPreview | null>(null)
        const previewError = ref('')
        const previewing = ref(false)
        let token = 0

        const buildPreview = async (): Promise<PSendPreview | null> => {
            const w = wallet.value
            const amount = amountNano.value
            if (!w || amount === null || (coinEnabled.value && picked.value.length === 0)) return null
            const src = await w.pSendSource()
            const chosen = coinEnabled.value ? utxos.value.filter((u) => picked.value.includes(u.ID())) : undefined
            return preparePSend({
                // Coin selection doesn't depend on the recipient: the change address stands in until one is typed.
                to: toValid.value ? toIn.value.trim() : src.changeAddress,
                amount,
                memo: memoIn.value || undefined,
                fromAddresses: src.fromAddresses,
                changeAddress: changeOverride.value ?? src.changeAddress,
                utxos: chosen,
                publicKey: src.publicKey,
            })
        }

        const refreshPreview = async () => {
            const t = ++token
            previewError.value = ''
            if (amountNano.value === null || (coinEnabled.value && picked.value.length === 0)) {
                preview.value = null
                return
            }
            previewing.value = true
            try {
                const p = await buildPreview()
                if (t === token) preview.value = p
            } catch (e: any) {
                if (t !== token) return
                preview.value = null
                previewError.value = friendly(e)
            } finally {
                if (t === token) previewing.value = false
            }
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        watch([toIn, amountIn, memoIn, coinEnabled, picked, sameChange], () => {
            if (isConfirm.value) return
            clearTimeout(timer)
            timer = setTimeout(refreshPreview, 400)
        }, { deep: true })

        const friendly = (e: any): string => {
            const m = String(e?.message || e || '')
            if (/insufficient|not enough|InsufficientFunds/i.test(m)) {
                return coinEnabled.value ? 'The selected UTXOs don’t cover the amount plus the fee.' : 'Not enough unlocked AVAX on the P-Chain for this amount plus the fee.'
            }
            return m || 'Could not build the transaction.'
        }

        // ── confirm and send ──
        const confirm = async () => {
            if (!formCheck()) return
            err.value = ''
            previewing.value = true
            try {
                // Rebuild from the exact values being confirmed: this is what gets signed.
                preview.value = await buildPreview()
                isConfirm.value = !!preview.value
            } catch (e: any) {
                err.value = friendly(e)
            } finally {
                previewing.value = false
            }
        }

        const cancelConfirm = () => {
            isConfirm.value = false
            err.value = ''
            refreshPreview()
        }

        const submit = async () => {
            const w = wallet.value
            const p = preview.value
            if (!w || !p) return
            isAjax.value = true
            err.value = ''
            try {
                const id = await authorizeSingle(w, 'Send a P-chain transaction', () => w.issuePSend(p))
                if (isOfflineTxId(id)) return
                txId.value = id
                notifications.add({ title: 'Sent', message: 'P-Chain transaction submitted.', type: 'success' })
                setTimeout(() => {
                    assetsStore.updateUTXOs()
                    loadUtxos()
                }, 2500)
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                err.value = friendly(e)
            } finally {
                isAjax.value = false
            }
        }

        const sendOneClick = async () => {
            await confirm()
            if (isConfirm.value) await submit()
        }

        const startAgain = () => {
            offline.clearRecords()
            toIn.value = ''
            amountIn.value = ''
            memoIn.value = ''
            picked.value = []
            coinEnabled.value = false
            sameChange.value = false
            preview.value = null
            txId.value = ''
            err.value = ''
            isConfirm.value = false
            loadUtxos()
        }

        const fmtAvax = (v: BN) => new Big(v.toString()).div(NANO).toFixed()
        const shortId = (id: string) => (id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id)

        return {
            offline,
            isInjected,
            zero,
            toIn,
            amountIn,
            memoIn,
            formErrors,
            err,
            isConfirm,
            isAjax,
            txId,
            rows,
            loadingUtxos,
            utxoError,
            coinEnabled,
            picked,
            sameChange,
            changeOverride,
            assetMeta,
            spendableTotal,
            lockedTotal,
            loadUtxos,
            canSend,
            preview,
            previewError,
            previewing,
            confirm,
            cancelConfirm,
            submit,
            sendOneClick,
            startAgain,
            fmtAvax,
            shortId,
        }
    },
})
</script>

<style scoped lang="scss">
.form_p {
    color: var(--primary-color);
    max-width: 560px;

    h4 {
        margin: 14px 0 6px;
        font-size: 14px;
    }
}

.balance {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 0 0;
    font-size: 14px;

    .refresh {
        color: var(--primary-color-light);

        &:disabled {
            opacity: 0.4;
        }
    }
}

.label {
    color: var(--primary-color-light);
    margin-right: 6px;
}

.amount_row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-light);
    border-radius: 4px;
    padding: 0 12px;

    .amount_in {
        flex: 1;
        min-width: 0;
        padding: 10px 0;
        background: transparent;
        color: var(--primary-color);
        font-size: 16px;
        outline: none;
    }

    .unit {
        color: var(--primary-color-light);
    }
}

.memo {
    width: 100%;
    min-height: 60px;
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--bg-light);
    color: var(--primary-color);
    font-size: 13px;
    resize: vertical;
}

.preview {
    margin: 12px 0;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--bg-light);
    font-size: 13px;

    h4 {
        margin: 0 0 6px;
    }

    ul {
        list-style: none;
        padding: 0;
        margin: 0 0 8px;

        li {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            padding: 3px 0;
            border-top: 1px solid var(--bg);
        }
    }

    p {
        margin: 2px 0;
    }
}

.mono {
    font-family: monospace;
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin: 4px 0 0;
}

.err {
    color: var(--error);
    font-size: 13px;
    margin: 8px 0;
}

.err_list {
    color: var(--error);
    font-size: 13px;
    padding-left: 18px;
}

.checkout {
    margin-top: 16px;
}

.ok {
    color: var(--success);
}

.tx_id {
    display: block;
    word-break: break-all;
    font-size: 13px;
    margin: 6px 0 12px;
}

.cancel {
    margin-top: 12px !important;
    color: var(--primary-color) !important;
}
</style>
