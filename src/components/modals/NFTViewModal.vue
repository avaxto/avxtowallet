<template>
    <modal :title="$t('modal.nft.title')" ref="modalRef">
        <div class="nft_view_body">
            <NftPayloadView :payload="payload" class="view"></NftPayloadView>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'
import Modal from '@/components/modals/Modal.vue'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import { PayloadBase } from '@/avalanche/utils'

interface Props {
    payload: PayloadBase
}

export default defineComponent({
    name: 'NFTViewModal',
    components: { NftPayloadView, Modal },
    props: {
        payload: {
            type: Object as () => PayloadBase,
            required: true
        }
    },
    setup() {
        const modalRef = ref<InstanceType<typeof Modal>>()

        const open = () => {
            modalRef.value?.open()
        }

        return {
            modalRef,
            open
        }
    }
})
</script>
<style scoped lang="scss">
.nft_view_body {
    width: 80vw;
    height: 80vh;
}

.view {
    height: 100%;
    width: 100%;
}
</style>
