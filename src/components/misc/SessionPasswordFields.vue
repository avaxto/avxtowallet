<template>
    <div class="session_pw_fields">
        <h4>Session password</h4>
        <p class="desc">
            Encrypts your keys while the wallet is open and authorizes each
            transaction. It is never stored — you will be asked for it again
            every time you sign, and it cannot be recovered if forgotten.
        </p>
        <input
            type="password"
            ref="pw_in"
            :value="modelValue"
            @input="onPassword"
            placeholder="Choose a session password"
            autocomplete="new-password"
        />
        <input
            type="password"
            ref="pw_confirm_in"
            v-model="confirmValue"
            placeholder="Confirm session password"
            autocomplete="new-password"
        />
        <p class="err" v-if="showError && error">{{ error }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, onBeforeUnmount } from 'vue'

export default defineComponent({
    name: 'SessionPasswordFields',
    props: {
        modelValue: { type: String, default: '' },
        /** Suppress the message until the user has actually tried to submit. */
        showError: { type: Boolean, default: false },
    },
    emits: ['update:modelValue', 'validity'],
    setup(props, { emit }) {
        const confirmValue = ref('')
        const pw_in = ref<HTMLInputElement | null>(null)
        const pw_confirm_in = ref<HTMLInputElement | null>(null)

        // No length or format restriction — the session password is never
        // stored, so there's no offline-crackable artifact to defend; the
        // only real requirement is that the two fields agree.
        const error = computed((): string => {
            if (props.modelValue !== confirmValue.value) {
                return 'Session passwords do not match.'
            }
            return ''
        })

        watch(error, (e) => emit('validity', e === ''), { immediate: true })

        const onPassword = (e: Event) => {
            emit('update:modelValue', (e.target as HTMLInputElement).value)
        }

        /** Clears both the refs and the DOM nodes, which retain their own copy. */
        const clear = () => {
            confirmValue.value = ''
            if (pw_in.value) pw_in.value.value = ''
            if (pw_confirm_in.value) pw_confirm_in.value.value = ''
            emit('update:modelValue', '')
        }

        onBeforeUnmount(clear)

        return { confirmValue, pw_in, pw_confirm_in, error, onPassword, clear }
    },
})
</script>

<style scoped lang="scss">
.session_pw_fields {
    margin-top: 18px;
    text-align: left;
}

h4 {
    font-size: 13px;
    font-weight: bold;
    margin-bottom: 4px;
}

.desc {
    font-size: 12px;
    color: var(--primary-color-light);
    margin-bottom: 10px;
}

input {
    display: block;
    width: 100%;
    margin-bottom: 8px;
}

.err {
    font-size: 12px;
    color: var(--error);
}
</style>
