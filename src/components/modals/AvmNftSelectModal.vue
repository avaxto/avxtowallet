<template>
    <Modal ref="modalRef" title="Select a Collectible">
        <div class="nft_sel_body">
            <div class="list">
                <CollectibleFamily
                    v-for="fam in nftFamsDict"
                    :family="fam"
                    :key="fam.id"
                    :disabled-ids="disabledIds"
                    @select="select"
                ></CollectibleFamily>
            </div>
        </div>
    </Modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useAssetsStore } from '@/stores'
import Modal from '@/components/modals/Modal.vue'
import { UTXO } from '@/avalanche/apis/avm'
import { NftFamilyDict } from '@/types'
import CollectibleFamily from '@/components/misc/BalancePopup/CollectibleFamily.vue'

interface Props {
    disabledIds: string[]
}

export default defineComponent({
    name: 'AvmNftSelectModal',
    components: { CollectibleFamily, Modal },
    props: {
        disabledIds: {
            type: Array as () => string[],
            default: () => []
        }
    },
    emits: ['select'],
    setup(props: Props, { emit }) {
        const assetsStore = useAssetsStore()
        const modalRef = ref<InstanceType<typeof Modal>>()

        const isEmpty = computed((): boolean => {
            return assetsStore.nftUTXOs.length === 0
        })

        const nftFamsDict = computed((): NftFamilyDict => {
            return assetsStore.nftFamsDict
        })

        const open = () => {
            modalRef.value?.open()
        }

        const close = () => {
            modalRef.value?.close()
        }

        const select = (nft: UTXO) => {
            emit('select', nft)
            close()
        }

        const isNftUsed = (utxo: UTXO) => {
            return props.disabledIds.includes(utxo.getUTXOID())
        }

        return {
            modalRef,
            isEmpty,
            nftFamsDict,
            open,
            close,
            select,
            isNftUsed
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.nft_sel_body {
    width: 650px;
    max-width: 100%;
}

.list {
    max-height: 60vh;
    overflow: scroll;

    > div {
        border-bottom: 2px solid var(--bg-light);
        padding: 14px;
    }
}

@include main.mobile-device {
    .nft_sel_body {
        width: 100%;
    }
}
</style>
