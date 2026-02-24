<template>
    <div class="families">
        <FamilyRow
            v-for="(utxos, assetId) in nftMintDict"
            :key="assetId"
            :family="nftFamsDict[assetId]"
            @select="select"
        ></FamilyRow>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useAssetsStore } from '@/stores'

import { IWalletNftMintDict } from '@/types'
import { NftFamilyDict } from '@/types'
import { UTXO } from '@/avalanche/apis/avm'
import FamilyRow from '@/components/wallet/studio/mint/SelectMintUtxo/FamilyRow.vue'

export default defineComponent({
    name: 'SelectMintUTXO',
    components: { FamilyRow },
    emits: ['change'],
    setup(props, { emit }) {
        const assetsStore = useAssetsStore()
        const nftFamsDict = computed((): NftFamilyDict => {
            return assetsStore.nftFamsDict
        })

        const nftMintDict = computed((): IWalletNftMintDict => {
            return assetsStore.nftMintDict
        })

        const select = (utxo: UTXO) => {
            emit('change', utxo)
        }

        return {
            nftFamsDict,
            nftMintDict,
            select
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../../main';

.families {
    grid-template-columns: repeat(5, 1fr);
    padding: 30px 0;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-evenly;

    > div {
        width: 230px;
    }
}

@include main.medium-device {
    .families {
        grid-template-columns: repeat(3, 1fr);
    }
}

@include main.mobile-device {
    .families {
        grid-template-columns: repeat(2, 1fr);
    }
}
</style>
