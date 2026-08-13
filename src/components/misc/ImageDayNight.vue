<!--
    The app has one theme now (dark), so this always renders `night`. Kept as
    a component — rather than replacing every call site with a plain <img> —
    because its callers (Menu.vue, LedgerButton.vue, and the AccessMethodDescriptor
    icon shape in platforms/) still pass both `day` and `night`; changing that
    shape isn't worth it for what's now a single-asset render.
-->
<template>
    <img :src="night" />
</template>
<script lang="ts">
import { defineComponent } from 'vue'

export default defineComponent({
    name: 'ImageDayNight',
    props: {
        day: {
            type: String,
            required: false,
            default: ''
        },
        night: {
            type: String,
            required: true
        }
    }
})
</script>
<style scoped lang="scss"></style>
