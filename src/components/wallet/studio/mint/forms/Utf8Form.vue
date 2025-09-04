<template>
    <div>
        <label>{{ $t('studio.mint.forms.utf8.label1') }}</label>
        <div class="input_cont">
            <textarea maxlength="1024" type="text" v-model="val" @input="onInput" />
            <p class="counter">{{ val.length }} / 1024</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { UrlFormType, UtfFormType } from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'Utf8Form',
    emits: ['onInput'],
    setup(props, { emit }) {
        const val = ref('')

        const isValid = computed((): boolean => {
            if (val.value.length === 0 || val.value.length > 1024) {
                return false
            }

            return true
        })

        const onInput = () => {
            let msg: null | UtfFormType = null

            if (isValid.value) {
                msg = {
                    text: val.value,
                }
            } else {
                msg = null
            }

            emit('onInput', msg)
        }

        return {
            val,
            isValid,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
textarea {
    width: 100%;
    height: 180px;
    max-width: 100%;
}

.input_cont {
    width: 100%;
}
.v-btn {
    margin-top: 14px;
}
.counter {
    text-align: right;
    font-size: 13px;
    color: var(--primary-color-light);
    padding: 2px;
}
</style>
