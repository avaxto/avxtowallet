<template>
    <img ref="image_tag" :height="diameter" :width="diameter" />
</template>

<script lang="ts">
import { defineComponent, ref, watch, onMounted } from 'vue'
import makeBlockie from 'ethereum-blockies-base64'

export default defineComponent({
    name: 'Identicon',
    props: {
        value: {
            type: String,
            required: true
        },
        diameter: {
            type: Number,
            default: 40
        }
    },
    setup(props) {
        const image_tag = ref<HTMLImageElement>()

        const generateImage = () => {
            if (!image_tag.value) return
            let base64 = makeBlockie(props.value)
            image_tag.value.src = base64
        }

        // Watch for value changes
        watch(() => props.value, () => {
            generateImage()
        })

        onMounted(() => {
            generateImage()
        })

        return {
            image_tag
        }
    }
})
</script>
<style scoped lang="scss">
img {
    border-radius: 100%;
}
</style>
