<template>
    <div v-if="!isEmpty">
        <AvmNftSelectModal
            ref="select_modal"
            @select="addNft"
            :disabled-ids="usedNftIds"
        ></AvmNftSelectModal>
        <div class="added_list">
            <NftListItem
                v-for="utxo in addedNfts"
                class="nft_icon"
                @remove="remove"
                :key="utxo.getUTXOID()"
                :sample="utxo"
                :disabled="disabled"
                @change="setGroupUtxos"
            ></NftListItem>
            <div class="nft_icon card nft_add">
                <button @click="showPopup" class="add_but" v-if="!disabled">
                    <fa icon="plus"></fa>
                    <br />
                    Add Collectible
                </button>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onActivated, onDeactivated } from 'vue'
import { useStore } from 'vuex'
import { IWalletNftDict } from '../../../store/types'
import { NftFamilyDict } from '../../../store/modules/assets/types'
import BalancePopup from '@/components/misc/BalancePopup/BalancePopup.vue'

import 'reflect-metadata'
import { NFTTransferOutput, UTXO } from 'avalanche/dist/apis/avm'
import { getPayloadFromUTXO } from '@/helpers/helper'
import NftListItem from '@/components/wallet/transfer/NftListItem.vue'
import { IGroupDict, IGroupQuantity } from '@/components/wallet/studio/mint/types'
import { bintools } from '@/AVA'
import AvmNftSelectModal from '@/components/modals/AvmNftSelectModal.vue'

export default defineComponent({
    name: 'NftList',
    components: {
        AvmNftSelectModal,
        BalancePopup,
        NftListItem,
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()
        
        const addedNfts = ref<UTXO[]>([])
        const groupUtxos = ref<IGroupDict>({})
        const select_modal = ref<InstanceType<typeof AvmNftSelectModal>>()

        const payloads = computed(() => {
            return addedNfts.value.map((utxo) => {
                return getPayloadFromUTXO(utxo)
            })
        })

        const isEmpty = computed((): boolean => {
            return nftUTXOs.value.length === 0
        })

        const nftUTXOs = computed((): UTXO[] => {
            return store.state.Assets.nftUTXOs
        })

        const nftDict = computed((): IWalletNftDict => {
            return store.getters['Assets/walletNftDict']
        })

        const nftFamsDict = computed((): NftFamilyDict => {
            return store.state.Assets.nftFamsDict
        })

        const usedNftIds = computed(() => {
            return addedNfts.value.map((utxo: UTXO) => {
                return utxo.getUTXOID()
            })
        })

        const setGroupUtxos = (val: IGroupQuantity) => {
            groupUtxos.value[val.id] = val.utxos
            emitChange()
        }

        const emitChange = () => {
            let utxos = []

            for (var id in groupUtxos.value) {
                let gUtxos = groupUtxos.value[id]
                utxos.push(...gUtxos)
            }

            emit('change', utxos)
        }

        const clear = () => {
            addedNfts.value = []
            groupUtxos.value = {}
            emitChange()
        }

        const addNft = (utxo: UTXO) => {
            addedNfts.value.push(utxo)
        }

        const remove = (utxo: UTXO) => {
            let famId = bintools.cb58Encode(utxo.getAssetID())
            let groupId = (utxo.getOutput() as NFTTransferOutput).getGroupID()

            // Clear from selected utxos list
            let dictId = `${famId}_${groupId}`
            delete groupUtxos.value[dictId]

            let utxos = addedNfts.value
            for (var i = 0; i < utxos.length; i++) {
                if (utxos[i].getUTXOID() === utxo.getUTXOID()) {
                    addedNfts.value.splice(i, 1)
                }
            }

            emitChange()
        }

        const showPopup = () => {
            if (select_modal.value) {
                select_modal.value.open()
            }
        }

        onDeactivated(() => {
            clear()
        })

        onActivated(() => {
            // empty
        })

        return {
            addedNfts,
            groupUtxos,
            select_modal,
            payloads,
            isEmpty,
            nftUTXOs,
            nftDict,
            nftFamsDict,
            usedNftIds,
            setGroupUtxos,
            emitChange,
            clear,
            addNft,
            remove,
            showPopup
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

$nft_w: 90px;

.added_list {
    display: flex;
    flex-wrap: wrap;
}
.nft_icon {
    flex-shrink: 0;
    flex-grow: 0;
    position: relative;
    width: $nft_w;
    height: $nft_w;
    background-color: var(--bg-light);
    border-radius: 3px;
    margin: 4px;
    margin-bottom: 50px;
    display: flex;
    align-items: center;
    justify-content: center;

    &:first-of-type {
        margin-left: 0;
    }
}

.nft_add {
    background-color: transparent;
    box-shadow: none !important;
}
.add_but {
    height: 100%;
    width: 100%;
    padding: 14px;
    border: 1px dashed var(--primary-color-light);
    cursor: pointer;
    font-size: 12px;
    opacity: 0.5;
    text-align: center;
    transition-duration: 0.2s;

    &:hover {
        opacity: 1;
    }
}

@include main.mobile-device {
    .added_list {
        display: grid;
        grid-gap: 12px;
        row-gap: 22px;
        grid-template-columns: repeat(4, 1fr);
    }

    .nft_icon {
        width: 100%;
        padding-top: 100%;
        position: relative;
        height: 0;
        margin: 0;
    }

    .add_but {
        position: absolute;
        top: 0;
    }
}
</style>
