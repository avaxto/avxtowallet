<template>
    <div class="utf_payload_view" @mouseenter="mouseEnter" @mouseleave="mouseLeave" ref="viewRef">
        <p class="icon"><fa icon="font"></fa></p>
        <p class="hover_text" v-show="isText" ref="textRef">{{ text }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue'
import { UTF8Payload } from 'avalanche/dist/utils'

export default defineComponent({
    name: 'UtfPayloadView',
    props: {
        payload: {
            type: Object as PropType<UTF8Payload>,
            required: true
        }
    },
    setup(props) {
        const isText = ref(false)
        const textRef = ref<HTMLElement>()
        const viewRef = ref<HTMLElement>()

        const text = computed(() => {
            return props.payload.getContent()
        })

        const mouseEnter = () => {
            showText()
        }

        const mouseLeave = () => {
            isText.value = false
        }

        const showText = () => {
            if (!viewRef.value || !textRef.value) return
            
            let pos: HTMLElement = viewRef.value
            let rect = pos.getBoundingClientRect()

            textRef.value.style.top = rect.y + rect.height + 'px'
            textRef.value.style.left = rect.x + 'px'
            isText.value = true
        }

        return {
            isText,
            text,
            textRef,
            viewRef,
            mouseEnter,
            mouseLeave,
            showText
        }
    }
})
</script>
<style scoped lang="scss">
.utf_payload_view {
    height: 100%;
    width: 100%;
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;

    &:hover {
        .icon {
            color: var(--primary-color-light) !important;
        }
    }
}
p {
    font-size: 13px;
    color: var(--primary-color) !important;
}

.hover_text {
    top: 100px;
    z-index: 99;
    position: fixed;
    background-color: var(--primary-color);
    padding: 3px 12px;
    border: 1px solid var(--bg);
    color: var(--bg) !important;
    transition-duration: 0.2s;
    border-radius: 3px;
    box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.2);
}
</style>
