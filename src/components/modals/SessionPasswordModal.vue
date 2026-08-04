<template>
    <Modal ref="modal" title="Confirm with session password" @beforeClose="onCancel">
        <div class="session_pw_body">
            <p class="reason">{{ reason }}</p>

            <form @submit.prevent="submit">
                <label for="session_pw">Session password</label>
                <input
                    id="session_pw"
                    ref="input"
                    v-model="password"
                    type="password"
                    autocomplete="current-password"
                    :disabled="isDeriving"
                />

                <p class="err" v-if="errorText">{{ errorText }}</p>

                <div class="actions">
                    <v-btn
                        class="button_primary"
                        depressed
                        block
                        small
                        type="submit"
                        :loading="isDeriving"
                        :disabled="!password || isDeriving"
                    >
                        Authorize
                    </v-btn>
                    <v-btn
                        class="cancel_but"
                        text
                        block
                        small
                        :disabled="isDeriving"
                        @click="cancel"
                    >
                        Cancel
                    </v-btn>
                </div>
            </form>

            <p class="hint">
                Your session password is never stored. It is needed each time a
                transaction is signed.
            </p>
        </div>
    </Modal>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import Modal from '@/components/modals/Modal.vue'
import { usePromptState } from '@/js/security/passwordPrompt'

export default defineComponent({
    name: 'SessionPasswordModal',
    components: { Modal },
    setup() {
        const pending = usePromptState()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const input = ref<HTMLInputElement | null>(null)

        const password = ref('')
        const isDeriving = ref(false)

        const reason = computed(() => pending.value?.reason ?? '')
        const errorText = computed(() => pending.value?.errorText ?? '')

        const onKeydown = (e: KeyboardEvent) => {
            // Modal.vue has no Esc handling of its own.
            if (e.key === 'Escape' && !isDeriving.value) cancel()
        }

        watch(pending, (val) => {
            if (val) {
                password.value = ''
                isDeriving.value = false
                modal.value?.open()
                window.addEventListener('keydown', onKeydown)
                nextTick(() => input.value?.focus())
            } else {
                window.removeEventListener('keydown', onKeydown)
                modal.value?.close()
            }
        })

        const submit = async () => {
            const req = pending.value
            if (!req || isDeriving.value || !password.value) return

            isDeriving.value = true
            try {
                // Derive here so the password string never leaves this closure.
                // Callers receive a non-extractable CryptoKey instead.
                const key = await req.vault.deriveKey(password.value)
                password.value = ''
                if (input.value) input.value.value = ''
                req.settle(key)
            } catch (e) {
                isDeriving.value = false
            }
        }

        const cancel = () => {
            if (isDeriving.value) return
            pending.value?.settle(null)
        }

        // Modal.close() emits beforeClose unconditionally, including when the
        // watcher closes it after a successful submit. settle() is idempotent,
        // and pending is already null by then, so this cannot cancel a
        // completed authorization.
        const onCancel = () => {
            pending.value?.settle(null)
        }

        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onKeydown)
        })

        return {
            modal,
            input,
            password,
            isDeriving,
            reason,
            errorText,
            submit,
            cancel,
            onCancel,
        }
    },
})
</script>

<style scoped lang="scss">
.session_pw_body {
    width: 380px;
    max-width: 100%;
    padding: 16px 22px 22px;
}

.reason {
    font-size: 14px;
    color: var(--primary-color);
    margin-bottom: 14px;
}

label {
    display: block;
    font-size: 12px;
    font-weight: bold;
    color: var(--primary-color-light);
    margin-bottom: 4px;
}

input {
    width: 100%;
    background-color: var(--bg-light);
    padding: 8px 12px;
    color: var(--primary-color);
    font-size: 14px;
}

.err {
    color: var(--error);
    font-size: 13px;
    margin-top: 8px;
}

.actions {
    margin-top: 18px;
}

.cancel_but {
    margin-top: 6px;
    color: var(--primary-color);
}

.hint {
    margin-top: 16px;
    font-size: 12px;
    color: var(--primary-color-light);
}
</style>
