<template>
    <div class="collectibles_view no_scroll_bar" @scroll="onScroll" :scroll="isScroll">
        <AddERC721TokenModal ref="addTokenModalRef"></AddERC721TokenModal>
        <div v-if="!isEmpty" class="list">
            <CollectibleFamilyRow
                v-for="fam in nftFamsArray"
                :key="fam.id"
                :family="fam"
            ></CollectibleFamilyRow>
            <ERC721FamilyRow
                v-for="token in erc721s"
                :key="token.contractAddress"
                :family="token"
            ></ERC721FamilyRow>
            <div class="add_token_row">
                <button @click="showModal">Add Collectible</button>
            </div>
        </div>
        <div class="coming_soon" v-else>
            <!--            <img v-if="$root.theme === 'day'" src="@/assets/nft_preview.png" />-->
            <!--            <img v-else src="@/assets/nft_preview_night.png" />-->
            <p>{{ $t('portfolio.nobalance_nft') }}</p>
            <div class="add_token_row">
                <button @click="showModal">Add Collectible</button>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import NFTCard from './NftCard.vue'
import CollectibleFamilyRow from '@/components/wallet/portfolio/CollectibleFamilyRow.vue'
import 'reflect-metadata'
import { defineComponent, ref, computed } from 'vue'
import { useAssetsStore, useErc721Store, useMainStore } from '@/stores'
import { IWalletNftDict, IWalletNftMintDict } from '@/types'
import { AvaNftFamily } from '@/js/AvaNftFamily'
import { NftFamilyDict } from '@/types'
import AddERC721TokenModal from '@/components/modals/AddERC721TokenModal.vue'
import ERC721Token from '@/js/ERC721Token'
import ERC721FamilyRow from '@/components/wallet/portfolio/ERC721FamilyRow.vue'
import { WalletType } from '@/js/wallets/types'

interface Props {
    search: string
}

export default defineComponent({
    name: 'Collectibles',
    components: {
        ERC721FamilyRow,
        AddERC721TokenModal,
        NFTCard,
        CollectibleFamilyRow,
    },
    props: {
        search: {
            type: String,
            required: true
        }
    },
    setup(props: Props) {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const erc721Store = useErc721Store()
        const addTokenModalRef = ref<AddERC721TokenModal>()
        const isScroll = ref(false)

        const isEmpty = computed((): boolean => {
            const nftUtxos = assetsStore.nftUTXOs.length
            const mintUTxos = assetsStore.nftMintUTXOs.length
            const erc721Bal = erc721Store.totalOwned
            return nftUtxos + mintUTxos + erc721Bal === 0
        })

        const nftDict = computed((): IWalletNftDict => {
            const dict = assetsStore.walletNftDict
            return dict
        })

        const nftMintDict = computed((): IWalletNftMintDict => {
            const dict = assetsStore.nftMintDict
            return dict
        })

        const nftFamsArray = computed(() => {
            let fams: AvaNftFamily[] = assetsStore.nftFams

            // If search query
            if (props.search) {
                const query = props.search
                fams = fams.filter((fam) => {
                    if (
                        fam.name.includes(query) ||
                        fam.id.includes(query) ||
                        fam.symbol.includes(query)
                    ) {
                        return true
                    }
                    return false
                })
            }

            fams.sort((a, b) => {
                const symbolA = a.symbol
                const symbolB = b.symbol

                if (symbolA < symbolB) {
                    return -1
                } else if (symbolA > symbolB) {
                    return 1
                }
                return 0
            })

            return fams
        })

        const nftFamsDict = computed((): NftFamilyDict => {
            const dict = assetsStore.nftFamsDict
            return dict
        })

        const erc721s = computed((): ERC721Token[] => {
            const w: WalletType = mainStore.activeWallet
            return erc721Store.networkContracts
        })

        const onScroll = (ev: any) => {
            const val = ev.target.scrollTop
            if (val > 0) {
                isScroll.value = true
            } else {
                isScroll.value = false
            }
        }

        const showModal = () => {
            addTokenModalRef.value?.open()
        }

        return {
            addTokenModalRef,
            isScroll,
            isEmpty,
            nftDict,
            nftMintDict,
            nftFamsArray,
            nftFamsDict,
            erc721s,
            onScroll,
            showModal
        }
    }
})
</script>
<style lang="scss" scoped>
@use '../../../main';
@use './portfolio';

$flip_dur: 0.6s;

.collectibles_view {
    height: 100%;
    overflow: scroll;
    transition-duration: 0.2s;
    border-top: 0px solid transparent;
    &[scroll] {
        border-top: 3px solid var(--bg-wallet);
    }
}

.list {
    max-height: 50px;
}

.coming_soon {
    padding-top: 60px;
    text-align: center;
    img {
        width: 100%;
        max-width: 560px;
    }

    p {
        font-weight: lighter;
        font-size: 28px;
        color: var(--primary-color-light);
    }
}

.nft_card {
    transition-duration: 0.3s;
    width: 140px;
    height: 220px;
}

@include main.mobile-device {
    .collectibles_view {
        height: 90vh;
    }
}
</style>
