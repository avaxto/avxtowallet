<template>
    <div class="input_cont">
        <span v-for="i in 24" :key="i">
            {{ i }}.
            <input
                type="password"
                autocomplete="off"
                autocapitalize="off"
                @focus="onFocus"
                @blur="onBlur"
                @input="onInput($event, i - 1)"
                :ref="(el) => { if (el) inputRefs[`in_${i - 1}`] = [el as HTMLInputElement] }"
                @paste="onPaste"
            />
        </span>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

const SIZE = 24

export default defineComponent({
    name: 'MnemonicPasswordInput',
    emits: ['change'],
    setup(props, { emit }) {
        const inputRefs = ref<Record<string, HTMLInputElement[]>>({})

        const onFocus = (ev: Event) => {
            const target = ev.target as HTMLInputElement
            target.setAttribute('type', 'text')
        }

        const onBlur = (ev: Event) => {
            const target = ev.target as HTMLInputElement
            target.setAttribute('type', 'password')
        }

        const onPaste = (e: Event) => {
            e.preventDefault()
        }

        const emitValue = () => {
            let val = ''
            for (var i = 0; i < SIZE; i++) {
                const input = inputRefs.value[`in_${i}`]?.[0]
                if (input) {
                    val += `${input.value} `
                }
            }
            emit('change', val.trim())
        }

        const onInput = (ev: Event, index: number) => {
            const target = ev.target as HTMLInputElement
            const val: string = target.value.trim()
            const words: string[] = val.split(' ').filter((w) => w !== '')

            if (words.length > 1) {
                words.forEach((word, i) => {
                    const wordIndex = index + i
                    if (wordIndex >= SIZE) return

                    const dom = inputRefs.value[`in_${wordIndex}`]?.[0]
                    if (dom) {
                        dom.value = word
                        dom.focus()
                    }
                })
            }

            emitValue()
        }

        return {
            inputRefs,
            onFocus,
            onBlur,
            onPaste,
            onInput
        }
    }
})
</script>
<style scoped lang="scss">
.input_cont {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    //grid-gap: 1em;
    width: 100%;

    span {
        text-align: left;
        white-space: nowrap;
        margin: 0.7em;
        display: grid;
        grid-template-columns: 2em 1fr;
    }

    input {
        border-bottom: 1px solid var(--primary-color-light);
        width: 8ch;
        border-radius: 2px;
        color: var(--primary-color);
    }
}
</style>
