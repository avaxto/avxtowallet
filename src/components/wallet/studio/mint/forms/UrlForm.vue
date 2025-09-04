<template>
    <div>
        <label>URL</label>
        <input placeholder="https://" v-model="urlIn" @input="onInput" />
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { UrlFormType } from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'UrlForm',
    emits: ['onInput'],
    setup(props, { emit }) {
        const urlIn = ref('')

        const isValidUrl = (url: string) => {
            try {
                new URL(url)
            } catch (_) {
                return false
            }
            return true
        }

        const isValid = computed((): boolean => {
            if (urlIn.value.length === 0) {
                return false
            }

            if (!isValidUrl(urlIn.value)) {
                return false
            }

            return true
        })

        const onInput = () => {
            let msg: null | UrlFormType = null

            if (isValid.value) {
                msg = {
                    url: urlIn.value,
                }
            }

            if (urlIn.value === '') msg = null
            emit('onInput', msg)
        }

        return {
            urlIn,
            isValid,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
input {
    width: 100%;
    max-width: 100%;
}
.v-btn {
    margin-top: 14px;
}
</style>
