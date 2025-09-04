<template>
    <div v-if="utxos.length > 0" class="collectible_family">
        <p class="fam_title">{{ family.name }}</p>
        <div class="group_grid">
            <div
                v-for="(utxo, i) in uniqueGroups"
                :used="disabledIds.includes(utxo.getUTXOID())"
                :key="utxo.getUTXOID()"
                class="card"
                @click="click(utxo)"
            >
                <NftPayloadView
                    :payload="payloads[i]"
                    small="true"
                    class="payload_view"
                ></NftPayloadView>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import { IWalletNftDict } from '@/store/types'
import { NFTTransferOutput, UTXO } from 'avalanche/dist/apis/avm'
import { Buffer } from 'avalanche'
import { PayloadBase, PayloadTypes } from 'avalanche/dist/utils'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import { getPayloadFromUTXO } from '@/helpers/helper'

let payloadtypes = PayloadTypes.getInstance()

export default defineComponent({
    name: 'CollectibleFamily',
    components: {
        NftPayloadView,
    },
    props: {
        family: {
            type: Object as () => AvaNftFamily,
            required: true
        },
        disabledIds: {
            type: Array as () => string[],
            default: () => []
        }
    },
    emits: ['select'],
    setup(props, { emit }) {
        const store = useStore()

        const nftFamilies = computed(() => {
            return store.getters['Assets/nftFamilies']
        })

        const nftDict = computed((): IWalletNftDict => {
            return store.getters['Assets/walletNftDict']
        })

        const utxos = computed(() => {
            let id = props.family.id
            return nftDict.value[id] || []
        })

        const uniqueGroups = computed(() => {
            let ids: number[] = []
            return utxos.value.filter((utxo) => {
                let gId = (utxo.getOutput() as NFTTransferOutput).getGroupID()
                if (ids.includes(gId)) {
                    return false
                } else {
                    ids.push(gId)
                    return true
                }
            })
        })

        const payloads = computed(() => {
            return uniqueGroups.value.map((utxo) => {
                return getPayloadFromUTXO(utxo)
            })
        })

        const click = (utxo: UTXO) => {
            emit('select', utxo)
        }

        return {
            nftFamilies,
            nftDict,
            utxos,
            uniqueGroups,
            payloads,
            click
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.collectible_family {
    display: grid;
    grid-template-columns: 1fr max-content;
}
//.fam_title {
//    border-bottom: 2px solid var(--bg-light);
//}
$card_w: 80px;

.group_grid {
    display: grid;
    grid-template-columns: repeat(5, $card_w);
    gap: 12px;
}

.card {
    position: relative;
    width: $card_w;
    height: $card_w;
    background-color: var(--bg-light);
    border-radius: 4px;
    overflow: hidden;
    transition-duration: 0.2s;
    cursor: pointer;
    border: 1px solid var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
        border: 1px solid var(--secondary-color);
        transform: scale(1.1);
    }

    &[used] {
        opacity: 0.1;
        pointer-events: none;
        cursor: not-allowed;
    }
}

@include main.mobile-device {
    $card_w: 60px;

    .collectible_family {
        display: block;
    }
    .fam_title {
        color: var(--primary-color-light);
        font-size: 12px;
        margin-bottom: 8px !important;
    }

    .group_grid {
        grid-template-columns: repeat(5, $card_w);
    }
    .card {
        width: $card_w;
        height: $card_w;
    }
}
</style>
