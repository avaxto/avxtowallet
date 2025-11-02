<template>
    <div v-if="!isGeneric" class="json_payload_view">
        <p>{ }</p>
    </div>
    <GenericPayloadViewSmall v-else :payload="payload"></GenericPayloadViewSmall>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, type PropType } from 'vue'
import { JSONPayload } from '@/avalanche/utils'

import GenericPayloadViewSmall from '@/components/misc/NftPayloadView/views_small/GenericPayloadView.vue'

export default defineComponent({
    name: 'JsonPayloadView',
    components: {
        GenericPayloadViewSmall,
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
    color: #0f0 !important;
    background-color: #000 !important;
    height: 100%;
    width: 100%;
    display: flex;
    position: absolute;
    top: 0;
    left: 0;
    align-items: center;
    justify-content: center;

    p {
        color: #0f0 !important;
        font-size: 16px;
        word-break: break-word;
        font-weight: bold;
    }
}
</style>
