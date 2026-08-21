<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Sends X-chain funds into an M-of-N shared output.

  What this produces is a COMPLETE transaction, not a partial one: its inputs
  are the sender's own single-signature UTXOs, so the sender alone can sign
  it. The multisig applies to the output it creates — spending that output
  later is what needs M signatures and travels between owners as a PSAT.
  The share step here exists so the other owners can check the output they
  are about to be co-owners of before it goes on chain.

  Owner addresses are unforgiving by design: an address nobody holds the key
  for permanently reduces how many of the N can sign, and enough of those
  makes the threshold unreachable and the funds unspendable. Hence the
  explicit confirmation gate rather than a plain submit button.
-->
<template>
    <div class="multisig_form">
        <template v-if="!signedTx">
            <div class="intro">
                <h4>Multisig output</h4>
                <p>
                    Send to an output that needs several signatures to spend. Everyone listed below
                    becomes a co-owner, and any
                    <strong>{{ threshold }}</strong>
                    of them must sign to move the funds.
                </p>
            </div>

            <div class="owners">
                <div v-for="(owner, i) in owners" :key="owner.uuid" class="owner_row">
                    <div class="owner_head">
                        <h4>
                            Owner #{{ i + 1 }}
                            <span v-if="i === 0" class="you_tag">you</span>
                        </h4>
                        <button
                            v-if="owners.length > 1 && !isConfirm"
                            class="remove_but"
                            @click="removeOwner(i)"
                            title="Remove this owner"
                        >
                            <fa icon="times"></fa>
                        </button>
                    </div>
                    <input
                        v-model="owner.address"
                        type="text"
                        class="owner_input"
                        placeholder="X-avax1…"
                        autocomplete="off"
                        spellcheck="false"
                        :disabled="isConfirm || isSending"
                    />
                </div>
            </div>

            <button v-if="!isConfirm" class="add_owner" @click="addOwner" :disabled="isSending">
                <fa icon="plus"></fa>
                Add owner
            </button>

            <div class="threshold_row">
                <label for="ms_threshold">
                    Signatures required
                    <small>Between 1 and {{ owners.length }}</small>
                </label>
                <input
                    id="ms_threshold"
                    v-model.number="threshold"
                    type="number"
                    min="1"
                    :max="owners.length"
                    step="1"
                    :disabled="isConfirm || isSending"
                />
            </div>

            <div class="amount_row">
                <label>Amount</label>
                <currency-input-dropdown
                    class="cur_in"
                    :disabled="isConfirm || isSending"
                    @change="onAmountChange"
                ></currency-input-dropdown>
            </div>

            <div class="memo_cont">
                <label>Memo (optional)</label>
                <textarea
                    class="memo"
                    maxlength="256"
                    placeholder="Memo"
                    autocomplete="off"
                    v-model="memo"
                    :disabled="isConfirm || isSending"
                ></textarea>
            </div>

            <div class="fees">
                <p>
                    Transaction fee
                    <span>{{ txFee.toLocaleString(9) }} AVAX</span>
                </p>
            </div>

            <!-- Confirmation screen -->
            <div v-if="isConfirm" class="confirm_panel">
                <h4>Confirm the co-owners</h4>
                <p class="confirm_intro">
                    <strong>{{ threshold }} of {{ owners.length }}</strong>
                    signatures will be required to spend this output.
                </p>
                <ol class="confirm_owners">
                    <li v-for="(owner, i) in owners" :key="owner.uuid">
                        <span class="mono">{{ owner.address.trim() }}</span>
                        <span v-if="i === 0" class="you_tag">you</span>
                    </li>
                </ol>
                <div class="warn_box">
                    <fa icon="exclamation-triangle"></fa>
                    <div>
                        <strong>Check every address character by character.</strong>
                        An address nobody holds the key for cannot ever sign. If that leaves fewer
                        than {{ threshold }} owners able to sign, the funds sent here become
                        permanently unspendable. There is no way to undo this once broadcast.
                    </div>
                </div>
                <label class="ack_row">
                    <input type="checkbox" v-model="acknowledged" :disabled="isSending" />
                    I have checked every address above and understand the funds may be unrecoverable
                    if any of them is wrong.
                </label>
            </div>

            <ul class="err_list" v-if="formErrors.length">
                <li v-for="e in formErrors" :key="e">{{ e }}</li>
            </ul>
            <p class="err" v-if="err">{{ err }}</p>

            <div class="actions">
                <v-btn
                    v-if="!isConfirm"
                    depressed
                    block
                    class="button_primary"
                    :disabled="!canConfirm"
                    @click="confirm"
                >
                    Review co-owners
                </v-btn>
                <template v-else>
                    <v-btn
                        depressed
                        block
                        class="button_primary"
                        :disabled="!acknowledged || isSending"
                        :loading="isSending"
                        @click="submit"
                    >
                        Create and sign
                    </v-btn>
                    <v-btn
                        text
                        block
                        small
                        style="color: var(--primary-color)"
                        :disabled="isSending"
                        @click="cancelConfirm"
                    >
                        Back
                    </v-btn>
                </template>
            </div>
        </template>

        <!-- Result: signed, not yet broadcast -->
        <div v-else class="result_panel">
            <h4>
                <fa icon="check-circle"></fa>
                Transaction signed
            </h4>
            <p class="result_intro">
                This transaction is complete and ready to broadcast — it spends your own funds, so
                no other signature is needed. Share it so the other owners can check the output
                first, or broadcast it now.
            </p>

            <div class="result_summary">
                <div class="summary_line">
                    <span>Requires</span>
                    <span>{{ threshold }} of {{ owners.length }} signatures to spend</span>
                </div>
                <div class="summary_line">
                    <span>Amount</span>
                    <span>{{ amountDisplay }}</span>
                </div>
            </div>

            <label class="result_label">Serialized transaction (PSAT)</label>
            <textarea class="psat_out" readonly :value="psatBase64" @focus="selectAll"></textarea>

            <ShareLinks
                :text="shareMessage"
                :copy-text="psatBase64"
                :subject="shareSubject"
            ></ShareLinks>

            <div class="result_actions">
                <v-btn
                    depressed
                    class="button_primary"
                    :loading="isBroadcasting"
                    :disabled="isBroadcasting || broadcastId !== ''"
                    @click="broadcast"
                >
                    Broadcast now
                </v-btn>
                <v-btn text small style="color: var(--primary-color)" @click="startAgain">
                    Start over
                </v-btn>
            </div>
            <p v-if="broadcastId" class="broadcast_ok">
                Broadcast — transaction id
                <span class="mono">{{ broadcastId }}</span>
            </p>
            <p class="err" v-if="err">{{ err }}</p>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { v1 as uuidv1 } from 'uuid'
import Big from 'big.js'

import { BN, Buffer } from '@/avalanche'
import { ava, avm } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import { useAssetsStore, useMainStore, useNotificationsStore } from '@/stores'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { WalletHelper } from '@/helpers/wallet_helper'
import { issueX } from '@/helpers/issueTx'
import { encodePsat, parseXAddress } from '@/js/multisig/psat'
import CurrencyInputDropdown from '@/components/misc/CurrencyInputDropdown.vue'
import ShareLinks from '@/components/misc/ShareLinks.vue'
import type { ICurrencyInputDropdownValue } from '@/components/wallet/transfer/types'
import type AvaAsset from '@/js/AvaAsset'
import type { Wallet } from '@/js/wallets/AbstractWallet'
import type { Tx as AVMTx } from '@/avalanche/apis/avm'

interface OwnerRow {
    uuid: string
    address: string
}

const newOwner = (address = ''): OwnerRow => ({ uuid: uuidv1(), address })

export default defineComponent({
    name: 'MultisigFormX',
    components: { CurrencyInputDropdown, ShareLinks },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notifications = useNotificationsStore()

        const wallet = computed((): Wallet | null => mainStore.activeWallet as Wallet | null)

        // Owner #1 defaults to this wallet's own address — a multisig the
        // creator is not part of is almost always a mistake, and it is still
        // editable if that is genuinely what they want.
        const owners = ref<OwnerRow[]>([newOwner(wallet.value?.getCurrentAddressAvm() ?? '')])
        const threshold = ref(1)
        const amount = ref(new BN(0))
        const asset = ref<AvaAsset | null>(null)
        const memo = ref('')

        const isConfirm = ref(false)
        const acknowledged = ref(false)
        const isSending = ref(false)
        const isBroadcasting = ref(false)
        const err = ref('')
        const formErrors = ref<string[]>([])

        const signedTx = ref<AVMTx | null>(null)
        const psatBase64 = ref('')
        const broadcastId = ref('')

        const txFee = computed((): Big => bnToBig(avm.getTxFee(), 9))

        const amountDisplay = computed((): string => {
            if (!asset.value || amount.value.lte(new BN(0))) return '—'
            return `${bnToBig(amount.value, asset.value.denomination).toString()} ${
                asset.value.symbol
            }`
        })

        const canConfirm = computed((): boolean => {
            if (!wallet.value) return false
            if (!asset.value || amount.value.lte(new BN(0))) return false
            return owners.value.every((o) => o.address.trim().length > 0)
        })

        const addOwner = () => {
            owners.value.push(newOwner())
        }

        const removeOwner = (index: number) => {
            owners.value.splice(index, 1)
            // Keeping the threshold above the owner count would build an
            // output nobody can ever satisfy.
            if (threshold.value > owners.value.length) threshold.value = owners.value.length
        }

        const onAmountChange = (event: ICurrencyInputDropdownValue) => {
            if (!event) return
            asset.value = event.asset
            amount.value = event.amount
        }

        const formCheck = (): boolean => {
            const errs: string[] = []
            const seen = new Set<string>()

            owners.value.forEach((o, i) => {
                const addr = o.address.trim()
                if (!parseXAddress(addr)) {
                    errs.push(`Owner #${i + 1}: not a valid X-chain address for this network.`)
                    return
                }
                if (seen.has(addr)) {
                    errs.push(`Owner #${i + 1}: this address is already listed.`)
                }
                seen.add(addr)
            })

            if (
                !Number.isInteger(threshold.value) ||
                threshold.value < 1 ||
                threshold.value > owners.value.length
            ) {
                errs.push(
                    `Signatures required must be a whole number between 1 and ${owners.value.length}.`
                )
            }

            if (memo.value && Buffer.from(memo.value).length > 256) {
                errs.push('Memo must be 256 bytes or fewer.')
            }

            formErrors.value = errs
            return errs.length === 0
        }

        const confirm = () => {
            err.value = ''
            if (!formCheck()) return
            acknowledged.value = false
            isConfirm.value = true
        }

        const cancelConfirm = () => {
            isConfirm.value = false
            acknowledged.value = false
            err.value = ''
        }

        const submit = async () => {
            const w = wallet.value
            if (!w || !acknowledged.value || !asset.value) return
            isSending.value = true
            err.value = ''
            try {
                const memoBuf = memo.value ? Buffer.from(memo.value) : undefined
                const { tx, sourceUtxos } = await authorizeSingle(
                    w,
                    `Create a ${threshold.value}-of-${owners.value.length} multisig output`,
                    () =>
                        WalletHelper.buildMultisigSend(
                            w,
                            {
                                owners: owners.value.map((o) => o.address.trim()),
                                threshold: threshold.value,
                                asset: { id: (asset.value as AvaAsset).id },
                                amount: amount.value,
                            },
                            memoBuf
                        )
                )
                signedTx.value = tx
                psatBase64.value = encodePsat(tx, sourceUtxos)
            } catch (e: any) {
                if (e instanceof SessionAuthCancelled) return
                err.value = e?.message ?? String(e)
            } finally {
                isSending.value = false
            }
        }

        const broadcast = async () => {
            if (!signedTx.value) return
            isBroadcasting.value = true
            err.value = ''
            try {
                broadcastId.value = await issueX(signedTx.value)
                notifications.add({
                    title: 'Multisig output created',
                    message: 'The transaction was broadcast to the network.',
                    type: 'success',
                })
                assetsStore.updateUTXOs()
            } catch (e: any) {
                err.value = e?.message ?? String(e)
            } finally {
                isBroadcasting.value = false
            }
        }

        const psatUrl = computed((): string => {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            return `${origin}/wallet/psat`
        })

        const shareSubject = computed(
            () =>
                `Partially signed Avalanche transaction (${threshold.value}-of-${owners.value.length} multisig)`
        )

        const shareMessage = computed(
            () =>
                'You are receiving a serialized PSAT partially signed avalanche ' +
                `transaction from AVXTO Wallet, open it on ${psatUrl.value} to sign and either pass it ` +
                'forward to another signer or broadcast it to the network\n\n' +
                psatBase64.value
        )

        const selectAll = (e: FocusEvent) => {
            const target = e.target as HTMLTextAreaElement
            target.select()
        }

        const startAgain = () => {
            owners.value = [newOwner(wallet.value?.getCurrentAddressAvm() ?? '')]
            threshold.value = 1
            amount.value = new BN(0)
            asset.value = null
            memo.value = ''
            isConfirm.value = false
            acknowledged.value = false
            signedTx.value = null
            psatBase64.value = ''
            broadcastId.value = ''
            err.value = ''
            formErrors.value = []
        }

        return {
            owners,
            threshold,
            memo,
            isConfirm,
            acknowledged,
            isSending,
            isBroadcasting,
            err,
            formErrors,
            signedTx,
            psatBase64,
            broadcastId,
            txFee,
            amountDisplay,
            canConfirm,
            shareMessage,
            shareSubject,
            addOwner,
            removeOwner,
            onAmountChange,
            confirm,
            cancelConfirm,
            submit,
            broadcast,
            selectAll,
            startAgain,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

h4 {
    font-size: 12px;
    font-weight: bold;
    margin: 0;
}

.intro {
    margin-bottom: 16px;

    p {
        margin-top: 6px;
        font-size: 13px;
        color: var(--primary-color-light);
        line-height: 1.5;
    }
}

.owner_row {
    margin-bottom: 12px;
}

.owner_head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
}

.you_tag {
    display: inline-block;
    margin-left: 6px;
    font-size: 10px;
    font-weight: normal;
    text-transform: uppercase;
    color: var(--primary-color-light);
    background: var(--bg);
    border-radius: 4px;
    padding: 1px 6px;
}

.remove_but {
    color: var(--primary-color-light);
    font-size: 12px;

    &:hover {
        color: var(--error);
    }
}

.owner_input,
.threshold_row input,
.memo {
    width: 100%;
    background-color: var(--bg-light);
    padding: 8px 12px;
    border-radius: 6px;
    color: var(--primary-color);
    font-size: 14px;
}

.owner_input {
    font-family: monospace;
    font-size: 13px;
}

.add_owner {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--secondary-color);
    margin-bottom: 16px;

    &:disabled {
        opacity: 0.4;
    }
}

.threshold_row,
.amount_row,
.memo_cont {
    margin-bottom: 16px;

    label {
        display: block;
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color-light);
        margin-bottom: 4px;

        small {
            display: block;
            font-weight: normal;
        }
    }
}

.threshold_row input {
    max-width: 120px;
}

.memo {
    min-height: 54px;
    resize: vertical;
    font-family: inherit;
}

.fees {
    border-top: 1px solid var(--bg-light);
    padding-top: 12px;
    margin-bottom: 12px;

    p {
        display: flex;
        justify-content: space-between;
        font-size: 13px;
        color: var(--primary-color-light);
    }
}

.confirm_panel {
    background: var(--bg-light);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 12px;
}

.confirm_intro {
    font-size: 13px;
    color: var(--primary-color);
    margin: 8px 0 12px;
}

.confirm_owners {
    margin: 0 0 12px 18px;

    li {
        font-size: 12px;
        margin-bottom: 6px;
        word-break: break-all;
    }
}

.mono {
    font-family: monospace;
}

.warn_box {
    display: flex;
    gap: 10px;
    background: var(--bg);
    border-left: 3px solid var(--warning);
    border-radius: 4px;
    padding: 12px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--primary-color);

    > svg {
        color: var(--warning);
        flex-shrink: 0;
        margin-top: 2px;
    }
}

.ack_row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--primary-color);
    cursor: pointer;

    input {
        margin-top: 2px;
        flex-shrink: 0;
    }
}

.err_list {
    margin: 12px 0 0 18px;

    li {
        color: var(--error);
        font-size: 12px;
        margin-bottom: 4px;
    }
}

.err {
    margin-top: 10px;
    color: var(--error);
    font-size: 13px;
}

.actions {
    margin-top: 14px;
}

.result_panel {
    h4 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: var(--success);
    }
}

.result_intro {
    margin: 8px 0 14px;
    font-size: 13px;
    color: var(--primary-color-light);
    line-height: 1.55;
}

.result_summary {
    background: var(--bg-light);
    border-radius: 8px;
    padding: 12px;
    margin-bottom: 14px;
}

.summary_line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    font-size: 13px;
    padding: 3px 0;

    span:first-child {
        color: var(--primary-color-light);
    }
    span:last-child {
        color: var(--primary-color);
    }
}

.result_label {
    display: block;
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin-bottom: 4px;
}

.psat_out {
    width: 100%;
    min-height: 110px;
    resize: vertical;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 10px;
    color: var(--primary-color);
    font-family: monospace;
    font-size: 11px;
    word-break: break-all;
}

.result_actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    flex-wrap: wrap;
}

.broadcast_ok {
    margin-top: 10px;
    font-size: 12px;
    color: var(--success);
    word-break: break-all;
}
</style>
