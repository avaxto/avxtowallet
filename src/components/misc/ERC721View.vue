<template>
    <div class="erc721_view">
        <img :src="parseURL(img)" v-if="!isError && img" />
        <div v-if="isError" class="err_cont">
            <p>
                <fa icon="unlink"></fa>
            </p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted, type PropType } from 'vue'
import ERC721Token from '@/js/ERC721Token'

// If an image url is hosted on one of these urls, reroute through cloudflare.
const REDIRECT_DOMAINS = ['gateway.pinata.cloud/ipfs']
const CF_IPFS_BASE = 'https://cloudflare-ipfs.com/ipfs/'

export default defineComponent({
    name: 'ERC721View',
    props: {
        index: {
            type: String,
            required: true
        },
        token: {
            type: Object as PropType<ERC721Token>,
            required: true
        }
    },
    setup(props) {
        const metadata = ref<any>({})
        const isError = ref(false)

        const img = computed(() => {
            let data = metadata.value
            if (!data) return null
            return data.img || data.image || null
        })

        const parseURL = (val: string) => {
            let isRedirect = REDIRECT_DOMAINS.reduce((acc, domain) => {
                if (acc) return acc
                if (val.includes(domain)) return true
                return false
            }, false)

            if (isRedirect) {
                let ipfsHash = val.split('ipfs/')[1]
                return CF_IPFS_BASE + ipfsHash
            }
            return val
        }

        const getData = async () => {
            try {
                metadata.value = await props.token.getTokenURIData(parseInt(props.index))
                isError.value = false
            } catch (e) {
                isError.value = true
            }
        }

        watch([() => props.token, () => props.index], () => {
            getData()
        })

        onMounted(() => {
            getData()
        })

        return {
            metadata,
            isError,
            img,
            parseURL,
            getData
        }
    }
})
</script>
<style scoped lang="scss">
.erc721_view {
    width: 100%;
    height: 100%;
}
img,
.err_cont {
    width: 100%;
    height: 100%;
    object-fit: contain;
}

.err_cont {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: #000;
    text-align: center;
}
</style>
