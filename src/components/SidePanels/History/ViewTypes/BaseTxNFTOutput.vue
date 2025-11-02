<template>
    <div class="nft_output">
        <!--        <p class="fam_title">{{ assetDetail.name }}</p>-->
        <div class="fam_row">
            <tx-history-nft-family-group
                v-for="(utxos, groupNum) in groupDict"
                :asset-i-d="assetID"
                :utxos="utxos"
                :key="groupNum"
                class="fam_group"
            ></tx-history-nft-family-group>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, reactive, onMounted } from 'vue'
import { useStore } from '@/stores'
import { BaseTxAssetSummary, BaseTxNFTSummary } from '@/helpers/history_helper'
import AvaAsset from '@/js/AvaAsset'
import { bnToBig } from '@/helpers/helper'
import { BN } from '@/avalanche'
import { UTXO } from '@/store/modules/history/types'
import TxHistoryNftFamilyGroup from '@/components/SidePanels/TxHistoryNftFamilyGroup.vue'

interface GroupDict {
    [key: number]: UTXO[]
}

export default defineComponent({
    name: 'BaseTxNFTOutput',
    components: { 
        TxHistoryNftFamilyGroup 
    },
    props: {
        assetID: {
            type: String,
            required: true
        },
        summary: {
            type: Array as () => UTXO[],
            required: true
        }
    },
    setup(props) {
        const store = useStore()
        
        const groupDict = reactive<GroupDict>({})

        const assetDetail = computed((): AvaAsset => {
            return store.state.Assets.nftFamsDict[props.assetID]
        })

        onMounted(() => {
            let newGroupDict: GroupDict = {}
            props.summary.forEach((utxo) => {
                let groupID = utxo.groupID

                if (newGroupDict[groupID]) {
                    newGroupDict[groupID].push(utxo)
                } else {
                    newGroupDict[groupID] = [utxo]
                }
            })
            Object.assign(groupDict, newGroupDict)
        })

        const groups = computed((): number[] => {
            let gNums: number[] = []

            props.summary.forEach((utxo) => {
                let groupID = utxo.groupID

                if (!gNums.includes(groupID)) {
                    gNums.push(groupID)
                }
            })
            return gNums
        })

        return {
            assetDetail,
            groupDict,
            groups
        }
    }
})
</script>
<style scoped lang="scss">
.amount {
    text-align: right;
    white-space: nowrap;
    font-size: 15px;
    color: #d04c4c;

    &[profit] {
        color: var(--success);
    }
}

.fam_title {
    text-align: right;
    color: var(--primary-color-light);
}

.fam_row {
    display: flex;
    flex-direction: row;
    justify-content: flex-end;
}

.fam_group {
    margin-left: 4px;
}
</style>
