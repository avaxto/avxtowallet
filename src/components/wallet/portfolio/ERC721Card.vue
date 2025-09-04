<template>
    <div class="nft_card">
        <ERC721ViewModal :token="token" :token-id="index" ref="viewModalRef"></ERC721ViewModal>
        <div class="view">
            <template v-if="!isRaw && img">
                <ERC721View :token="token" :index="index"></ERC721View>
            </template>
            <template v-else>
                <div class="raw_view no_scroll_bar">
                    <p>{{ metadata }}</p>
                </div>
            </template>
        </div>
        <div class="nft_info">
            <div class="meta_bar">
                <div>
                    <p>ERC721</p>
                </div>
                <div>
                    <button @click="toggleRaw" :active="isRaw" class="raw_toggle">SOURCE</button>
                    <Tooltip
                        :text="$t('portfolio.collectibles.send')"
                        @click="transfer"
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
            <div class="generic_nft_meta" v-if="name || description">
                <p class="nft_title" v-if="name">
                    {{ name }}
                </p>
                <p class="nft_desc" v-if="description">
                    {{ description }}
                </p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import axios from 'axios'
import Tooltip from '@/components/misc/Tooltip.vue'
import ERC721Token from '@/js/ERC721Token'
import ERC721View from '@/components/misc/ERC721View.vue'
import ERC721ViewModal from '@/components/modals/ERC721ViewModal.vue'

interface Props {
    index: string
    token: ERC721Token
}

export default defineComponent({
    name: 'ERC721Card',
    components: { ERC721ViewModal, ERC721View, Tooltip },
    props: {
        index: {
            type: String,
            required: true
        },
        token: {
            type: Object as () => ERC721Token,
            required: true
        }
    },
    setup(props: Props) {
        const router = useRouter()
        const viewModalRef = ref<ERC721ViewModal>()
        
        const metadata = ref<any>('')
        const isRaw = ref(false)

        const img = computed(() => {
            const data = metadata.value
            if (!data) return null
            return data.img || data.image || null
        })

        const name = computed(() => {
            return metadata.value?.name
        })

        const description = computed(() => {
            return metadata.value?.description
        })

        const getData = async () => {
            try {
                const uri = await props.token.getTokenURI(parseInt(props.index))
                metadata.value = (await axios.get(uri)).data
            } catch (e) {
                metadata.value = null
            }
        }

        const transfer = (ev: any) => {
            ev.stopPropagation()
            router.push({
                path: '/wallet/transfer',
                query: {
                    chain: 'C',
                    token: props.token.contractAddress,
                    tokenId: props.index,
                },
            })
        }

        const expand = () => {
            viewModalRef.value?.open()
        }

        const toggleRaw = () => {
            isRaw.value = !isRaw.value
        }

        onMounted(() => {
            getData()
        })

        return {
            viewModalRef,
            metadata,
            isRaw,
            img,
            name,
            description,
            getData,
            transfer,
            expand,
            toggleRaw
        }
    }
})
</script>
<style scoped lang="scss">
@use 'nft_card';

img {
    width: 100%;
    object-fit: contain;
}

.raw_view {
    overflow: scroll;
    background-color: #000;
    height: 100%;
    padding: 12px;
    font-size: 12px;
    word-break: break-all;
    color: #0f0;
    font-family: monospace !important;
}

.raw_toggle {
    &[active] {
        color: var(--secondary-color) !important;
        opacity: 1 !important;
        font-weight: bold;
    }
}
</style>
