<template>
    <div class="family">
        <div class="previews">
            <NftFamilyCardsPreview
                :utxos="groupUtxos"
                :spread="isHover"
                :max="maxReviewItems"
            ></NftFamilyCardsPreview>
            <div v-if="groupUtxos.length === 0" class="group_preview empty_card">
                <p><fa icon="plus"></fa></p>
            </div>
        </div>
        <div
            class="family_header"
            @click="select"
            @mouseenter="mouseEnter"
            @mouseleave="mouseLeave"
        >
            <p class="name">{{ family.name }}</p>
            <p class="symbol">{{ family.symbol }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from '@/stores'
import { AvaNftFamily } from '../../../../../js/AvaNftFamily'
import { IWalletNftMintDict } from '@/store/types'
import { NFTTransferOutput, UTXO } from 'avalanche/dist/apis/avm'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import NftFamilyCardsPreview from '@/components/misc/NftFamilyCardsPreview.vue'

export default defineComponent({
    name: 'FamilyRow',
    components: { NftFamilyCardsPreview, NftPayloadView },
    props: {
        family: {
            type: Object as () => AvaNftFamily,
            required: true
        }
    },
    emits: ['select'],
    setup(props, { emit }) {
        const store = useStore()
        const maxReviewItems = ref(14)
        const isHover = ref(false)

        const mouseEnter = () => {
            isHover.value = true
        }

        const mouseLeave = () => {
            isHover.value = false
        }

        const nftMintDict = computed((): IWalletNftMintDict => {
            // return store.getters.walletNftMintDict
            return store.getters['Assets/nftMintDict']
        })

        const nftUtxoDict = computed((): IWalletNftMintDict => {
            // return store.getters.walletNftDict
            return store.getters['Assets/walletNftDict']
        })

        const mintUtxos = computed(() => {
            return nftMintDict.value[props.family.id]
        })

        // return utxos belonging to this family
        const nftUtxos = computed((): UTXO[] => {
            return nftUtxoDict.value[props.family.id] || []
        })

        // Return 1 of each group
        const groupUtxos = computed(() => {
            const utxos = nftUtxos.value
            const ids: number[] = []

            let filtered = utxos.filter((utxo) => {
                const groupId = (utxo.getOutput() as NFTTransferOutput).getGroupID()

                if (ids.includes(groupId)) {
                    return false
                } else {
                    ids.push(groupId)
                    return true
                }
            })

            // order by group id
            filtered.sort((a, b) => {
                const gA = (a.getOutput() as NFTTransferOutput).getGroupID()
                const gB = (b.getOutput() as NFTTransferOutput).getGroupID()
                return gA - gB
            })

            return filtered.slice(0, maxReviewItems.value)
        })

        const select = () => {
            emit('select', mintUtxos.value[0])
        }

        return {
            maxReviewItems,
            isHover,
            mouseEnter,
            mouseLeave,
            mintUtxos,
            nftMintDict,
            nftUtxoDict,
            nftUtxos,
            groupUtxos,
            select
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../../main';

.family {
    margin-top: 24px;
    //border: 1px solid var(--bg-light);
    //background-color: var(--bg-light);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 6px 12px;
    //background-color: var(--bg-light);
}

.previews {
    display: flex;
    flex-grow: 1;
    position: relative;
}
.group_preview {
    width: 70px !important;
    height: 90px !important;
    flex-shrink: 0;
    background-color: var(--bg-light);
    border: 1px solid var(--bg-light);
    border-radius: 4px;
    box-shadow: 1px 1px 4px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    user-select: none;
    transform-origin: bottom center !important;
    transition-duration: 0.2s;
    position: absolute !important;
    left: calc(50% - 35px);
}

.family_header {
    display: flex;
    flex-direction: column;
    margin: 14px 0px;
    align-items: center;
    font-size: 16px;
    transition-duration: 0.2s;
    padding: 6px 0;
    cursor: pointer;
    z-index: 2;
    background-color: var(--bg-light);
    border-radius: 4px;
    //border: 1px solid var(--primary-color-light);
    user-select: none;
    box-shadow: 1px 0px 3px rgba(0, 0, 0, 0.4);

    .symbol,
    .id {
        opacity: 0.6;
    }

    .symbol {
        font-size: 13px;
    }

    .id {
        flex-grow: 1;
        font-size: 13px;
        text-align: right;
        opacity: 0.4;
        word-break: break-all;
    }

    &:hover {
        background-color: var(--secondary-color);
        color: #fff !important;
        border-color: transparent;
    }
}

.empty {
    font-size: 12px;
    text-align: center;
    flex-grow: 1;
    align-self: center;
}

.empty_card {
    background-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--primary-color-light);
    border: 2px dashed var(--primary-color-light);
}
</style>
