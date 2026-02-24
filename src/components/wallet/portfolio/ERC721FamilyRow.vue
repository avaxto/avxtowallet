<template>
    <div v-if="hasBalance || !family.canSupport">
        <div class="fam_header">
            <p class="name">{{ family.name }}</p>
            <p class="symbol">{{ family.symbol }}</p>
            <p class="fam_id">{{ family.contractAddress }}</p>
        </div>
        <div class="list" v-if="family.canSupport">
            <ERC721View
                v-for="tokenIndex in walletBalance"
                :key="tokenIndex"
                class="group"
                :index="tokenIndex"
                :token="family"
            ></ERC721View>
        </div>
        <div v-else>
            <p>This ERC721 Contract does not support the required interfaces.</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useAssetsStore, useErc721Store } from '@/stores'
import ERC721Token from '@/js/ERC721Token'
import { WalletType } from '@/js/wallets/types'
import ERC721View from '@/components/wallet/portfolio/ERC721Card.vue'
import { ERC721WalletBalance } from '@/types'

interface Props {
    family: ERC721Token
}

export default defineComponent({
    name: 'ERC721FamilyRow',
    components: { ERC721View },
    props: {
        family: {
            type: Object as () => ERC721Token,
            required: true
        }
    },
    setup(props: Props) {
        const assetsStore = useAssetsStore()
        const erc721Store = useErc721Store()
        const walletBalance = computed((): string[] => {
            return erc721Store.walletBalance[props.family.contractAddress] || []
        })

        const hasBalance = computed(() => {
            return walletBalance.value.length > 0
        })

        return {
            walletBalance,
            hasBalance
        }
    }
})
</script>
<style scoped lang="scss">
@use "tokens";
</style>
