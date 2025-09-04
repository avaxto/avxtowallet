<template>
    <div class="url_payload_view">
        <img :src="url" @load="isImage = true" v-show="isImage" />
        <video
            :src="url"
            @loadedmetadata="isVideo = true"
            v-show="isVideo"
            muted
            controlsList="nodownload"
        />
        <div v-if="!isVideo && !isImage" class="unknown">
            <p><fa icon="link"></fa></p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue'
import { URLPayload } from 'avalanche/dist/utils'

export default defineComponent({
    name: 'UrlPayloadView',
    props: {
        payload: {
            type: Object as PropType<URLPayload>,
            required: true
        }
    },
    setup(props) {
        const img_types = ['jpeg', 'jpg', 'gif', 'png', 'apng', 'svg', 'bmp', 'ico', 'webp']
        const valid_types = img_types.concat(['pdf'])
        const isImage = ref(false)
        const isVideo = ref(false)

        const url = computed(() => {
            return props.payload.getContent().toString()
        })

        const fileType = computed((): string | null => {
            let urlVal = url.value
            let split = urlVal.split('.')

            // Couldn't find extension
            if (split.length === 1) return null

            let extension: string = split[split.length - 1]

            if (!valid_types.includes(extension)) return null
            return extension
        })

        return {
            img_types,
            valid_types,
            isImage,
            isVideo,
            url,
            fileType
        }
    }
})
</script>
<style scoped lang="scss">
.url_payload_view {
    height: 100%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    position: absolute;
    top: 0;
    left: 0;
    //border-radius: 14px;
    //overflow: hidden;
}

img,
video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
}

.unknown {
    background-color: var(--bg-light);
    text-align: center;
}
</style>
