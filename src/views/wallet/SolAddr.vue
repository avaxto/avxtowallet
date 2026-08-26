<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Decodes a Solana address to its raw ed25519 public key bytes.

  A Solana address IS a base58 encoding of a raw 32-byte public key, so this
  is a plain decode rather than a derivation. It deliberately produces nothing
  address-shaped for any other chain — an earlier version of this page also
  ran the decoded bytes through keccak256-and-truncate to show something that
  LOOKED like an EVM address, which was removed: ed25519 and secp256k1 are
  unrelated curves, so that value was never a real, signable EVM address, and
  showing it invited exactly the "is this a destination?" confusion this
  wallet is otherwise careful to guard against.
-->
<template>
    <div class="soladdr_page">
        <div class="head">
            <h1>Decode Solana Address</h1>
            <p class="desc">
                A Solana address is base58 of a raw 32-byte ed25519 public key — paste one to
                see the decoded bytes.
            </p>
        </div>

        <div class="input_wrap">
            <input
                v-model="input"
                class="addr_input"
                spellcheck="false"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="none"
                placeholder="Paste a Solana address"
            />
        </div>

        <p v-if="err" class="error">{{ err }}</p>

        <div v-else-if="result" class="results">
            <div class="row">
                <span class="label">Public key</span>
                <span class="value mono">{{ result.publicKeyHex }}</span>
                <CopyText :value="result.publicKeyHex" class="copy_btn" />
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import { decodeSolanaPublicKey, type SolanaPublicKeyDecode } from '@/solana/decodePublicKey'

export default defineComponent({
    name: 'SolAddr',
    components: { CopyText },
    setup() {
        const input = ref('')

        const decoded = computed((): { result: SolanaPublicKeyDecode | null; err: string } => {
            const raw = input.value.trim()
            if (!raw) return { result: null, err: '' }
            try {
                return { result: decodeSolanaPublicKey(raw), err: '' }
            } catch (e) {
                return { result: null, err: e instanceof Error ? e.message : String(e) }
            }
        })

        const result = computed(() => decoded.value.result)
        const err = computed(() => decoded.value.err)

        return { input, result, err }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.soladdr_page {
    max-width: 720px;
    margin: 0 auto;
}

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
    text-align: center;
}

.mono {
    font-family: monospace;
}

.input_wrap {
    display: flex;
    justify-content: center;
    margin-bottom: 16px;
}

.addr_input {
    width: 100%;
    max-width: 520px;
    padding: 12px 16px;
    font-family: monospace;
    font-size: 1.05em;
    text-align: center;
    border: 1px solid var(--bg);
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 6px;
    outline: none;

    &:focus {
        border-color: var(--primary-color);
    }
}

.error {
    text-align: center;
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.9em;
}

.results {
    background-color: var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
}

.row {
    display: grid;
    grid-template-columns: 100px 1fr 28px;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    font-size: 0.85em;

    .label {
        color: var(--primary-color-light);
    }

    .value {
        word-break: break-all;
        color: var(--primary-color);
    }
}

.copy_btn {
    justify-self: center;
}

@include main.mobile-device {
    .addr_input {
        font-size: 0.9em;
    }

    .row {
        grid-template-columns: 1fr;
        gap: 4px;

        .copy_btn {
            justify-self: start;
        }
    }
}
</style>
