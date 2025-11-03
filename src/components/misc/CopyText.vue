<template>
    <div class="copyBut" @click="copy">
        <!--        <fa icon="copy"></fa>-->
        <img v-if="isDay" src="/img/copy_icon.png" />
        <img v-else src="/img/copy_night.svg" />
        <p class="text">
            <slot></slot>
        </p>
        <input ref="copytext" :value="value" />
    </div>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'
import { useStore } from '@/stores'
import { useTheme } from '@/composables/useTheme'

export default defineComponent({
    name: 'CopyText',
    props: {
        value: {
            type: String,
            required: true
        },
    },
    setup(props) {
        const store = useStore()
        const { isDay } = useTheme()
        const copytext = ref<HTMLInputElement>()
        
        const copy = () => {
            if (copytext.value) {
                copytext.value.select()
                copytext.value.setSelectionRange(0, 99999)

                document.execCommand('copy')
                store.dispatch('Notifications/add', {
                    title: ' Copied',
                    message: 'Copied to clipboard.',
                })
            }
        }

        return {
            isDay,
            copytext,
            copy
        }
    }
})
</script>
<style scoped lang="scss">
.copyBut {
    display: flex;
    width: max-content;
    align-items: center;
    cursor: pointer;
}
.copyBut input {
    width: 1px;
    position: absolute;
    opacity: 0;
}
.text {
    user-select: none;
    pointer-events: none;
    margin-left: 12px !important;
}

img {
    max-height: 18px;
    object-fit: contain;
}
input {
    pointer-events: none;
    user-select: none;
    width: 100% !important;
}
button {
    width: 100%;
    height: 100%;
    background-size: contain;
    background-position: center;
}
</style>
