<template>
    <button @click="toggle">
        <img v-if="isNight" src="@/assets/theme_toggle/night.svg" />
        <img v-else src="@/assets/theme_toggle/day.svg" />
    </button>
</template>
<script lang="ts">
import { defineComponent } from 'vue'
import { useTheme } from '@/composables/useTheme'

export default defineComponent({
    name: 'DayNightToggle',
    setup() {
        const { isNight, toggle } = useTheme()

        return {
            isNight,
            toggle
        }
    }
})
</script>
<style scoped lang="scss">
button {
    display: flex;
    align-items: center;
    img {
        max-height: 18px;
    }
}
</style>
