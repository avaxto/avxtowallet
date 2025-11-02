<template>
    <div class="nft_card">
        <p class="count" v-if="quantity > 1">{{ quantity }}</p>
        <NFTViewModal ref="modal" :payload="payload"></NFTViewModal>
        <NftPayloadView :payload="payload" class="view"></NftPayloadView>
        <div class="nft_info">
            <div class="meta_bar">
                <div>
                    <p>
                        <b>{{ $t('portfolio.collectibles.group') }}:</b>
                        {{ groupID }}
                    </p>
                    <p style="margin-left: 6px !important">{{ payloadTypeName }}</p>
                </div>

                <div>
                    <Tooltip
                        :text="$t('portfolio.collectibles.send')"
                        @click="transfer"
                        v-if="utxo"
                        class="nft_button"
                    >
                        <fa icon="share"></fa>
                    </Tooltip>
                    <Tooltip
                        :text="$t('portfolio.collectibles.expand')"
                        @click="expand"
                        class="nft_button"
                    >
                        <fa icon="expand"></fa>
                    </Tooltip>
                </div>
            </div>
            <div class="generic_nft_meta" v-if="nftTitle || nftDesc">
                <p class="nft_title" v-if="nftTitle">
                    {{ nftTitle }}
                </p>
                <p class="nft_desc" v-if="nftDesc">
                    {{ nftDesc }}
                </p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, type PropType } from 'vue'
import { useRouter } from 'vue-router'
import { PayloadTypes, PayloadBase } from '@/avalanche/utils'

const payloadtypes = PayloadTypes.getInstance()

import Tooltip from '@/components/misc/Tooltip.vue'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import NFTViewModal from '@/components/modals/NFTViewModal.vue'
import { UTXO } from '@/avalanche/apis/avm'

export default defineComponent({
    name: 'NftCard',
    components: { NFTViewModal, NftPayloadView, Tooltip },
    props: {
        payload: {
            type: Object as PropType<PayloadBase>,
            required: true
        },
        quantity: {
            type: Number,
            default: 1
        },
        groupID: {
            type: Number,
            required: true
        },
        utxo: {
            type: Object as PropType<UTXO>,
            required: false
        }
    },
    setup(props) {
        const router = useRouter()

        const modal = ref<InstanceType<typeof NFTViewModal>>()

        const transfer = (ev: MouseEvent) => {
            ev.stopPropagation()
            if (!props.utxo) return

            let utxoId = props.utxo.getUTXOID()
            router.push({
                path: '/wallet/transfer',
                query: {
                    nft: utxoId,
                    chain: 'X',
                },
            })
        }

        const expand = () => {
            modal.value?.open()
        }

        const payloadTypeID = computed(() => {
            return props.payload.typeID()
        })

        const payloadTypeName = computed(() => {
            return payloadtypes.lookupType(payloadTypeID.value) || 'Unknown Type'
        })

        const payloadContent = computed(() => {
            return props.payload.getContent().toString()
        })

        const nftTitle = computed(() => {
            try {
                let json = JSON.parse(payloadContent.value)
                return json.avalanche.title
            } catch (err) {
                return ''
            }
        })

        const nftDesc = computed(() => {
            try {
                let json = JSON.parse(payloadContent.value)
                return json.avalanche.desc
            } catch (err) {
                return ''
            }
        })

        return {
            modal,
            transfer,
            expand,
            payloadTypeID,
            payloadTypeName,
            payloadContent,
            nftTitle,
            nftDesc
        }
    }
})
</script>
<style scoped lang="scss">
@use 'nft_card';
</style>
