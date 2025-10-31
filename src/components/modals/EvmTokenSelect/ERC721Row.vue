<template>
    <div class="family_row" v-if="hasBalance">
        <div class="title_row">
            <p>{{ token.symbol }}</p>
            <p class="name">{{ token.name }}</p>
        </div>

        <div class="items">
            <ERC721View
                v-for="tokenIndex in walletBalance"
                :key="tokenIndex"
                class="item"
                :token="token"
                :index="tokenIndex"
                @click="selectToken(tokenIndex)"
            ></ERC721View>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import ERC721Token from '@/js/ERC721Token'
import ERC721View from '@/components/misc/ERC721View.vue'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import { ERC721WalletBalance } from '@/store/modules/assets/modules/types'

interface Props {
    token: ERC721Token
}

export default defineComponent({
    name: 'ERC721Row',
    components: { ERC721View },
    props: {
        token: {
            type: Object as () => ERC721Token,
            required: true
        }
    },
    emits: ['select'],
    setup(props: Props, { emit }) {
        const store = useStore()

        const walletBalance = computed((): string[] => {
            return store.state.Assets.ERC721.walletBalance[props.token.contractAddress] || []
        })

        const hasBalance = computed((): boolean => {
            return walletBalance.value.length > 0
        })

        const selectToken = (index: string) => {
            const data: iErc721SelectInput = {
                id: index,
                token: props.token,
            }
            emit('select', data)
        }

        return {
            walletBalance,
            hasBalance,
            selectToken
        }
    }
})
</script>
<style scoped lang="scss">
.family_row {
    display: flex !important;
    flex-direction: column;
}
p {
    margin-bottom: 4px;
}

.name {
    color: var(--primary-color-light);
    font-size: 13px;
}

.title_row {
    margin-bottom: 8px;
}
.items {
    display: grid;
    column-gap: 8px;
    grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));

    > * {
        cursor: pointer;
        &:hover {
            opacity: 0.4;
        }
    }
}
</style>
