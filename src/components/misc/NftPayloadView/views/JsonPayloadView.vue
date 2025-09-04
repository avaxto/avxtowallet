<template>
    <div v-if="!isGeneric" class="json_payload_view">
        <textarea cols="30" row="200" v-model="val" disabled></textarea>
    </div>
    <GenericPayloadView v-else :payload="payload"></GenericPayloadView>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, type PropType } from 'vue'
import { JSONPayload } from 'avalanche/dist/utils'

import GenericPayloadView from '@/components/misc/NftPayloadView/views/GenericPayloadView.vue'

export default defineComponent({
    name: 'JsonPayloadView',
    components: {
        GenericPayloadView,
    },
    props: {
        payload: {
            type: Object as PropType<JSONPayload>,
            required: true
        }
    },
    setup(props) {
        const val = ref('')

        const text = computed((): string => {
            return props.payload.getContent().toString()
        })

        const jsonText = computed(() => {
            let data = text.value
            try {
                let obj = JSON.parse(data)
                return JSON.stringify(obj, undefined, 4)
            } catch (e) {
                return data
            }
        })

        const isGeneric = computed(() => {
            let data = text.value
            try {
                let obj = JSON.parse(data)

                if (obj.hasOwnProperty('avalanche')) {
                    return true
                } else {
                    return false
                }
            } catch (e) {
                return false
            }
            return false
        })

        const updateText = () => {
            val.value = jsonText.value
        }

        watch(() => props.payload, () => {
            updateText()
        })

        onMounted(() => {
            updateText()
        })

        return {
            val,
            text,
            jsonText,
            isGeneric,
            updateText
        }
    }
})
</script>
<style scoped lang="scss">
.json_payload_view {
    overflow: scroll;
}
textarea {
    display: block;
    padding: 12px;
    width: 100%;
    height: 100%;
    min-height: 140px;
    font-size: 12px !important;
    background-color: #000 !important;
    font-family: monospace !important;
    color: #0f0 !important;
    resize: none;
    border: none !important;
}
p {
    font-size: 13px;
    padding: 12px 24px;
    word-break: break-word;
    overflow: scroll;
    background-color: var(--bg-light);
    color: var(--primary-color);
}
</style>
