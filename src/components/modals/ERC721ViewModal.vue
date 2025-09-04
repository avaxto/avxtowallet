<template>
    <modal :title="$t('modal.nft.title')" ref="modalRef">
        <div class="nft_view_body">
            <ERC721View :token="token" :index="tokenId" class="view"></ERC721View>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'
import Modal from '@/components/modals/Modal.vue'
import ERC721View from '../misc/ERC721View.vue'
import ERC721Token from '@/js/ERC721Token'

interface Props {
    token: ERC721Token
    tokenId: string
}

export default defineComponent({
    name: 'ERC721ViewModal',
    components: { ERC721View, Modal },
    props: {
        token: {
            type: Object as () => ERC721Token,
            required: true
        },
        tokenId: {
            type: String,
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
