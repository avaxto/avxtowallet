<template>
    <div class="nft_payload_view" v-if="isBanned"></div>
    <NftPayloadAllow
        v-model="isShow"
        v-else-if="!isShow"
        :is-small="small"
        :nft-i-d="payloadID"
    ></NftPayloadAllow>
    <Component
        :is="viewer"
        :payload="payload"
        class="nft_payload_view"
        v-else-if="!small"
    ></Component>
    <Component
        v-else-if="!small"
        :is="viewer"
        :payload="payload"
        class="nft_payload_view"
    ></Component>
    <Component v-else :is="viewerSmall" :payload="payload" class="nft_payload_view"></Component>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from 'vuex'
import { PayloadBase } from 'avalanche/dist/utils'

import UrlPayloadView from '@/components/misc/NftPayloadView/views/UrlPayloadView.vue'
import UtfPayloadView from '@/components/misc/NftPayloadView/views/UtfPayloadView.vue'
import JsonPayloadView from '@/components/misc/NftPayloadView/views/JsonPayloadView.vue'

import UrlPayloadViewSmall from '@/components/misc/NftPayloadView/views_small/UrlPayloadView.vue'
import UtfPayloadViewSmall from '@/components/misc/NftPayloadView/views_small/UtfPayloadView.vue'
import JsonPayloadViewSmall from '@/components/misc/NftPayloadView/views_small/JsonPayloadView.vue'
import NftPayloadAllow from '@/components/misc/NftPayloadView/NftPayloadAllow.vue'
import { isUrlBanned } from '@/components/misc/NftPayloadView/blacklist'
import { payloadToHash } from '@/utils/payloadToHash'

export default defineComponent({
    name: 'NftPayloadView',
    components: {
        NftPayloadAllow,
        UrlPayloadView,
        UtfPayloadView,
        JsonPayloadView,
        UrlPayloadViewSmall,
        UtfPayloadViewSmall,
        JsonPayloadViewSmall,
    },
    props: {
        payload: {
            type: Object as () => PayloadBase,
            required: true
        },
        small: {
            type: Boolean,
            default: false
        }
    },
    setup(props) {
        const store = useStore()
        const isShow = ref(false)

        const nftWhitelist = computed(() => {
            return store.state.Assets.nftWhitelist
        })

        const payloadID = computed(() => {
            const str = props.payload.getContent().toString()
            return payloadToHash(str)
        })

        const onListChange = () => {
            if (nftWhitelist.value.includes(payloadID.value)) {
                isShow.value = true
            }
        }

        watch(nftWhitelist, onListChange)

        onMounted(() => {
            if (nftWhitelist.value) {
                onListChange()
            }
        })

        const viewer = computed(() => {
            let typeID = typeID_computed.value
            switch (typeID) {
                case 1: // UTF 8
                    return UtfPayloadView
                case 27: // url
                    return UrlPayloadView
                case 24: // JSON
                    return JsonPayloadView
                default:
                    return UtfPayloadView
            }
        })

        const content = computed(() => {
            return props.payload.getContent().toString()
        })

        const isBanned = computed(() => {
            return isUrlBanned(content.value)
        })

        const typeID_computed = computed(() => {
            return props.payload.typeID()
        })

        const viewerSmall = computed(() => {
            let typeID = typeID_computed.value
            switch (typeID) {
                case 1: // UTF 8
                    return UtfPayloadViewSmall
                case 27: // url
                    return UrlPayloadViewSmall
                case 24: // JSON
                    return JsonPayloadViewSmall
                default:
                    return UtfPayloadViewSmall
            }
        })

        return {
            isShow,
            nftWhitelist,
            payloadID,
            viewer,
            content,
            isBanned,
            typeID: typeID_computed,
            viewerSmall
        }
    }
})
</script>
<style scoped>
.nft_payload_view {
    overflow: auto;
}
</style>
