<!--Used inside the JsonPayload.vue component-->

<template>
    <div class="generic_payload_view">
        <template v-if="!isError">
            <div class="generic_view">
                <img :src="img" @load="isImage = true" v-show="isImage" />
                <video
                    :src="img"
                    @loadedmetadata="isVideo = true"
                    v-show="isVideo"
                    muted
                    controlsList="nodownload"
                />
            </div>
        </template>
        <template v-else>
            <p>Failed to load generic collectible payload.</p>
        </template>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, type PropType } from 'vue'
import { JSONPayload } from 'avalanche/dist/utils'
import { IGenericNft } from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'GenericPayloadView',
    props: {
        payload: {
            type: Object as PropType<JSONPayload>,
            required: true
        }
    },
    setup(props) {
        const isError = ref(false)
        const jsonData = ref<IGenericNft | null>(null)
        const isImage = ref(false)
        const isVideo = ref(false)

        const content = computed((): string => {
            return props.payload.getContent().toString()
        })

        const desc = computed(() => {
            return jsonData.value?.desc
        })

        const img = computed(() => {
            return jsonData.value?.img
        })

        const title = computed(() => {
            return jsonData.value?.title
        })

        const parsePayload = () => {
            try {
                jsonData.value = JSON.parse(content.value).avalanche
                isError.value = false
            } catch (e) {
                isError.value = true
            }
        }

        watch(() => props.payload, () => {
            parsePayload()
        })

        onMounted(() => {
            parsePayload()
        })

        return {
            isError,
            jsonData,
            isImage,
            isVideo,
            content,
            desc,
            img,
            title
        }
    }
})
</script>
<style scoped lang="scss">
.generic_payload_view {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
}
.generic_view {
    position: relative;
    width: 100%;
    height: 100%;
    max-height: 100%;
    overflow: hidden;
}
p {
    font-size: 13px;
    word-break: break-word;
    overflow: scroll;
    background-color: var(--bg-light);
    color: var(--primary-color);
}

img,
video {
    display: block;
    object-fit: cover;
    object-position: center;
    width: 100%;
    height: 100%;
    position: absolute;
}

.nft_title {
    position: absolute;
    bottom: 0;
    width: 100%;
    font-size: 13px;
    background-color: #000000aa;
    color: #fff;
    transition-duration: 0.2s;
}

.generic_view:hover {
    .desc {
        opacity: 1;
    }
    .nft_title {
        opacity: 0;
    }
}
.desc {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    opacity: 0;
    font-size: 13px;
    transition-duration: 0.2s;
    color: #fff;
    text-align: center;
    padding: 14px;
    background-color: #000000bb;
}
</style>
