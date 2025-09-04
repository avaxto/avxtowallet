<template>
    <div>
        <button @click="remove" class="removeBut" v-if="!disabled">
            <fa icon="times"></fa>
        </button>
        <div class="amt_in hover_border">
            <input
                type="number"
                min="1"
                inputmode="numeric"
                :max="allUtxos.length"
                v-model="quantity"
                :disabled="disabled"
            />
        </div>
        <NftPayloadView :payload="payload" small="true"></NftPayloadView>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from 'vuex'
import { NFTTransferOutput, UTXO } from 'avalanche/dist/apis/avm'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import { getPayloadFromUTXO } from '@/helpers/helper'
import { bintools } from '@/AVA'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import { IGroupQuantity } from '@/components/wallet/studio/mint/types'

interface Props {
    sample: UTXO
    disabled: boolean
}

export default defineComponent({
    name: 'NftListItem',
    components: {
        NftPayloadView,
    },
    props: {
        sample: {
            type: Object as () => UTXO,
            required: true
        },
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change', 'remove'],
    setup(props: Props, { emit }) {
        const store = useStore()
        const quantity = ref(1)

        const assetId = computed(() => {
            let famId = props.sample.getAssetID()
            return bintools.cb58Encode(famId)
        })

        const groupId = computed(() => {
            return (props.sample.getOutput() as NFTTransferOutput).getGroupID()
        })

        const allUtxos = computed(() => {
            let famId = props.sample.getAssetID()
            let utxos: UTXO[] = store.getters['Assets/walletNftDict'][bintools.cb58Encode(famId)]

            let filtered = utxos.filter((utxo) => {
                let gId = (utxo.getOutput() as NFTTransferOutput).getGroupID()

                if (gId === groupId.value) {
                    return true
                }
                return false
            })
            return filtered
        })

        const selectedUtxos = computed(() => {
            return allUtxos.value.slice(0, quantity.value)
        })

        const payload = computed(() => {
            return getPayloadFromUTXO(props.sample)
        })

        const emitData = () => {
            let msg: IGroupQuantity = {
                id: `${assetId.value}_${groupId.value}`,
                utxos: selectedUtxos.value,
            }
            emit('change', msg)
        }

        const remove = () => {
            emit('remove', props.sample)
        }

        watch(() => quantity.value, (val: number) => {
            if (val < 1) {
                quantity.value = 1
                return
            }

            let max = allUtxos.value.length

            if (val > max) {
                quantity.value = max
            }

            emitData()
        })

        onMounted(() => {
            emitData()
        })

        return {
            quantity,
            assetId,
            groupId,
            allUtxos,
            selectedUtxos,
            payload,
            emitData,
            remove
        }
    }
})
</script>
<style scoped lang="scss">
$remove_w: 24px;
.removeBut {
    position: absolute;
    z-index: 1;
    top: -$remove_w/4;
    right: -$remove_w/4;
    width: $remove_w;
    height: $remove_w;
    background-color: var(--bg-light);
    color: var(--primary-color-light);
    border: 3px solid var(--bg);
    font-size: 12px;
    border-radius: $remove_w;

    &:hover {
        color: var(--primary-color);
    }
}

.amt_in {
    position: absolute;
    bottom: -12px;
    width: 60%;
    padding: 2px 6px;
    //border: 1px solid var(--bg);
    border-radius: 4px;
    z-index: 2;
    align-items: center;
    //border-radius: 4px;
    font-size: 12px;
    background-color: var(--primary-color);
    color: var(--bg) !important;
    display: flex;

    label {
        font-size: 11px;
        display: block;
        font-weight: bold;
        text-align: right;
        display: none;
    }

    p {
        color: var(--bg) !important;
        font-size: 12px;
    }

    > input {
        border: none !important;
        width: 100%;
        color: var(--bg) !important;
        text-align: center;

        &::-webkit-outer-spin-button,
        &::-webkit-inner-spin-button {
            -webkit-appearance: none;
        }
    }
}
</style>
