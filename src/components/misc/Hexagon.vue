<template>
    <div class="hex_img">
        <img src="@/assets/hex.svg" class="hex_img" v-if="!isAva" />
        <img src="@/assets/hex_ava.svg" class="hex_img" v-else />
    </div>
</template>
<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export default defineComponent({
    name: 'Hexagon',
    props: {
        isAva: {
            type: Boolean as PropType<boolean>,
            default: false
        }
    }
})
</script>
<style scoped lang="scss">
.hex_img {
    display: flex;
    justify-content: center;
    align-items: center;
}

img.hex_img {
    width: 100% !important;
    object-position: center;
    object-fit: contain;
}
</style>
