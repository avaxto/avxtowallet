<template>
    <div class="nft_col">
        <h4>{{ $t('top.balance.collectibles') }}</h4>
        <p v-if="isEmpty">{{ $t('top.nftempty') }}</p>
        <div v-else class="rows">
            <p>{{ statusText }}</p>
            <div class="nft_list">
                <div class="nft_item" v-for="(utxo, i) in nftArray" :key="utxo.getUTXOID()">
                    <NftPayloadView :payload="nftPayloads[i]" small="true"></NftPayloadView>
                </div>
                <div class="nft_item" v-for="item in erc721BalanceArray" :key="item.id">
                    <ERC721View :token="item.token" :index="item.id"></ERC721View>
                </div>
                <div v-for="i in dummyAmt" class="nft_item dummy_item" :key="i"></div>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { IWalletNftDict } from '@/store/types'
import { NFTTransferOutput, UTXO } from '@/avalanche/apis/avm'
import NftCard from '@/components/wallet/portfolio/NftCard.vue'
import NftPayloadView from '@/components/misc/NftPayloadView/NftPayloadView.vue'
import { PayloadBase } from '@/avalanche/utils'
import { Buffer } from '@/avalanche'
import { PayloadTypes } from '@/avalanche/utils'
import { bintools } from '@/AVA'
import NftFamilyCardsPreview from '@/components/misc/NftFamilyCardsPreview.vue'
import { ERC721WalletBalance } from '@/store/modules/assets/modules/types'
import ERC721View from '@/components/misc/ERC721View.vue'

const NFT_COUNT = 15

let payloadtypes = PayloadTypes.getInstance()

export default defineComponent({
    name: 'NftCol',
    components: {
        ERC721View,
        NftFamilyCardsPreview,
        NftCard,
        NftPayloadView,
    },
    setup() {
        const store = useStore()

        const isEmpty = computed((): boolean => {
            return nftArray.value.length + erc721BalanceArray.value.length === 0
        })

        const nftDict = computed((): IWalletNftDict => {
            return store.getters['Assets/walletNftDict']
        })

        const nftArray = computed((): UTXO[] => {
            let utxos: UTXO[] = store.state.Assets.nftUTXOs

            let ids: string[] = []
            // Filter same groups
            utxos = utxos.filter((utxo) => {
                let out = utxo.getOutput() as NFTTransferOutput
                let famId = bintools.cb58Encode(utxo.getAssetID())
                let groupId = out.getGroupID()

                let cacheId = `${famId}-${groupId}`
                if (ids.includes(cacheId)) {
                    return false
                } else {
                    ids.push(cacheId)
                    return true
                }
            })

            return utxos.slice(0, NFT_COUNT)
        })

        const nftPayloads = computed((): PayloadBase[] => {
            return nftArray.value.map((utxo) => {
                let out = utxo.getOutput() as NFTTransferOutput
                let payload = out.getPayloadBuffer()

                let typeId = payloadtypes.getTypeID(payload)
                let pl: Buffer = payloadtypes.getContent(payload)
                let payloadbase: PayloadBase = payloadtypes.select(typeId, pl)

                return payloadbase
            })
        })

        const erc721Balance = computed((): ERC721WalletBalance => {
            return store.state.Assets.ERC721.walletBalance
        })

        const erc721BalanceArray = computed(() => {
            // TODO: Remove after ledger support
            if (store.state.activeWallet.type === 'ledger') return []

            let res = []
            for (var tokenAddr in erc721Balance.value) {
                let erc721Token = store.getters['Assets/ERC721/find'](tokenAddr)
                let tokenIds = erc721Balance.value[tokenAddr]
                let tokens = tokenIds.map((id) => {
                    return {
                        token: erc721Token,
                        id: id,
                    }
                })
                res.push(...tokens)
            }
            return res.slice(0, NFT_COUNT - nftArray.value.length)
        })

        const dummyAmt = computed((): number => {
            return NFT_COUNT - (nftArray.value.length + erc721BalanceArray.value.length)
        })

        const collectedAmt = computed((): number => {
            let avmAmt = store.state.Assets.nftUTXOs.length
            let evmAmt = store.getters['Assets/ERC721/totalOwned']
            return avmAmt + evmAmt
        })

        const collectionAmt = computed((): number => {
            let avmFamsAmt = store.state.Assets.nftFams.length
            let evmFamsAmt = store.getters['Assets/ERC721/totalCollectionsOwned']
            return avmFamsAmt + evmFamsAmt
        })

        const statusText = computed((): string => {
            let res = `${collectedAmt.value} collected from ${collectionAmt.value} Collections`
            return res
        })

        return {
            isEmpty,
            nftDict,
            nftArray,
            nftPayloads,
            erc721Balance,
            erc721BalanceArray,
            dummyAmt,
            collectedAmt,
            collectionAmt,
            statusText
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../main';

.nft_col {
    p {
        font-size: 12px;
        color: var(--primary-color-light);
    }
}

$nft_w: 35px;

.nft_list {
    margin-top: 8px;
    grid-gap: 8px;
    display: grid;
    grid-template-columns: repeat(5, $nft_w);
}

.nft_item {
    position: relative;
    height: $nft_w;
    width: $nft_w;
    border-radius: 4px;
    overflow: hidden;
    background-color: var(--bg-light);
    display: flex;
    align-items: center;
    justify-content: center;
}

.dummy_item {
    opacity: 0.2;
}

.cards_cont {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}
</style>
