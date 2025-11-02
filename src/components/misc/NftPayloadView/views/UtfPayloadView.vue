<template>
    <div class="utf_payload_view">
        <p>{{ text }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { UTF8Payload } from '@/avalanche/utils'

export default defineComponent({
    name: 'UtfPayloadView',
    props: {
        payload: {
            type: Object as () => UTF8Payload,
            required: true
        }
    },
    setup(props) {
        const text = computed(() => {
            return props.payload.getContent()
        })

        return {
            text
        }
    }
})
</script>
<style scoped lang="scss">
p {
    height: 100%;
    font-size: 13px;
    padding: 12px 24px;
    word-break: break-word;
    overflow: scroll;
    background-color: var(--bg-light) !important;
    color: var(--primary-color) !important;
}
</style>
