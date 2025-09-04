<template>
    <div class="collectible_tab">
        <p v-if="isEmpty" class="empty">
            {{ $t('wallet.collectibles.empty') }}
        </p>
        <div v-else>
            <CollectibleFamily
                v-for="fam in nftFamsDict"
                :family="fam"
                :key="fam.id"
                :disabled-ids="disabledIds"
                @select="selectNft"
            ></CollectibleFamily>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'
import NftCard from '@/components/wallet/portfolio/NftCard.vue'
import { NftFamilyDict } from '@/store/modules/assets/types'
import { UTXO } from 'avalanche/dist/apis/avm'

import CollectibleFamily from '@/components/misc/BalancePopup/CollectibleFamily.vue'

export default defineComponent({
    name: 'CollectibleTab',
    components: {
        NftCard,
        CollectibleFamily,
    },
    props: {
        disabledIds: {
            type: Array as () => string[],
            default: () => []
        }
    },
    emits: ['select'],
    setup(props, { emit }) {
        const store = useStore()
        const { t } = useI18n()

        const isEmpty = computed((): boolean => {
            return store.state.Assets.nftUTXOs.length === 0
        })

        const nftFamsDict = computed((): NftFamilyDict => {
            return store.state.Assets.nftFamsDict
        })

        const isNftUsed = (utxo: UTXO) => {
            return props.disabledIds.includes(utxo.getUTXOID())
        }

        const selectNft = (nft: UTXO) => {
            emit('select', nft)
        }

        return {
            isEmpty,
            nftFamsDict,
            isNftUsed,
            selectNft
        }
    }
})
</script>
<style scoped lang="scss">
.collectible_tab {
    padding: 12px 18px;
}

.empty {
    text-align: center;
    padding: 4px 12px;
}

$card_w: 40px;
.collectible_fam {
}

.fam_title {
    border-bottom: 2px solid var(--bg-light);
}

.card_grid {
    display: grid;
    grid-template-columns: repeat(5, $card_w);
    gap: 12px;
    padding: 8px 0;
}

.card {
    width: $card_w;
    height: $card_w;
    background-color: var(--bg-light);
    border-radius: 4px;
    overflow: hidden;
    transition-duration: 0.2s;
    cursor: pointer;
    border: 1px solid var(--bg-light);

    &:hover {
        border: 1px solid var(--secondary-color);
        transform: scale(1.1);
    }

    &[used] {
        opacity: 0.1;
        pointer-events: none;
        cursor: not-allowed;
    }
}
</style>
