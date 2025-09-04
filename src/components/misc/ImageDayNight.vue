<template>
    <img v-if="isDay" :src="day" />
    <img v-else :src="night" />
</template>
<script lang="ts">
import { defineComponent, computed, getCurrentInstance } from 'vue'

interface Props {
    day: string
    night: string
}

export default defineComponent({
    name: 'ImageDayNight',
    props: {
        day: {
            type: String,
            required: true
        },
        night: {
            type: String,
            required: true
        }
    },
    setup(props: Props) {
        const instance = getCurrentInstance()

        const isDay = computed(() => {
            //@ts-ignore
            return instance?.proxy?.$root.theme === 'day'
        })

        return {
            isDay
        }
    }
})
</script>
<style scoped lang="scss"></style>
