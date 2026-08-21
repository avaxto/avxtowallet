<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Opens a partially signed X-chain transaction, shows what it actually does,
  and adds this wallet's signature to the slots it owns.

  The summary is deliberately built from the transaction's own bytes wherever
  it can be: outputs, amounts and totals are unforgeable that way. Owner
  lists are the exception — a TransferableInput does not carry the owners of
  the output it spends — so those come from source UTXOs travelling in the
  PSAT envelope, structurally matched against the inputs before being
  trusted, and preferentially replaced by the wallet's own scanned UTXO set
  where it has them. Anything unresolved is labelled as such rather than
  guessed at. See js/multisig/psat.ts.
-->
<template>
    <div class="psat_page">
        <h1>Partially Signed Transaction</h1>
        <p class="desc">
            Paste a serialized X-chain transaction to review it, add your signature if you are one
            of its owners, and pass it on or broadcast it.
        </p>

        <div class="card">
            <label for="psat_in">Serialized transaction</label>
            <textarea
                id="psat_in"
                v-model="input"
                class="psat_in"
                placeholder="Paste the base64 transaction here"
                autocomplete="off"
                spellcheck="false"
                :disabled="isSigning"
            ></textarea>
            <div class="row_actions">
                <v-btn depressed class="button_primary" :disabled="!input.trim()" @click="load">
                    Load transaction
                </v-btn>
                <v-btn v-if="summary" text small style="color: var(--primary-color)" @click="reset">
                    Clear
                </v-btn>
            </div>
            <p class="err" v-if="parseError">{{ parseError }}</p>
        </div>

        <template v-if="summary">
            <!-- Status -->
            <div class="card status_card" :data-state="statusState">
                <h2>
                    <fa :icon="statusIcon"></fa>
                    {{ statusTitle }}
                </h2>
                <p>{{ statusDetail }}</p>
                <p v-if="summary.hasUnresolvedOwners" class="unresolved_note">
                    Some inputs' owner lists could not be resolved — this transaction was shared
                    without them and they are not part of an Avalanche transaction's own bytes.
                    Amounts and destinations below are still read directly from the transaction and
                    are accurate.
                </p>
            </div>

            <!-- Where the money goes -->
            <div class="card">
                <h2>Outputs</h2>
                <div v-for="(out, i) in summary.outputs" :key="`o${i}`" class="entry">
                    <div class="entry_top">
                        <span class="amount">{{ formatAmount(out.amount, out.assetId) }}</span>
                        <span v-if="out.isMultisig" class="tag multisig">
                            {{ out.threshold }}-of-{{ out.owners.length }} multisig
                        </span>
                        <span v-if="!out.locktime.isZero()" class="tag">
                            locked until {{ formatLocktime(out.locktime) }}
                        </span>
                    </div>
                    <ul class="addr_list">
                        <li v-for="addr in out.owners" :key="addr">
                            <span class="mono">{{ addr }}</span>
                            <span v-if="isMine(addr)" class="tag you">you</span>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- What is being spent -->
            <div class="card">
                <h2>Inputs (UTXOs being spent)</h2>
                <div v-for="(inp, i) in summary.inputs" :key="`i${i}`" class="entry">
                    <div class="entry_top">
                        <span class="amount">{{ formatAmount(inp.amount, inp.assetId) }}</span>
                        <span v-if="inp.isMultisig" class="tag multisig">
                            {{ inp.threshold }}-of-{{ inp.owners.length }} multisig
                        </span>
                        <span class="tag" :data-ok="inp.missing === 0">
                            {{
                                inp.missing === 0
                                    ? 'fully signed'
                                    : `${inp.missing} signature(s) missing`
                            }}
                        </span>
                    </div>
                    <p class="utxo_ref mono">{{ inp.txId }}:{{ inp.outputIdx }}</p>
                    <ul class="slot_list">
                        <li v-for="(slot, j) in inp.slots" :key="`s${j}`">
                            <fa
                                :icon="slot.signed ? 'check-circle' : 'times-circle'"
                                :class="slot.signed ? 'sig_yes' : 'sig_no'"
                            ></fa>
                            <span class="mono">
                                {{ slot.address ?? `owner #${slot.addressIdx + 1} (unknown)` }}
                            </span>
                            <span v-if="slot.mine" class="tag you">you</span>
                            <span class="slot_state">
                                {{ slot.signed ? 'signed' : 'not signed' }}
                            </span>
                        </li>
                    </ul>
                </div>
            </div>

            <!-- Totals -->
            <div class="card">
                <h2>Totals</h2>
                <div v-for="row in totalRows" :key="row.assetId" class="summary_line">
                    <span>{{ row.symbol }}</span>
                    <span>
                        in {{ row.input }} → out {{ row.output }}
                        <template v-if="row.fee">· fee {{ row.fee }}</template>
                    </span>
                </div>
                <div v-if="summary.memo" class="summary_line">
                    <span>Memo</span>
                    <span>{{ summary.memo }}</span>
                </div>
                <div class="summary_line">
                    <span>Network</span>
                    <span>{{ summary.networkId }}</span>
                </div>
            </div>

            <!-- Act -->
            <div class="card">
                <h2>Your turn</h2>
                <p class="act_note">{{ actNote }}</p>
                <p class="err" v-if="actionError">{{ actionError }}</p>

                <div class="row_actions">
                    <v-btn
                        depressed
                        class="button_primary"
                        :disabled="!summary.canSign || isSigning"
                        :loading="isSigning"
                        @click="sign"
                    >
                        Sign with my key{{ mySlotCount > 1 ? 's' : '' }}
                    </v-btn>
                    <v-btn
                        depressed
                        class="button_secondary"
                        :disabled="!summary.complete || isBroadcasting || broadcastId !== ''"
                        :loading="isBroadcasting"
                        @click="broadcast"
                    >
                        Broadcast
                    </v-btn>
                </div>

                <p v-if="broadcastId" class="broadcast_ok">
                    Broadcast — transaction id
                    <span class="mono">{{ broadcastId }}</span>
                </p>

                <template v-if="outputBase64">
                    <label class="result_label">
                        {{
                            summary.complete
                                ? 'Signed transaction'
                                : 'Updated transaction — pass to the next signer'
                        }}
                    </label>
                    <textarea
                        class="psat_out"
                        readonly
                        :value="outputBase64"
                        @focus="selectAll"
                    ></textarea>
                    <ShareLinks
                        :text="shareMessage"
                        :copy-text="outputBase64"
                        subject="Partially signed Avalanche transaction"
                        :label="
                            summary.complete
                                ? 'Share the signed transaction'
                                : 'Send it to the next signer'
                        "
                    ></ShareLinks>
                </template>
            </div>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import Big from 'big.js'

import { BN } from '@/avalanche'
import { bintools } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import { useAssetsStore, useMainStore, useNotificationsStore } from '@/stores'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { issueX } from '@/helpers/issueTx'
import {
    assertSameNetwork,
    decodePsat,
    encodePsat,
    signPsat,
    sourceUtxoList,
    summarizePsat,
} from '@/js/multisig/psat'
import type { DecodedPsat, PsatSummary } from '@/js/multisig/psat'
import ShareLinks from '@/components/misc/ShareLinks.vue'
import type { Wallet } from '@/js/wallets/AbstractWallet'
import type { Tx as AVMTx, UTXO as AVMUTXO } from '@/avalanche/apis/avm'

export default defineComponent({
    name: 'Psat',
    components: { ShareLinks },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const input = ref('')
        const decoded = ref<DecodedPsat | null>(null)
        const summary = ref<PsatSummary | null>(null)
        const parseError = ref('')
        const actionError = ref('')
        const isSigning = ref(false)
        const isBroadcasting = ref(false)
        const outputBase64 = ref('')
        const broadcastId = ref('')

        const wallet = computed((): Wallet | null => mainStore.activeWallet as Wallet | null)

        const ownedAddresses = computed((): string[] => {
            const w = wallet.value
            if (!w) return []
            try {
                return w.getAllAddressesX()
            } catch {
                return []
            }
        })

        const isMine = (addr: string): boolean => ownedAddresses.value.includes(addr)

        /**
         * The wallet's own scanned UTXO set, preferred over anything the
         * sender supplied because it came from the network rather than from
         * them.
         */
        const walletUtxo = (utxoId: string): AVMUTXO | undefined => {
            try {
                return wallet.value?.getUTXOSet().getUTXO(utxoId) as AVMUTXO | undefined
            } catch {
                return undefined
            }
        }

        const rebuildSummary = () => {
            if (!decoded.value) return
            summary.value = summarizePsat(decoded.value, ownedAddresses.value, walletUtxo)
        }

        const load = () => {
            parseError.value = ''
            actionError.value = ''
            outputBase64.value = ''
            broadcastId.value = ''
            summary.value = null
            decoded.value = null
            try {
                const result = decodePsat(input.value)
                assertSameNetwork(result.unsignedTx)
                decoded.value = result
                rebuildSummary()
            } catch (e: any) {
                parseError.value = e?.message ?? String(e)
            }
        }

        const reset = () => {
            input.value = ''
            decoded.value = null
            summary.value = null
            parseError.value = ''
            actionError.value = ''
            outputBase64.value = ''
            broadcastId.value = ''
        }

        const mySlotCount = computed((): number => {
            if (!summary.value) return 0
            return summary.value.inputs.reduce(
                (n, i) => n + i.slots.filter((s) => s.mine && !s.signed).length,
                0
            )
        })

        const statusState = computed((): string => {
            if (!summary.value) return 'none'
            if (summary.value.complete) return 'complete'
            return summary.value.canSign ? 'actionable' : 'waiting'
        })

        const statusIcon = computed((): string => {
            const state = statusState.value
            if (state === 'complete') return 'check-circle'
            return state === 'actionable' ? 'key' : 'info-circle'
        })

        const statusTitle = computed((): string => {
            const state = statusState.value
            if (state === 'complete') return 'Fully signed'
            return state === 'actionable' ? 'Your signature is needed' : 'Waiting on other signers'
        })

        const statusDetail = computed((): string => {
            const s = summary.value
            if (!s) return ''
            if (s.complete) return 'Every required signature is present. This can be broadcast.'
            const missing = `${s.missingSignatures} signature${
                s.missingSignatures === 1 ? '' : 's'
            } still needed.`
            if (s.canSign) return `${missing} You hold a key for at least one of them.`
            if (!wallet.value) return `${missing} Connect a wallet to check whether you can sign.`
            return `${missing} None of them belong to an address in this wallet.`
        })

        const actNote = computed((): string => {
            const s = summary.value
            if (!s) return ''
            if (s.complete) {
                return 'Nothing left to sign — broadcast it, or share it so someone else can.'
            }
            if (s.canSign) {
                return `You can fill ${mySlotCount.value} of the missing signature${
                    mySlotCount.value === 1 ? '' : 's'
                }. After signing, pass the updated transaction to the remaining owners.`
            }
            return 'This wallet holds no key for any of the missing signatures, so there is nothing for you to sign. Pass it to an owner who does.'
        })

        const assetSymbol = (assetId: string): string => {
            const asset = assetsStore.assetsDict[assetId]
            return asset?.symbol ?? assetId.slice(0, 8)
        }

        const assetDenomination = (assetId: string): number => {
            const asset = assetsStore.assetsDict[assetId]
            return asset?.denomination ?? 0
        }

        const formatAmount = (amount: BN, assetId: string): string => {
            const big: Big = bnToBig(amount, assetDenomination(assetId))
            return `${big.toString()} ${assetSymbol(assetId)}`
        }

        const formatLocktime = (locktime: BN): string =>
            new Date(locktime.toNumber() * 1000).toLocaleString()

        const totalRows = computed(() => {
            const s = summary.value
            if (!s) return []
            const assetIds = new Set([
                ...Object.keys(s.inputTotals),
                ...Object.keys(s.outputTotals),
            ])
            return [...assetIds].map((assetId) => {
                const denom = assetDenomination(assetId)
                const fee = s.burn[assetId]
                return {
                    assetId,
                    symbol: assetSymbol(assetId),
                    input: bnToBig(s.inputTotals[assetId] ?? new BN(0), denom).toString(),
                    output: bnToBig(s.outputTotals[assetId] ?? new BN(0), denom).toString(),
                    fee: fee ? bnToBig(fee, denom).toString() : '',
                }
            })
        })

        const sign = async () => {
            const w = wallet.value
            const d = decoded.value
            const s = summary.value
            if (!w || !d || !s) return

            const signer = (w as unknown) as {
                signHashForXAddress?: (address: string, hash: any) => Promise<any>
            }
            if (typeof signer.signHashForXAddress !== 'function') {
                actionError.value =
                    'This wallet type cannot co-sign a multisig transaction yet. Use a mnemonic or private-key wallet.'
                return
            }

            isSigning.value = true
            actionError.value = ''
            try {
                const signed: AVMTx = await authorizeSingle(
                    w,
                    'Sign a partially signed X-chain transaction',
                    () =>
                        signPsat(d, s, (address, hash) =>
                            signer.signHashForXAddress!(address, hash)
                        )
                )

                // Re-open the result so the summary reflects the signature
                // that was just added rather than the state it was loaded in.
                const utxos = sourceUtxoList(d)
                const nextBase64 = encodePsat(signed, utxos)
                outputBase64.value = nextBase64
                decoded.value = decodePsat(nextBase64)
                rebuildSummary()

                notifications.add({
                    title: 'Signed',
                    message: summary.value?.complete
                        ? 'The transaction is now fully signed.'
                        : 'Your signature was added. Pass it to the next signer.',
                    type: 'success',
                })
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                actionError.value = e?.message ?? String(e)
            } finally {
                isSigning.value = false
            }
        }

        const broadcast = async () => {
            const d = decoded.value
            if (!d || !summary.value?.complete) return
            isBroadcasting.value = true
            actionError.value = ''
            try {
                broadcastId.value = await issueX(d.tx)
                notifications.add({
                    title: 'Broadcast',
                    message: 'The transaction was submitted to the network.',
                    type: 'success',
                })
                assetsStore.updateUTXOs()
            } catch (e: any) {
                actionError.value = e?.message ?? String(e)
            } finally {
                isBroadcasting.value = false
            }
        }

        const psatUrl = computed((): string => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            return `${origin}/wallet/psat`
        })

        const shareMessage = computed(
            () =>
                'You are receiving a serialized PSAT partially signed avalanche ' +
                `transaction from AVXTO Wallet, open it on ${psatUrl.value} to sign and either pass it ` +
                'forward to another signer or broadcast it to the network\n\n' +
                outputBase64.value
        )

        const selectAll = (e: FocusEvent) => {
            const target = e.target as HTMLTextAreaElement
            target.select()
        }

        return {
            input,
            summary,
            parseError,
            actionError,
            isSigning,
            isBroadcasting,
            outputBase64,
            broadcastId,
            mySlotCount,
            statusState,
            statusIcon,
            statusTitle,
            statusDetail,
            actNote,
            totalRows,
            shareMessage,
            isMine,
            formatAmount,
            formatLocktime,
            load,
            reset,
            sign,
            broadcast,
            selectAll,
        }
    },
})
</script>

<style scoped lang="scss">
.psat_page {
    width: 100%;
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
    border-radius: 12px;
    padding: 20px 24px;
    margin-bottom: 16px;

    h2 {
        margin: 0 0 12px;
        font-size: 15px;
    }

    > label {
        display: block;
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color-light);
        margin-bottom: 4px;
    }
}

.psat_in,
.psat_out {
    width: 100%;
    min-height: 110px;
    resize: vertical;
    background-color: var(--bg);
    border-radius: 6px;
    padding: 10px;
    color: var(--primary-color);
    font-family: monospace;
    font-size: 11px;
    word-break: break-all;
}

.row_actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    flex-wrap: wrap;
}

.status_card {
    h2 {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    p {
        font-size: 13px;
        color: var(--primary-color-light);
        line-height: 1.55;
    }

    &[data-state='complete'] h2 {
        color: var(--success);
    }
    &[data-state='actionable'] h2 {
        color: var(--secondary-color);
    }
}

.unresolved_note {
    margin-top: 10px;
    padding: 10px;
    background: var(--bg);
    border-left: 3px solid var(--warning);
    border-radius: 4px;
    font-size: 12px;
}

.entry {
    padding: 12px 0;
    border-bottom: 1px solid var(--bg);

    &:last-child {
        border-bottom: none;
        padding-bottom: 0;
    }
}

.entry_top {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
}

.amount {
    font-size: 14px;
    font-weight: 600;
    color: var(--primary-color);
}

.tag {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 7px;
    border-radius: 4px;
    background: var(--bg);
    color: var(--primary-color-light);

    &.multisig {
        color: var(--secondary-color);
    }

    &.you {
        color: var(--success);
    }

    &[data-ok='true'] {
        color: var(--success);
    }
}

.utxo_ref {
    font-size: 11px;
    color: var(--primary-color-light);
    word-break: break-all;
    margin-bottom: 6px;
}

.addr_list,
.slot_list {
    list-style: none;
    margin: 0;
    padding: 0;

    li {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        font-size: 12px;
        padding: 2px 0;
        color: var(--primary-color-light);
    }
}

.mono {
    font-family: monospace;
    word-break: break-all;
}

.sig_yes {
    color: var(--success);
}

.sig_no {
    color: var(--primary-color-light);
    opacity: 0.6;
}

.slot_state {
    margin-left: auto;
    font-size: 11px;
}

.summary_line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    padding: 4px 0;

    span:first-child {
        color: var(--primary-color-light);
    }
    span:last-child {
        color: var(--primary-color);
        text-align: right;
        word-break: break-word;
    }
}

.act_note {
    font-size: 13px;
    color: var(--primary-color-light);
    line-height: 1.55;
    margin-bottom: 4px;
}

.result_label {
    display: block;
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin: 16px 0 4px;
}

.broadcast_ok {
    margin-top: 10px;
    font-size: 12px;
    color: var(--success);
    word-break: break-all;
}

.err {
    margin-top: 10px;
    color: var(--error);
    font-size: 13px;
}
</style>
