<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Spends an existing multisig X-chain UTXO — the counterpart to
  MultisigFormX.vue, which only ever creates one.

  This builds the transaction and this wallet's own signature, then hands
  off into Psat.vue's existing review/sign/share/broadcast flow rather than
  re-implementing it: the result is (structurally, always) still short of
  its threshold, so it needs exactly the same "share with the next signer"
  step every other co-signer will also go through when they receive it. See
  js/multisig/spend.ts for why the transaction itself can't be built any
  other way.
-->
<template>
    <div class="multisig_spend_form">
        <div class="intro">
            <h4>Spend a multisig balance</h4>
            <p>
                Pick which multisig-locked balance to spend from, choose which owners will sign
                this specific transaction, and this wallet adds its own signature. The result
                still needs the others' signatures before it can broadcast.
            </p>
        </div>

        <div v-if="!groups.length" class="empty_state">
            No multisig balances found in this wallet.
        </div>

        <template v-else>
            <div class="groups">
                <button
                    v-for="g in groups"
                    :key="g.key"
                    type="button"
                    class="group_card"
                    :active="selectedKey === g.key"
                    @click="selectGroup(g)"
                >
                    <div class="group_head">
                        <span class="group_amount">{{ amountText(g) }} AVAX</span>
                        <span class="tag multisig">{{ g.threshold }}-of-{{ g.owners.length }}</span>
                    </div>
                    <ol class="group_owners">
                        <li v-for="o in g.owners" :key="o" class="mono">
                            {{ o }}
                            <span v-if="isMine(o)" class="you_tag">you</span>
                        </li>
                    </ol>
                </button>
            </div>

            <template v-if="selectedGroup">
                <div class="signers">
                    <label>
                        Signers for this transaction
                        <small>
                            Choose exactly {{ selectedGroup.threshold }} — this transaction can
                            only ever be signed by whoever is picked here, even if others could
                            sign a different one later.
                        </small>
                    </label>
                    <label v-for="o in selectedGroup.owners" :key="o" class="signer_row">
                        <input
                            type="checkbox"
                            :checked="selectedSigners.includes(o)"
                            :disabled="isMine(o) || !canToggleSigner(o)"
                            @change="toggleSigner(o)"
                        />
                        <span class="mono">{{ o }}</span>
                        <span v-if="isMine(o)" class="you_tag">you</span>
                    </label>
                </div>

                <div class="to_address">
                    <label>To address</label>
                    <input
                        v-model="toAddress"
                        type="text"
                        class="addr_input"
                        placeholder="X-avax1…"
                        autocomplete="off"
                        spellcheck="false"
                        :disabled="isSending"
                    />
                </div>

                <div class="amount_row">
                    <label>Amount</label>
                    <BigNumInput
                        ref="bigIn"
                        :max="maxAmount"
                        :denomination="denomination"
                        :step="stepSize"
                        placeholder="0.00"
                        class="bigIn"
                        :disabled="isSending"
                        @update:modelValue="onAmountChange"
                    ></BigNumInput>
                    <button
                        type="button"
                        class="max_but"
                        :disabled="isSending"
                        @click="bigIn?.maxout?.()"
                    >
                        MAX
                    </button>
                </div>

                <div class="memo_cont">
                    <label>Memo (optional)</label>
                    <textarea
                        class="memo"
                        maxlength="256"
                        placeholder="Memo"
                        autocomplete="off"
                        v-model="memo"
                        :disabled="isSending"
                    ></textarea>
                </div>

                <div class="fees">
                    <p>
                        Transaction fee
                        <span>{{ txFee.toLocaleString(9) }} AVAX</span>
                    </p>
                </div>

                <ul class="err_list" v-if="formErrors.length">
                    <li v-for="e in formErrors" :key="e">{{ e }}</li>
                </ul>
                <p class="err" v-if="err">{{ err }}</p>

                <v-btn
                    depressed
                    block
                    class="button_primary"
                    :disabled="!canSubmit"
                    :loading="isSending"
                    @click="submit"
                >
                    Sign and continue
                </v-btn>
            </template>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useRouter } from 'vue-router'

import { BN, Buffer } from '@/avalanche'
import { avm } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import { useAssetsStore, useMainStore } from '@/stores'
import {
    listHeldMultisigUtxos,
    buildMultisigSpend,
    type MultisigUtxoGroup,
} from '@/js/multisig/spend'
import { encodeUnsignedPsat } from '@/js/multisig/psat'
import { BigNumInput } from '@/vue_components'
import type { Wallet } from '@/js/wallets/AbstractWallet'

export default defineComponent({
    name: 'MultisigSpendFormX',
    components: { BigNumInput },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const router = useRouter()

        const bigIn = ref<InstanceType<typeof BigNumInput>>()

        const wallet = computed((): Wallet | null => mainStore.activeWallet as Wallet | null)
        const ownedAddresses = computed((): string[] => {
            try {
                return wallet.value?.getAllAddressesX() ?? []
            } catch {
                return []
            }
        })
        const isMine = (addr: string): boolean => ownedAddresses.value.includes(addr)

        const groups = computed((): MultisigUtxoGroup[] =>
            listHeldMultisigUtxos(assetsStore.walletAvmUtxoSet)
        )

        const selectedKey = ref('')
        const selectedGroup = computed(
            (): MultisigUtxoGroup | null => groups.value.find((g) => g.key === selectedKey.value) ?? null
        )

        // Every owner this wallet holds a key for is included and locked —
        // one of them has to sign for this wallet to be able to build
        // anything at all.
        const selectedSigners = ref<string[]>([])

        const selectGroup = (g: MultisigUtxoGroup): void => {
            selectedKey.value = g.key
            // Capped at threshold: if this wallet happens to hold more of
            // the group's owner addresses than are actually needed, only
            // pre-lock as many as the transaction requires — the rest stay
            // toggleable like any other owner.
            selectedSigners.value = g.owners.filter((o) => isMine(o)).slice(0, g.threshold)
            toAddress.value = ''
            memo.value = ''
            amount.value = new BN(0)
            err.value = ''
            formErrors.value = []
            bigIn.value?.clear?.()
        }

        const canToggleSigner = (addr: string): boolean => {
            if (!selectedGroup.value) return false
            if (selectedSigners.value.includes(addr)) return true
            return selectedSigners.value.length < selectedGroup.value.threshold
        }

        const toggleSigner = (addr: string): void => {
            if (isMine(addr)) return // always on, never editable
            const idx = selectedSigners.value.indexOf(addr)
            if (idx !== -1) {
                selectedSigners.value.splice(idx, 1)
                return
            }
            if (!canToggleSigner(addr)) return
            selectedSigners.value.push(addr)
        }

        const toAddress = ref('')
        const amount = ref(new BN(0))
        const memo = ref('')
        const err = ref('')
        const formErrors = ref<string[]>([])
        const isSending = ref(false)

        const denomination = computed((): number => assetsStore.AssetAVA?.denomination ?? 9)

        const stepSize = computed((): BN => {
            const d = denomination.value
            return d > 3 ? new BN(10).pow(new BN(d - 2)) : new BN(10).pow(new BN(d))
        })

        const txFee = computed(() => bnToBig(avm.getTxFee(), 9))

        const maxAmount = computed((): BN => {
            if (!selectedGroup.value) return new BN(0)
            const remaining = selectedGroup.value.totalAmount.sub(avm.getTxFee())
            return remaining.gt(new BN(0)) ? remaining : new BN(0)
        })

        const amountText = (g: MultisigUtxoGroup): string => bnToBig(g.totalAmount, 9).toString()

        const onAmountChange = (val: BN) => {
            if (!val || val instanceof Event) return
            amount.value = val
        }

        const canSubmit = computed((): boolean => {
            if (!selectedGroup.value) return false
            if (!wallet.value) return false
            if (!toAddress.value.trim()) return false
            if (amount.value.lte(new BN(0))) return false
            return selectedSigners.value.length === selectedGroup.value.threshold
        })

        const formCheck = (): boolean => {
            const errs: string[] = []
            if (memo.value && Buffer.from(memo.value).length > 256) {
                errs.push('Memo must be 256 bytes or fewer.')
            }
            formErrors.value = errs
            return errs.length === 0
        }

        const submit = async () => {
            const g = selectedGroup.value
            if (!g || !canSubmit.value) return
            err.value = ''
            if (!formCheck()) return

            isSending.value = true
            try {
                const memoBuf = memo.value ? Buffer.from(memo.value) : undefined
                const { unsignedTx, sourceUtxos } = await buildMultisigSpend(
                    g,
                    toAddress.value.trim(),
                    amount.value,
                    selectedSigners.value,
                    memoBuf
                )
                const psat = encodeUnsignedPsat(unsignedTx, sourceUtxos)
                // Psat.vue does the actual signing (this wallet's own slot)
                // and the share/broadcast steps that follow — see this
                // file's top comment for why that isn't duplicated here.
                router.push({ path: '/wallet/psat', query: { tx: psat } })
            } catch (e: any) {
                err.value = e?.message ?? String(e)
            } finally {
                isSending.value = false
            }
        }

        return {
            bigIn,
            groups,
            selectedKey,
            selectedGroup,
            selectedSigners,
            selectGroup,
            canToggleSigner,
            toggleSigner,
            isMine,
            toAddress,
            memo,
            err,
            formErrors,
            isSending,
            denomination,
            stepSize,
            txFee,
            maxAmount,
            amountText,
            onAmountChange,
            canSubmit,
            submit,
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

.empty_state {
    font-size: 13px;
    color: var(--primary-color-light);
    padding: 16px 0;
}

.groups {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
}

.group_card {
    text-align: left;
    background-color: var(--bg-light);
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 10px 14px;
    cursor: pointer;

    &:hover {
        border-color: var(--primary-color-light);
    }

    &[active='true'] {
        border-color: var(--secondary-color);
    }
}

.group_head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
}

.group_amount {
    font-family: monospace;
    font-size: 14px;
    color: var(--primary-color);
}

.tag {
    font-size: 10px;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 4px;

    &.multisig {
        color: var(--secondary-color);
        border: 1px solid var(--secondary-color);
    }
}

.group_owners {
    margin: 0 0 0 16px;

    li {
        font-size: 11px;
        color: var(--primary-color-light);
        word-break: break-all;
        margin-bottom: 2px;
    }
}

.mono {
    font-family: monospace;
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

.signers {
    margin-bottom: 16px;

    label:first-child {
        display: block;
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color-light);
        margin-bottom: 8px;

        small {
            display: block;
            font-weight: normal;
            margin-top: 2px;
        }
    }
}

.signer_row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin-bottom: 6px;
    cursor: pointer;

    input:disabled {
        opacity: 0.5;
    }
}

.to_address,
.amount_row,
.memo_cont {
    margin-bottom: 16px;

    > label {
        display: block;
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color-light);
        margin-bottom: 4px;
    }
}

.addr_input,
.memo {
    width: 100%;
    background-color: var(--bg-light);
    padding: 8px 12px;
    border-radius: 6px;
    color: var(--primary-color);
    font-size: 14px;
    font-family: monospace;
}

.memo {
    min-height: 54px;
    resize: vertical;
    font-family: inherit;
}

.amount_row {
    display: grid;
    grid-template-columns: 1fr max-content;
    align-items: center;
    column-gap: 10px;
}

.bigIn {
    grid-column: 1 / 2;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 8px 12px;
    color: var(--primary-color);
}

.max_but {
    font-size: 12px;
    color: var(--secondary-color);
    opacity: 0.8;

    &:hover {
        opacity: 1;
    }
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

.err_list {
    margin: 0 0 12px 18px;

    li {
        color: var(--error);
        font-size: 12px;
        margin-bottom: 4px;
    }
}

.err {
    margin-bottom: 10px;
    color: var(--error);
    font-size: 13px;
}
</style>
