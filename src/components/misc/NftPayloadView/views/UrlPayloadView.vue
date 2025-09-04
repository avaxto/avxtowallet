<template>
    <div class="url_payload_view" @mouseenter="isHover = true" @mouseleave="isHover = false">
        <img :src="url" @load="isImage = true" v-show="isImage" />
        <video
            :src="url"
            @loadedmetadata="isVideo = true"
            v-show="isVideo"
            :controls="isHover"
            loop
            muted
            controlsList="nodownload"
        />
        <div v-if="!isImage && !isVideo" class="unknown">
            <p style="font-size: 2em">
                <fa icon="link"></fa>
            </p>
            <p class="warn">Do NOT click links you do not trust.</p>
            <a :href="url" target="_blank">{{ url }}</a>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { URLPayload } from 'avalanche/dist/utils'

export default defineComponent({
    name: 'UrlPayloadView',
    props: {
        payload: {
            type: Object as () => URLPayload,
            required: true
        }
    },
    setup(props) {
        const img_types = ['jpeg', 'jpg', 'gif', 'png', 'apng', 'svg', 'bmp', 'ico', 'webp']
        const valid_types = img_types.concat(['pdf'])
        const isImage = ref(false)
        const isVideo = ref(false)
        const isHover = ref(false)

        const url = computed(() => {
            return props.payload.getContent().toString()
        })

        const fileType = computed((): string | null => {
            let urlValue = url.value
            let split = urlValue.split('.')

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
            isHover,
            url,
            fileType
        }
    }
})
</script>
<style scoped lang="scss">
.url_payload_view {
    //border-radius: 14px;
    //overflow: hidden;
}
img,
video {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
}

.unknown {
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;

    a {
        margin: 14px 0;
    }
}
.unknown,
.warn {
    text-align: center;
    padding: 12px;
    word-break: break-all;
    font-size: 13px;
    span {
        color: var(--primary-color-light);
        font-size: 13px;
    }
}

.warn {
    color: var(--secondary-color);
    word-break: normal;
    font-size: 1.2em;
    font-weight: bold;
    opacity: 0.6;
}
</style>
