<template>
    <v-banner sticky class="url_banner" color="#f00" ref="banner">
        <template v-slot:default>
            <fa icon="exclamation-triangle"></fa>
            Make sure the URL is
            <b>wallet.avax.network</b>
            <button @click="dismiss" class="dismiss_but" data-cy="dismiss_banner">
                <fa icon="times"></fa>
            </button>
        </template>
    </v-banner>
</template>
<script lang="ts">
import { defineComponent, ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

export default defineComponent({
    name: 'UrlBanner',
    setup() {
        const route = useRoute()
        const banner = ref<any>()

        onMounted(() => {
            if (route.name === 'legal') {
                dismiss()
            }
        })

        const dismiss = () => {
            banner.value?.toggle()
        }

        return {
            banner,
            dismiss
        }
    }
})
</script>
<style scoped lang="scss">
.url_banner {
    background-color: #1d82bb;
    color: #fff;
    z-index: 3 !important;

    .dismiss_but {
        margin-right: 8px;
        float: right;
    }
}
</style>
