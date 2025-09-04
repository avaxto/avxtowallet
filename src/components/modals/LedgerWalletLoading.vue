<template>
    <modal ref="modalRef" title="Loading Wallet" :can_close="false">
        <div class="ledger_loading_body">
            <Spinner style="font-size: 1.5em; margin-bottom: 1em"></Spinner>
            <p>Please wait while we load your wallet information.</p>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from 'vuex'
import Modal from '@/components/modals/Modal.vue'
import Spinner from '@/components/misc/Spinner.vue'

export default defineComponent({
    name: 'LedgerWalletLoading',
    components: { Spinner, Modal },
    setup() {
        const store = useStore()
        const modalRef = ref<InstanceType<typeof Modal>>()

        const isActive = computed(() => {
            return store.state.Ledger.isWalletLoading
        })

        onMounted(() => {
            if (isActive.value) {
                modalRef.value?.open()
            }
        })

        watch(isActive, (val: boolean) => {
            if (!modalRef.value) return
            if (val) {
                modalRef.value.open()
            } else {
                modalRef.value.close()
            }
        }, { immediate: true })

        return {
            modalRef,
            isActive
        }
    }
})
</script>
<style scoped lang="scss">
.ledger_loading_body {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 30px;
}
</style>
