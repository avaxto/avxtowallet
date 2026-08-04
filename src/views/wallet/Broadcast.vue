<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="broadcast_page">
        <div class="head">
            <h1>Broadcast Transaction</h1>
            <p class="desc">
                Paste an already-signed transaction and submit it to the network.
                Signing happens elsewhere — this page only relays the bytes, so it
                never touches your keys and never asks for your session password.
            </p>
        </div>

        <div class="field">
            <label>Transaction type</label>
            <div class="chain_picker">
                <button
                    v-for="m in modes"
                    :key="m.id"
                    class="chain_opt"
                    :class="{ active: mode === m.id }"
                    :disabled="isSending"
                    @click="mode = m.id"
                >
                    {{ m.label }}
                </button>
            </div>
            <p class="hint">
                {{ activeMode.hint }}
            </p>
        </div>

        <div class="field">
            <label>Signed transaction</label>
            <textarea
                v-model="rawInput"
                class="tx_input"
                spellcheck="false"
                autocomplete="off"
                rows="7"
                placeholder="Base64-encoded signed transaction"
                :disabled="isSending"
            ></textarea>
            <p class="hint">
                Base64 is expected. Hex (<code>0x…</code>) and cb58 are also accepted,
                since those are what some tools emit.
            </p>
        </div>

        <div v-if="decodeError" class="error">{{ decodeError }}</div>

        <div v-else-if="decoded" class="preview">
            <div class="row">
                <span class="k">Format detected</span>
                <span class="v">{{ decoded.format }}</span>
            </div>
            <div class="row">
                <span class="k">Size</span>
                <span class="v">{{ decoded.byteLength }} bytes</span>
            </div>
            <div class="row">
                <span class="k">Parses as</span>
                <span class="v" :class="decoded.parsed ? 'ok' : 'warn'">
                    {{ decoded.parsed ? `valid ${activeMode.label} transaction` : `NOT a valid ${activeMode.label} transaction` }}
                </span>
            </div>
            <p v-if="!decoded.parsed" class="parse_warn">
                {{ decoded.parseError }}
                <br />
                Check the transaction type above. Broadcasting anyway will almost
                certainly be rejected by the node.
            </p>
        </div>

        <v-btn
            class="button_primary submit"
            depressed
            block
            :loading="isSending"
            :disabled="!canSend || isSending"
            @click="submit"
        >
            Broadcast to {{ activeMode.label }}
        </v-btn>

        <div v-if="err" class="error result_err">{{ err }}</div>

        <div v-if="resultTxId" class="success">
            <p class="success_title">
                <fa icon="check-circle"></fa>
                Transaction broadcast
            </p>
            <div class="row">
                <span class="k">Transaction ID</span>
                <span class="v mono">{{ resultTxId }}</span>
            </div>
            <div class="actions">
                <CopyText :value="resultTxId" class="copy_btn"></CopyText>
                <a :href="explorerUrl" target="_blank" rel="noopener noreferrer" class="link">
                    View on explorer
                </a>
            </div>
            <v-btn class="button_secondary" small depressed @click="startAgain">
                Broadcast another
            </v-btn>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { Buffer as BufferAvalanche } from '@/avalanche'
import { bintools, avm, pChain, cChain, ava } from '@/AVA'
import { Tx as AVMTx } from '@/avalanche/apis/avm/tx'
import { Tx as PlatformTx } from '@/avalanche/apis/platformvm/tx'
import { Tx as EVMTx } from '@/avalanche/apis/evm/tx'
import { ChainIdType } from '@/constants'
import { getTxURL } from '@/js/Glacier/getTxURL'
import { isMainnetNetworkID } from '@/utils/network-utils'
import { useNotificationsStore } from '@/stores'
import CopyText from '@/components/misc/CopyText.vue'
import { Transaction } from '@ethereumjs/tx'
import { Buffer as NodeBuffer } from 'buffer'
import { web3 } from '@/evm'

type BroadcastModeId = 'X' | 'P' | 'C-atomic' | 'C-evm'

interface BroadcastMode {
    id: BroadcastModeId
    label: string
    hint: string
}

interface DecodedTx {
    bytes: BufferAvalanche
    /** Which encoding the input turned out to be. */
    format: string
    byteLength: number
    /** True if the bytes deserialize as a transaction for the selected chain. */
    parsed: boolean
    parseError: string
}

export default defineComponent({
    name: 'Broadcast',
    components: { CopyText },
    setup() {
        const notifications = useNotificationsStore()

        // Four modes, not three chains: a C-chain "send" produces an ethereumjs
        // transaction submitted via eth_sendRawTransaction, which is a different
        // family from the X/P/C atomic transactions that go through issueTx.
        const modes: BroadcastMode[] = [
            {
                id: 'X',
                label: 'X-Chain',
                hint: 'X-Chain transfers and atomic imports/exports.',
            },
            {
                id: 'P',
                label: 'P-Chain',
                hint: 'Staking (validate/delegate) and P-Chain atomic imports/exports.',
            },
            {
                id: 'C-atomic',
                label: 'C-Chain (atomic)',
                hint: 'Cross-chain imports/exports on the C-Chain — not ordinary C-Chain sends.',
            },
            {
                id: 'C-evm',
                label: 'C-Chain (EVM)',
                hint: 'Ordinary C-Chain activity: AVAX and token sends, swaps, contract calls and deploys.',
            },
        ]

        const mode = ref<BroadcastModeId>('X')
        const activeMode = computed(() => modes.find((m) => m.id === mode.value) as BroadcastMode)
        const rawInput = ref('')
        const isSending = ref(false)
        const err = ref('')
        const resultTxId = ref('')

        /**
         * Turns the pasted text into raw transaction bytes.
         *
         * Base64 is what this page asks for, but cb58 is what AvalancheJS's
         * Tx.toString() actually emits and hex is what several CLIs print, so
         * all three are accepted — the format is inferred from the alphabet
         * rather than guessed, and the result is validated by parsing below.
         */
        const decodeInput = (input: string): { bytes: BufferAvalanche; format: string } => {
            const text = input.trim().replace(/\s+/g, '')
            if (!text) throw new Error('Enter a signed transaction.')

            if (/^0x[0-9a-fA-F]+$/.test(text) || /^[0-9a-fA-F]{64,}$/.test(text)) {
                const hex = text.startsWith('0x') ? text.slice(2) : text
                if (hex.length % 2 !== 0) throw new Error('Hex input has an odd number of digits.')
                return {
                    bytes: BufferAvalanche.from(hex, 'hex'),
                    format: 'hex',
                }
            }

            // cb58 is base58 — its alphabet excludes 0, O, I and l, which is what
            // separates it from base64 here (base64 also uses +, / and =).
            if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
                try {
                    return { bytes: bintools.cb58Decode(text), format: 'cb58' }
                } catch (e) {
                    // Fall through — a base64 string can happen to contain only
                    // base58-safe characters.
                }
            }

            if (/^[A-Za-z0-9+/]+={0,2}$/.test(text)) {
                const bytes = BufferAvalanche.from(text, 'base64')
                if (bytes.length === 0) throw new Error('Base64 input decoded to zero bytes.')
                return { bytes, format: 'base64' }
            }

            throw new Error('Input is not valid base64, hex or cb58.')
        }

        /**
         * Deserializes the bytes with the selected chain's Tx class.
         *
         * This is the real validation: a transaction for the wrong chain, or
         * truncated/corrupt bytes, will throw here rather than being sent to a
         * node that would reject it.
         *
         * issueTx re-appends its own checksum, so a trailing checksum on the
         * input is stripped first — cb58 carries one, and some tools emit
         * checksummed hex.
         */
        const parseForMode = (
            bytes: BufferAvalanche,
            forMode: BroadcastModeId
        ): { bytes: BufferAvalanche; parsed: boolean; parseError: string } => {
            // EVM transactions are RLP, not the Avalanche codec — validate them
            // with ethereumjs instead.
            if (forMode === 'C-evm') {
                try {
                    const tx = Transaction.fromSerializedTx(
                        NodeBuffer.from(bytes) as unknown as globalThis.Buffer
                    )
                    if (!tx.isSigned()) {
                        return {
                            bytes,
                            parsed: false,
                            parseError: 'Transaction is not signed.',
                        }
                    }
                    return { bytes, parsed: true, parseError: '' }
                } catch (e) {
                    return {
                        bytes,
                        parsed: false,
                        parseError: e instanceof Error ? e.message : String(e),
                    }
                }
            }

            const candidates: BufferAvalanche[] = [bytes]
            if (bytes.length > 4 && bintools.validateChecksum(bytes)) {
                candidates.unshift(bytes.slice(0, bytes.length - 4) as BufferAvalanche)
            }

            let lastError = ''
            for (const candidate of candidates) {
                try {
                    const tx =
                        forMode === 'X'
                            ? new AVMTx()
                            : forMode === 'P'
                              ? new PlatformTx()
                              : new EVMTx()
                    tx.fromBuffer(candidate)

                    // Round-trip: fromBuffer tolerates trailing bytes, so compare
                    // the re-serialized form to catch input that only partly
                    // decoded.
                    if (!tx.toBuffer().equals(candidate)) {
                        lastError = 'Bytes did not round-trip — input may be truncated or padded.'
                        continue
                    }

                    return { bytes: candidate, parsed: true, parseError: '' }
                } catch (e) {
                    lastError = e instanceof Error ? e.message : String(e)
                }
            }

            return { bytes, parsed: false, parseError: lastError }
        }

        // Kept as one pure computed with a tagged result, rather than a computed
        // that assigns to a separate error ref — writing to a ref during a
        // computed's evaluation is a side effect Vue can warn about, and it
        // makes evaluation order matter.
        type DecodeResult =
            | { ok: true; value: DecodedTx }
            | { ok: false; error: string }

        const decodeResult = computed((): DecodeResult | null => {
            if (!rawInput.value.trim()) return null

            try {
                const raw = decodeInput(rawInput.value)
                const result = parseForMode(raw.bytes, mode.value)
                return {
                    ok: true,
                    value: {
                        bytes: result.bytes,
                        format: raw.format,
                        byteLength: result.bytes.length,
                        parsed: result.parsed,
                        parseError: result.parseError,
                    },
                }
            } catch (e) {
                return { ok: false, error: e instanceof Error ? e.message : String(e) }
            }
        })

        const decoded = computed((): DecodedTx | null => {
            const r = decodeResult.value
            return r && r.ok ? r.value : null
        })

        const decodeError = computed((): string => {
            const r = decodeResult.value
            return r && !r.ok ? r.error : ''
        })

        // A previous result shouldn't linger next to a newly edited input.
        watch([rawInput, mode], () => {
            resultTxId.value = ''
            err.value = ''
        })

        // decoded is non-null only on a successful decode, so this covers both.
        const canSend = computed(() => !!decoded.value)

        const explorerUrl = computed(() => {
            if (!resultTxId.value) return ''
            const chain: ChainIdType = mode.value === 'X' ? 'X' : mode.value === 'P' ? 'P' : 'C'
            return getTxURL(resultTxId.value, chain, isMainnetNetworkID(ava.getNetworkID()))
        })

        const submit = async () => {
            const tx = decoded.value
            if (!tx) return

            err.value = ''
            resultTxId.value = ''
            isSending.value = true

            try {
                if (mode.value === 'C-evm') {
                    // EVM transactions go to the C-chain RPC as raw RLP — no
                    // Avalanche checksum, different endpoint entirely.
                    const receipt = await web3.eth.sendSignedTransaction(
                        '0x' + tx.bytes.toString('hex')
                    )
                    resultTxId.value = receipt.transactionHash as string
                } else {
                    // Matches helpers/issueTx.ts: the node wants hex with a
                    // trailing checksum. No signing occurs here — the bytes are
                    // already signed.
                    const payload = '0x' + bintools.addChecksum(tx.bytes).toString('hex')
                    const api = mode.value === 'X' ? avm : mode.value === 'P' ? pChain : cChain
                    resultTxId.value = await api.issueTx(payload)
                }

                notifications.add({
                    type: 'success',
                    title: 'Transaction Broadcast',
                    message: resultTxId.value,
                })
            } catch (e: any) {
                err.value = e?.message ?? String(e)
                notifications.add({
                    type: 'error',
                    title: 'Broadcast Failed',
                    message: err.value,
                })
            } finally {
                isSending.value = false
            }
        }

        const startAgain = () => {
            rawInput.value = ''
            resultTxId.value = ''
            err.value = ''
        }

        return {
            modes,
            mode,
            activeMode,
            rawInput,
            isSending,
            err,
            resultTxId,
            decoded,
            decodeError,
            canSend,
            explorerUrl,
            submit,
            startAgain,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.broadcast_page {
    max-width: 720px;
    margin: 0 auto;
}

h1 {
    font-weight: normal;
}

.head {
    margin-bottom: 24px;
    text-align: center;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.field {
    margin-bottom: 20px;
}

label {
    display: block;
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin-bottom: 6px;
}

.hint {
    font-size: 0.8em;
    color: var(--primary-color-light);
    margin-top: 6px;

    code {
        font-family: monospace;
    }
}

.chain_picker {
    display: flex;
    gap: 8px;
}

.chain_opt {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--bg-light);
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 6px;
    font-size: 0.9em;

    &.active {
        border-color: var(--primary-color);
        font-weight: bold;
    }

    &:disabled {
        opacity: 0.5;
    }
}

.tx_input {
    width: 100%;
    padding: 12px 14px;
    font-family: monospace;
    font-size: 0.85em;
    border: 1px solid var(--bg);
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 6px;
    outline: none;
    resize: vertical;
    word-break: break-all;

    &:focus {
        border-color: var(--primary-color);
    }
}

.preview {
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 20px;
}

.row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 0;
    font-size: 0.85em;
}

.k {
    color: var(--primary-color-light);
    white-space: nowrap;
}

.v {
    text-align: right;
    word-break: break-all;

    &.ok {
        color: var(--success);
    }

    &.warn {
        color: var(--secondary-color);
    }
}

.mono {
    font-family: monospace;
}

.parse_warn {
    margin-top: 8px;
    font-size: 0.8em;
    color: var(--secondary-color);
}

.error {
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.85em;
    margin-bottom: 20px;
    word-break: break-word;
}

.result_err {
    margin-top: 16px;
    margin-bottom: 0;
}

.submit {
    margin-top: 4px;
}

.success {
    margin-top: 20px;
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 16px;
}

.success_title {
    color: var(--success);
    margin-bottom: 10px;
}

.actions {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 12px 0;
}

.link {
    font-size: 0.85em;
}

@include main.mobile-device {
    .chain_picker {
        flex-direction: column;
    }
}
</style>
