<template>
    <div class="nft_family_row" v-if="allUtxos.length">
        <div class="fam_header">
            <p class="name">{{ family.name }}</p>
            <p class="symbol">{{ family.symbol }}</p>
            <p class="fam_id">{{ family.id }}</p>
        </div>
        <div class="list">
            <CollectibleFamilyGroup
                v-for="(group, id) in groupDict"
                :key="id"
                :utxos="group"
                class="group"
            ></CollectibleFamilyGroup>
            <div v-if="canMint" class="group mint_card">
                <p>
                    {{ $t('portfolio.collectibles.mint_more') }}
                </p>
                <v-btn class="button_secondary" small depressed :to="mintUrl">
                    {{ $t('portfolio.collectibles.mint_submit') }}
                </v-btn>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import NFTCard from './NftCard.vue'
import { IWalletNftDict, IWalletNftMintDict } from '@/store/types'
import { NFTTransferOutput, UTXO, AVMConstants, NFTMintOutput } from 'avalanche/dist/apis/avm'
import { NftGroupDict } from '@/components/wallet/portfolio/types'
import CollectibleFamilyGroup from '@/components/wallet/portfolio/CollectibleFamilyGroup.vue'

export default defineComponent({
    name: 'CollectibleFamilyRow',
    components: {
        NFTCard,
        CollectibleFamilyGroup,
    },
    props: {
        family: {
            type: Object as () => AvaNftFamily,
            required: true
        }
    },
    setup(props) {
        const store = useStore()

        const nftDict = computed((): IWalletNftDict => {
            return store.getters['Assets/walletNftDict']
        })

        const nftMintDict = computed((): IWalletNftMintDict => {
            return store.getters['Assets/nftMintDict']
        })

        const utxos = computed((): UTXO[] => {
            return nftDict.value[props.family.id] || []
        })

        const mintUtxos = computed((): UTXO[] => {
            return nftMintDict.value[props.family.id] || []
        })

        const canMint = computed(() => {
            return mintUtxos.value.length > 0
        })

        const groupDict = computed((): NftGroupDict => {
            let dict: NftGroupDict = {}
            for (var i = 0; i < utxos.value.length; i++) {
                let utxo = utxos.value[i]
                let out = utxo.getOutput() as NFTTransferOutput
                let groupId = out.getGroupID()

                let target = dict[groupId]
                if (target) {
                    target.push(utxo)
                } else {
                    dict[groupId] = [utxo]
                }
            }
            return dict
        })

        const allUtxos = computed((): UTXO[] => {
            return utxos.value.concat(mintUtxos.value)
        })

        const mintUrl = computed(() => {
            if (mintUtxos.value.length === 0) return ''
            let mintUtxo = mintUtxos.value[0]

            return `/wallet/studio?utxo=${mintUtxo.getUTXOID()}`
        })

        const groupIds = computed((): number[] => {
            let ids: number[] = allUtxos.value.map((val) => {
                let id = val.getOutput().getOutputID()
                if (id === AVMConstants.NFTMINTOUTPUTID) {
                    let out = val.getOutput() as NFTMintOutput
                    return out.getGroupID()
                } else {
                    let out = val.getOutput() as NFTTransferOutput
                    return out.getGroupID()
                }
            })

            let idsUnique = ids.filter((val, index) => {
                return ids.indexOf(val) === index
            })

            idsUnique.sort((a, b) => {
                return a - b
            })

            return idsUnique
        })

        return {
            nftDict,
            nftMintDict,
            utxos,
            mintUtxos,
            canMint,
            groupDict,
            allUtxos,
            mintUrl,
            groupIds
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';
@use "tokens";

.mint_card {
    font-size: 13px;
    border: 1px dashed var(--primary-color-light);
    padding: 12px 12px;
    color: var(--primary-color);
    display: flex;
    height: 100%;
    flex-direction: column;
    justify-content: space-between;
}

@include main.medium-device {
}

@include main.mobile-device {
    .fam_header {
        grid-template-columns: max-content 1fr;
    }
    .fam_id {
        grid-column: 1/3;
        text-align: left;
    }
    .mint_card {
        height: max-content;
    }
    .list {
        grid-template-columns: 1fr;
    }
}
</style>
