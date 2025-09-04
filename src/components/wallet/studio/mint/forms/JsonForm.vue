<template>
    <div>
        <label>{{ $t('studio.mint.forms.json.label1') }}</label>
        <div class="input_cont">
            <textarea maxlength="1024" type="text" v-model="data" @input="onInput" />
            <p class="counter">{{ data.length }} / 1024</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { JsonFormType } from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'JsonForm',
    emits: ['onInput'],
    setup(props, { emit }) {
        const data = ref('{\n\n}')

        const isValid = computed((): boolean => {
            let dataVal = data.value

            if (dataVal.length === 0) return false
            try {
                JSON.parse(dataVal)
            } catch (e) {
                return false
            }
            return true
        })

        onMounted(() => {
            // const container = this.$refs.editor
            // const options = {
            //     mode: 'text',
            // }
            // const editor = new JSONEditor(container, options)
            //
            // console.log(editor)
        })

        const onInput = () => {
            let msg: null | JsonFormType = null

            if (isValid.value) {
                msg = {
                    data: data.value,
                }
            } else {
                msg = null
            }

            emit('onInput', msg)
        }

        return {
            data,
            isValid,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
textarea,
.editor {
    width: 100%;
    height: 180px;
    max-width: 100%;
}

.editor {
    position: relative;
    //overflow: scroll;
    background-color: var(--bg-light);
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
