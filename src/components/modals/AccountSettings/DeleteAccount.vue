<template>
    <form @submit.prevent="submit">
        <input class="single_line_input" type="password" v-model="pass" placeholder="Password" />
        <p class="err">{{ error }}</p>
        <v-btn class="button_secondary" :disabled="!canSubmit" depressed block small type="submit">
            Delete
        </v-btn>
    </form>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'

export default defineComponent({
    name: 'DeleteAccount',
    setup() {
        const store = useStore()
        const pass = ref('')
        const error = ref('')

        const canSubmit = computed(() => {
            if (pass.value.length < 1) return false
            return true
        })

        const submit = async () => {
            error.value = ''
            await store
                .dispatch('Accounts/deleteAccount', pass.value)
                .then((res) => {
                    store.dispatch('Notifications/add', {
                        title: 'Account Deleted',
                        message: 'Your wallet is no longer stored on this browser.',
                    })
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
</style>
