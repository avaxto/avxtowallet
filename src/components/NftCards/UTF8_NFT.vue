<template>
    <BaseNftCard :mini="mini" :raw-card="rawCard" :utxo-id="utxo.getUTXOID()">
        <template v-slot:card>
            <div class="utf8_nft">
                <p>{{ text }}</p>
            </div>
        </template>
        <template v-slot:deck></template>
        <template v-slot:mini>
            <p><fa icon="quote-right"></fa></p>
        </template>
    </BaseNftCard>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { PayloadBase } from 'avalanche/dist/utils'
import BaseNftCard from '@/components/NftCards/BaseNftCard.vue'
import { UTXO } from 'avalanche/dist/apis/avm'

interface Props {
    payload: PayloadBase
    mini?: boolean
    rawCard?: boolean
    utxo: UTXO
}

export default defineComponent({
    name: 'UTF8_NFT',
    components: {
        BaseNftCard,
    },
    props: {
        payload: {
            type: Object as () => PayloadBase,
            required: true
        },
        mini: {
            type: Boolean,
            default: false
        },
        rawCard: {
            type: Boolean,
            default: false
        },
        utxo: {
            type: Object as () => UTXO,
            required: true
        }
    },
    setup(props: Props) {
        const text = computed((): string => {
            return props.payload.getContent().toString('utf-8')
        })

        return {
            text
        }
    }
})
</script>
<style scoped lang="scss">
.utf8_nft {
    word-break: normal;
    padding: 15px 12px;
    text-align: center;
}
</style>
