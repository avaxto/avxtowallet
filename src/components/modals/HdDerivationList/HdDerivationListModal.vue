<template>
    <modal ref="modal" title="HD Addresses" class="modal_main">
        <div class="hd_deriv_modal_body">
            <HDDerivationList :wallet="wallet"></HDDerivationList>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref } from 'vue'

import Modal from '@/components/modals/Modal.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import HDDerivationList from '@/components/modals/HdDerivationList/HDDerivationList.vue'

export default defineComponent({
    name: 'HdDerivationListModal',
    components: {
        Modal,
        HDDerivationList,
    },
    props: {
        wallet: {
            type: Object as () => MnemonicWallet,
            required: true
        }
    },
    setup() {
        const modal = ref<InstanceType<typeof Modal> | null>(null)

        const open = (): void => {
            modal.value?.open()
        }

        return {
            modal,
            open
        }
    }
})
</script>
<style scoped lang="scss">
.hd_deriv_modal_body {
    //width: 600px;
    max-width: 100%;
    padding: 0px;
}
</style>
