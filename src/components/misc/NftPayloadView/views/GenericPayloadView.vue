<!--Used inside the JsonPayload.vue component-->

<template>
    <div class="generic_payload_view">
        <div
            v-if="!isError"
            class="payload_rows"
            @mouseenter="isHover = true"
            @mouseleave="isHover = false"
        >
            <div class="generic_view">
                <img :src="img" @load="isImage = true" v-show="isImage" />
                <video
                    :src="img"
                    @loadedmetadata="onVideoMeta"
                    v-show="isVideo"
                    :controls="isHover"
                    loop
                    muted
                    controlsList="nodownload"
                />
            </div>
        </div>
        <div v-else>
            <p>Failed to load generic collectible payload.</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { JSONPayload } from '@/avalanche/utils'
import { IGenericNft } from '@/components/wallet/studio/mint/types'

export default defineComponent({
    name: 'GenericPayloadView',
    props: {
        payload: {
            type: Object as () => JSONPayload,
            required: true
        }
    },
    setup(props) {
        const image = ref<HTMLImageElement>()
        const video = ref<HTMLVideoElement>()
        
        const isVideo = ref(false)
        const isImage = ref(false)
        const isAudio = ref(false)
        const isError = ref(false)
        const jsonData = ref<IGenericNft | null>(null)
        const isHover = ref(false)

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

        const onVideoMeta = (ev: any) => {
            isVideo.value = true
        }

        const parsePayload = () => {
            try {
                jsonData.value = JSON.parse(content.value).avalanche
                isError.value = false
            } catch (e) {
                isError.value = true
            }
        }

        onMounted(() => {
            parsePayload()
        })

        watch(() => props.payload, () => {
            parsePayload()
        })

        return {
            image,
            video,
            isVideo,
            isImage,
            isAudio,
            isError,
            jsonData,
            isHover,
            content,
            desc,
            img,
            title,
            onVideoMeta
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../main';

.generic_payload_view {
    position: relative;
}
.generic_view {
    position: relative;
    width: 100%;
    //height: 100%;
    flex-grow: 1;
    overflow: auto;
}

.generic_meta {
    position: absolute;
    border-top: 2px solid var(--bg-light);
    padding: 16px 12px;
    height: 100%;
    width: 100%;
    background-color: #000d;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
}

img,
video {
    display: block;
    object-fit: contain;
    width: 100%;
    height: 100%;
    outline: none;
    //position: absolute;
}

.payload_rows {
    height: 100%;
    display: flex;
    flex-direction: column;
}

.nft_title {
    font-size: 1.2em;
    text-align: left;
    font-weight: bold;
}

.desc {
    margin-top: 4px;
    font-size: 13px;
}

@include main.mobile-device {
}
</style>
