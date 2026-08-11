<template>
    <modal ref="modal" title="Select Token" class="modal_main">
        <div class="token_select_body">
            <TokenListPicker
                :tokens="heldTokens"
                :loading="loading"
                @select="onPick"
            ></TokenListPicker>
            <div class="nft_list">
                <ERC721Row
                    class="nft_row"
                    v-for="t in erc721s"
                    :key="t.contractAddress"
                    :token="t"
                    @select="onERC721Select"
                ></ERC721Row>
            </div>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useErc721Store } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import ERC721Token from '@/js/ERC721Token'
import ERC721Row from '@/components/modals/EvmTokenSelect/ERC721Row.vue'
import TokenListPicker from '@/components/misc/TokenListPicker.vue'
import { useHeldErc20Tokens, HeldToken } from '@/composables/useHeldErc20Tokens'
import { resolveErc20Token } from '@/helpers/erc20_resolve'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'

export default defineComponent({
    name: 'EVMTokenSelectModal',
    components: {
        ERC721Row,
        Modal,
        TokenListPicker,
    },
    emits: ['select', 'selectCollectible'],
    setup(props, { emit }) {
        const erc721Store = useErc721Store()
        const modal = ref<InstanceType<typeof Modal> | null>(null)

        const open = (): void => {
            modal.value?.open()
        }

        // Merges the assets store's "Default Assets" with tokens
        // auto-discovered via the Glacier/chainkit SDK ("All Assets"), same
        // as the swap page's source-token picker — a token that only shows
        // up on the portfolio page through SDK discovery is still
        // selectable here instead of silently missing from the list.
        const { tokens: heldTokens, loading } = useHeldErc20Tokens()

        const erc721s = computed((): ERC721Token[] => erc721Store.networkContracts)

        const onPick = async (t: HeldToken) => {
            if (t.isNative) {
                emit('select', 'native')
                close()
                return
            }
            const token = await resolveErc20Token(t.address, {
                name: t.name,
                symbol: t.symbol,
                decimals: t.decimals,
                logoUri: t.logoUri,
            })
            emit('select', token)
            close()
        }

        const onERC721Select = (val: iErc721SelectInput) => {
            emit('selectCollectible', val)
            close()
        }

        const close = () => {
            modal.value?.close()
        }

        return {
            modal,
            open,
            heldTokens,
            loading,
            erc721s,
            onPick,
            onERC721Select,
            close,
        }
    },
})
</script>
<style scoped lang="scss">
@use '../../../main';

.token_select_body {
    width: 420px;
    max-width: 100%;
}

.nft_row {
    padding: 10px 20px;
    border-top: 1px solid var(--bg-light);
}

@include main.mobile-device {
    .token_select_body {
        width: 100%;
        height: 40vh;
        overflow: scroll;
    }
}
</style>
