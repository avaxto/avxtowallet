<template>
    <form @submit.prevent="submit">
        <p>You have unsaved keys on your account.</p>
        <input type="password" class="single_line_input" placeholder="Password" v-model="pass" />
        <p class="err">{{ error }}</p>
        <v-btn class="button_secondary" small block depressed :disabled="!canSubmit" type="submit">
            Submit
        </v-btn>
    </form>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'
import AccountSettingsModal from '@/components/modals/AccountSettings/AccountSettingsModal.vue'

export default defineComponent({
    name: 'SaveKeys',
    emits: ['close'],
    setup(props, { emit }) {
        const store = useStore()
        const pass = ref('')
        const error = ref('')

        const canSubmit = computed(() => {
            if (pass.value.length < 1) return false
            return true
        })

        const submit = () => {
            error.value = ''
            store
                .dispatch('Accounts/saveKeys', pass.value)
                .then((res) => {
                    store.dispatch('Notifications/add', {
                        title: 'Keys Saved',
                        message: 'Your account is updated with new keys.',
                    })
                    emit('close')
                })
                .catch((err) => {
                    error.value = err
                })
        }

        return {
            pass,
            error,
            canSubmit,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
@use './style';

p {
    white-space: normal;
}
</style>
