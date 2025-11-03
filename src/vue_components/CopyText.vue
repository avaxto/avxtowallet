<template>
    <div class="copyBut">
        <button @click="copy"><slot></slot></button>
        <input ref="copytext" :value="value">
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

const CopyText = defineComponent({
    name: 'CopyText',
    props: {
        value: {
            type: String,
            required: true
        },
    },
    emits: ['copy'],
    setup(props, { emit }) {
        const copytext = ref<HTMLInputElement>()

        const copy = () => {
            if (!copytext.value) return
            
            copytext.value.select()
            copytext.value.setSelectionRange(0, 99999)
            document.execCommand("copy")
            emit('copy', props.value)
        }

        return {
            copytext,
            copy
        }
    }
})

export { CopyText }
export default CopyText
</script>
<style scoped>
    .copyBut{
        display: inline-block;
    }
    .copyBut button{
        width: 100%;
        height: 100%;
    }
    .copyBut input{
        width: 1px;
        position: absolute;
        opacity: 0;
    }
</style>