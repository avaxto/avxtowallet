<template>
    <div class="file_input hover_border">
        <input type="file" :multiple="multiple" @input="oninput" ref="inputRef" />
        <p v-if="fileNum === 0">Select File</p>
        <p v-else>{{ files[0].name }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue'

export default defineComponent({
    name: 'FileInput',
    props: {
        multiple: {
            type: Boolean,
            default: false
        },
        read_type: {
            type: String as PropType<'raw' | 'text'>,
            default: 'raw'
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const files = ref<FileList | null>(null)
        const inputRef = ref<HTMLInputElement>()

        const fileNum = computed(() => {
            if (!files.value) return 0
            return files.value.length
        })

        const oninput = (event: Event) => {
            const input = event.target as HTMLInputElement
            files.value = input.files as FileList
            
            if (props.read_type === 'raw') {
                if (props.multiple) {
                    emit('change', files.value)
                } else {
                    emit('change', files.value?.[0])
                }
            } else {
                read()
            }
        }

        const read = () => {
            if (!files.value) return

            let reader = new FileReader()
            reader.onload = function () {
                emit('change', reader.result)
            }
            reader.onerror = function () {
                console.log(reader.error)
            }

            if (props.read_type === 'text') {
                reader.readAsText(files.value[0])
            }
        }

        const clear = () => {
            if (inputRef.value) {
                inputRef.value.value = ''
            }
            files.value = null
        }

        return {
            files,
            inputRef,
            fileNum,
            oninput,
            read,
            clear
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.file_input {
    position: relative;
    padding: 8px 18px;
    cursor: pointer;
    /* color: main.$primary-color; */
    color: rgb(118, 118, 118);
    background-color: main.$background-color !important;
    border: 1px solid;
    border-radius: 6px;
    max-width: 100%;
    border-color: main.$primary-color;
    font-family: 'DM Sans', sans-serif;
    font-weight: 700;
    text-transform: uppercase !important;
}

input {
    z-index: 2;
    cursor: pointer;
    position: absolute;
    border: none !important;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    opacity: 0;
}

p {
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
}
</style>
