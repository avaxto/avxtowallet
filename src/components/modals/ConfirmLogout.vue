<template>
    <modal ref="modalRef" title="Confirm Logout" class="modal_main" :can_close="false">
        <div class="confirm_body">
            <p style="text-align: center">
                {{ $t('logout.confirmation') }}
            </p>

            <div
                style="display: flex; flex-direction: column; align-items: center; margin-top: 14px"
            >
                <v-btn class="ava_button button_primary" @click="submit" :loading="isLoading">
                    {{ $t('logout.button_conf') }}
                </v-btn>
                <button class="ava_button_secondary" @click="close">
                    {{ $t('logout.button_cancel') }}
                </button>
            </div>
        </div>
    </modal>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref } from 'vue'
import { useStore } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import CopyText from '@/components/misc/CopyText.vue'

interface Props {
    phrase: string
}

export default defineComponent({
    name: 'ConfirmLogout',
    components: {
        Modal,
        CopyText,
    },
    props: {
        phrase: {
            type: String,
            default: ''
        }
    },
    setup() {
        const store = useStore()
        const isLoading = ref(false)
        const modalRef = ref<InstanceType<typeof Modal>>()

        const open = (): void => {
            modalRef.value?.open()
        }

        const close = (): void => {
            modalRef.value?.close()
        }

        const submit = async () => {
            isLoading.value = true
            await store.dispatch('logout')
            await store.dispatch('Notifications/add', {
                title: 'Logout',
                message: 'You have successfully logged out of your wallet.',
            })
            isLoading.value = false
            close()
        }

        return {
            isLoading,
            modalRef,
            open,
            close,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
.confirm_body {
    /*width: 600px;*/
    width: 400px;
    max-width: 100%;
    padding: 30px;
    /*background-color: var(--bg-light);*/
}
</style>
