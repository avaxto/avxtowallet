<template>
    <div class="family_group" v-if="payload">
        <p class="count" v-if="quantity > 1">{{ quantity }}</p>
        <div class="nft_card">
            <NftPayloadView :payload="payload" class="payload_view" small="true"></NftPayloadView>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, onMounted, type PropType } from 'vue'
import { useStore } from '@/stores'

import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import { PayloadBase } from '@/avalanche/utils'
import { Buffer } from '@/avalanche'
import { PayloadTypes } from '@/avalanche/utils'
import { UTXO } from '@/store/modules/history/types'

const payloadtypes = PayloadTypes.getInstance()

export default defineComponent({
    name: 'TxHistoryNftFamilyGroup',
    components: { 
        NftPayloadView 
    },
    props: {
        utxos: {
            type: Array as PropType<UTXO[]>,
            required: true
        },
        assetID: {
            type: String,
            required: true
        }
    },
    setup(props) {
        const store = useStore()

        onMounted(() => {
            if (!nftFamsDict.value[props.assetID]) {
                store.dispatch('Assets/addUnknownNftFamily', props.assetID)
            }
        })

        const nftFamsDict = computed(() => {
            return store.state.Assets.nftFamsDict
        })

        const quantity = computed(() => {
            return props.utxos.length
        })

        const parsePayload = (rawPayload: string): PayloadBase => {
            let payload = Buffer.from(rawPayload, 'base64')
            payload = Buffer.concat([new Buffer(4).fill(payload.length), payload])

            let typeId = payloadtypes.getTypeID(payload)
            let pl: Buffer = payloadtypes.getContent(payload)
            let payloadbase: PayloadBase = payloadtypes.select(typeId, pl)
            return payloadbase
        }

        const payload = computed((): PayloadBase | null => {
            let payloadData = props.utxos[0].payload
            if (!payloadData) return null

            try {
                let parsed = parsePayload(payloadData)
                return parsed
            } catch (e) {
                console.error('Unable to parse payload.')
            }
            return null
        })

        return {
            nftFamsDict,
            quantity,
            payload
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

$countW: 18px;
.count {
    position: absolute;
    top: -$countW/2.5;
    left: -$countW/2.5;
    width: $countW;
    height: $countW;
    border-radius: $countW;
    line-height: $countW;
    font-size: 10px;
    text-align: center;
    background-color: var(--primary-color);
    border: 1px solid var(--bg-wallet);
    color: var(--bg);
    font-weight: bold;
    z-index: 2;
}
.family_group {
    position: relative;
}

.nft_card {
    height: 35px !important;
    width: 35px !important;
    background-color: var(--bg-light);
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    pointer-events: none;
}

@include main.mobile-device {
}
</style>
