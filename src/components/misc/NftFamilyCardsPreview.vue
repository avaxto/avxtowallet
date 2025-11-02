<template>
    <div class="previews">
        <div
            v-for="(payload, i) in payloads"
            :key="i"
            class="group_preview"
            :style="{
                zIndex: payloads.length - i,
                transform: `translateX(0%)  rotateZ(${(i - payloads.length / 2) * rotateDeg}deg)`,
            }"
        >
            <NftPayloadView :payload="payload" :small="true"></NftPayloadView>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import { UTXO } from '@/avalanche/apis/avm'
import { getPayloadFromUTXO } from '@/helpers/helper'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'

interface Props {
    utxos: UTXO[]
    spread: boolean
    max: number
}

export default defineComponent({
    name: 'NftFamilyCardsPreview',
    components: {
        NftPayloadView,
    },
    props: {
        utxos: {
            type: Array as () => UTXO[],
            required: true
        },
        spread: {
            type: Boolean,
            default: false
        },
        max: {
            type: Number,
            required: true
        }
    },
    setup(props: Props) {
        const payloads = computed(() => {
            return props.utxos.map((utxo) => {
                return getPayloadFromUTXO(utxo)
            })
        })

        const rotateDeg = computed(() => {
            if (!props.spread) {
                return 5
            } else {
                let len = payloads.value.length
                let maxLen = props.max
                return 25 * ((maxLen - len) / maxLen) + 5
            }
        })

        return {
            payloads,
            rotateDeg
        }
    }
})
</script>
<style scoped lang="scss">
.previews {
    display: flex;
    flex-grow: 1;
    position: relative;
    min-height: 70px;
    z-index: 1;
    //display: grid;
    //grid-template-columns: repeat(5, 1fr);
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
</style>
