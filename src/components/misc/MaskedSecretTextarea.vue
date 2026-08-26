<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  A multi-line secret input — a recovery phrase or private key that doesn't
  fit a single `<input type="password">` the way a session password does.

  HTML has no masked textarea: `type="password"` is an `<input>`-only
  attribute, so the phrase/key access views were rendering their secret in
  plain, readable text. This masks it with `-webkit-text-security`, the same
  technique password managers use for exactly this gap, plus a reveal toggle
  so the user can still check what they typed before submitting.

  Known limitation: `-webkit-text-security` is a WebKit/Blink-only property
  (Chrome, Edge, Safari, Opera) — Firefox has no equivalent and simply shows
  the plain text regardless of `revealed`. There is no pure-CSS fix for that;
  a real fallback would mean rendering a fake masked overlay synced to the
  real textarea's line-wrapping and cursor position, which is a lot of
  fragile complexity for what is already a secondary browser here (the
  project's own README steers users toward Chrome). Masking on the browsers
  that support it is strictly better than the previous always-plaintext
  behaviour, and does not regress Firefox versus before.
-->
<template>
    <div class="masked_wrap">
        <textarea
            ref="el"
            :value="modelValue"
            @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
            class="secret_in"
            :class="{ masked: !revealed }"
            :rows="rows"
            :placeholder="placeholder"
            :disabled="disabled"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="none"
            spellcheck="false"
        ></textarea>
        <button
            type="button"
            class="reveal_btn"
            :aria-label="revealed ? 'Hide' : 'Show'"
            :title="revealed ? 'Hide' : 'Show'"
            @click="revealed = !revealed"
        >
            <fa :icon="revealed ? 'eye-slash' : 'eye'"></fa>
        </button>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue'

export default defineComponent({
    name: 'MaskedSecretTextarea',
    props: {
        modelValue: { type: String, default: '' },
        rows: { type: Number, default: 3 },
        placeholder: { type: String, default: '' },
        disabled: { type: Boolean, default: false },
    },
    emits: ['update:modelValue'],
    setup() {
        // Masked by default — this is the whole point of the component.
        const revealed = ref(false)
        const el = ref<HTMLTextAreaElement | null>(null)

        /** Also clears the DOM node's own value — see the note on the same
         *  pattern in SessionPasswordFields.vue: the element retains a copy
         *  independent of the v-model binding. */
        const clear = () => {
            if (el.value) el.value.value = ''
        }

        return { revealed, el, clear }
    },
})
</script>

<style scoped lang="scss">
.masked_wrap {
    position: relative;
    width: 100%;
}

.secret_in {
    width: 100%;
    background-color: var(--bg);
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 12px 40px 12px 12px;
    font-family: monospace;
    font-size: 14px;
    color: var(--primary-color);
    resize: vertical;
    outline: none;
    word-break: break-word;

    &:focus {
        border-color: var(--secondary-color);
    }

    &.masked {
        -webkit-text-security: disc;
    }
}

.reveal_btn {
    position: absolute;
    top: 10px;
    right: 10px;
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    color: var(--primary-color-light);

    &:hover {
        color: var(--primary-color);
    }
}
</style>
