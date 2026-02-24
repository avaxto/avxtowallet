<template>
    <form @submit.prevent="submit" class="change_pass_form">
        <input
            placeholder="Old Password"
            type="password"
            class="single_line_input"
            v-model="passOld"
        />
        <input
            placeholder="New Password"
            type="password"
            class="single_line_input"
            v-model="pass"
        />
        <input
            placeholder="Confirm Password"
            type="password"
            class="single_line_input"
            v-model="passConfirm"
        />
        <p class="err">{{ error }}</p>
        <v-btn class="button_secondary" small block depressed :disabled="!canSubmit" type="submit">
            Submit
        </v-btn>
    </form>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useNotificationsStore } from '@/stores'
import AccountSettingsModal from '@/components/modals/AccountSettings/AccountSettingsModal.vue'
import { ChangePasswordInput } from '@/types'

export default defineComponent({
    name: 'ChangePassword',
    setup(props, { emit }) {
        const notificationsStore = useNotificationsStore()
        const pass = ref('')
        const passOld = ref('')
        const passConfirm = ref('')
        const error = ref('')

        const errCheck = () => {
            if (pass.value.length < 9) {
                return 'Password must be at least 9 characters.'
            }

            if (pass.value != passConfirm.value) {
                return 'Passwords do not match.'
            }

            if (pass.value === passOld.value) {
                return 'Your new password must be different from your previous password.'
            }

            return false
        }

        const canSubmit = computed(() => {
            if (pass.value.length < 1) return false
            if (passConfirm.value.length < 1) return false
            return true
        })

        const submit = async () => {
            error.value = ''
            const err = errCheck()
            if (err) {
                error.value = err
                return
            }

            const input: ChangePasswordInput = {
                passOld: passOld.value,
                passNew: pass.value,
            }

            store
                .dispatch('Accounts/changePassword', input)
                .then(() => {
                    notificationsStore.add({
                        title: 'Password Changed',
                        message: 'You can now use your account with your new password.',
                    })
                    // Emit close event to parent
                    emit('close')
                })
                .catch((err) => {
                    error.value = err
                })
        }

        return {
            pass,
            passOld,
            passConfirm,
            error,
            canSubmit,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
@use './style';
</style>
