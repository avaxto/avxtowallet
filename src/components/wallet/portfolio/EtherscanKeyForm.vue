<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <form class="etherscan_key_form" @submit.prevent="save">
        <p class="hint">
            One free Etherscan key covers every etherscan-family network in the
            registry (currently {{ affectedNetworks }}). Get one at
            <a href="https://etherscan.io/apis" target="_blank" rel="noopener noreferrer">
                etherscan.io/apis
            </a>.
        </p>
        <input
            v-model.trim="key"
            type="text"
            placeholder="Etherscan API key"
            class="single_line_input"
            autocomplete="off"
            spellcheck="false"
        />
        <p v-if="error" class="err">{{ error }}</p>
        <div class="but_row">
            <button type="button" class="tab_cancel" @click="$emit('close')">Cancel</button>
            <button
                v-if="hadKey"
                type="button"
                class="button_secondary clear_but"
                @click="clear"
            >
                Clear key
            </button>
            <button type="submit" class="button_secondary" :disabled="!key">Save</button>
        </div>
    </form>
</template>

<script lang="ts">
/**
 * Inline form for the shared Etherscan V2 API key.
 *
 * Etherscan-family networks (see `evm/explorers/apiKey.ts`) are skipped during
 * discovery until this is set — there was previously no UI for a user to ever
 * set it, so those networks could never succeed. Deliberately inline rather
 * than a modal: it is surfaced right where the degraded-network banner names
 * the networks it would unblock, so the fix sits next to the problem.
 */
import { defineComponent, ref } from 'vue'
import {
    getEtherscanApiKey,
    setEtherscanApiKey,
} from '@/evm/explorers/apiKey'

export default defineComponent({
    name: 'EtherscanKeyForm',
    props: {
        /** Names of the networks this key would unblock, for the hint text. */
        affectedNetworks: { type: String, default: 'BNB Chain' },
    },
    emits: ['saved', 'close'],
    setup(props, { emit }) {
        const key = ref(getEtherscanApiKey() ?? '')
        const hadKey = ref(getEtherscanApiKey() !== null)
        const error = ref('')

        const save = () => {
            if (!key.value) return
            setEtherscanApiKey(key.value)
            error.value = ''
            emit('saved')
        }

        const clear = () => {
            setEtherscanApiKey(null)
            key.value = ''
            hadKey.value = false
            emit('saved')
        }

        return { key, hadKey, error, save, clear }
    },
})
</script>

<style scoped lang="scss">
@use '../../../main';

.etherscan_key_form {
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px solid var(--bg-light);
    border-radius: 6px;
}

.hint {
    font-size: 12px;
    color: var(--primary-color-light);
    margin-bottom: 8px;

    a {
        color: var(--secondary-color);
    }
}

.single_line_input {
    width: 100%;
    box-sizing: border-box;
}

.err {
    color: var(--error, #f00);
    font-size: 12px;
    margin-top: 6px;
}

.but_row {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 10px;

    button {
        font-size: 12px;
        padding: 4px 12px;
        border-radius: 4px;
    }
}

.tab_cancel {
    color: var(--primary-color-light);
}

.clear_but {
    opacity: 0.8;
}
</style>
