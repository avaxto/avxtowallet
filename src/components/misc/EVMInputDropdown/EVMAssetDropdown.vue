<template>
    <div class="evm_dropdown hover_border" :active="isPopup" :disabled="disabled">
        <button @click="showPopup" :disabled="disabled">
            {{ symbol }}
        </button>
        <EVMTokenSelectModal
            ref="select_modal"
            @select="select"
            @selectCollectible="selectERC721"
        ></EVMTokenSelectModal>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import Erc20Token from '@/js/Erc20Token'
import { WalletType } from '@/js/wallets/types'

import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'
import EVMTokenSelectModal from '@/components/modals/EvmTokenSelect/EVMTokenSelectModal.vue'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import ERC721Token from '@/js/ERC721Token'

export default defineComponent({
    name: 'EVMAssetDropdown',
    components: { 
        EVMTokenSelectModal 
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change', 'changeCollectible'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const select_modal = ref<InstanceType<typeof EVMTokenSelectModal>>()
        const isPopup = ref(false)
        const selected = ref<Erc20Token | ERC721Token | 'native'>('native')

        const symbol = computed(() => {
            if (selected.value === 'native') return 'AVAX'
            else return selected.value.data.symbol
        })

        const showPopup = () => {
            if (select_modal.value) {
                select_modal.value.open()
            }
        }

        const avaxBalance = computed((): Big => {
            let w: WalletType | null = mainStore.activeWallet
            if (!w) return Big(0)
            let balBN = w.ethBalance
            return bnToBig(balBN, 18)
        })

        const select = (token: Erc20Token | 'native') => {
            selected.value = token
            emit('change', token)
        }

        const clear = () => {
            select('native')
        }

        const selectERC721 = (val: iErc721SelectInput) => {
            selected.value = val.token
            emit('changeCollectible', val)
        }

        return {
            select_modal,
            isPopup,
            selected,
            symbol,
            showPopup,
            avaxBalance,
            select,
            clear,
            selectERC721
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../main";
.evm_dropdown {
    position: relative;
}

button {
    text-align: center;
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
}

.list {
    position: absolute;
    top: 0;
    left: 100%;
    width: 260px;
    max-height: 0px;
    overflow: scroll;
    z-index: 2;
    border-radius: 4px;
    box-shadow: 1px 1px 4px rgba(0, 0, 0, 0.1);
    background-color: var(--bg);
}

.token_row {
    font-size: 13px;
    padding: 8px 18px;
    display: grid;
    grid-template-columns: max-content max-content 1fr;
    column-gap: 12px;
    cursor: pointer;
    user-select: none;

    > * {
        align-self: center;
    }

    img {
        height: 24px;
        object-fit: contain;
    }

    &:hover {
        //background-color: rgba(var(--bg-1), 0.5);
        background-color: var(--bg-light);
    }
}

.evm_dropdown[active] {
    .list {
        max-height: 240px;
    }
}

.col_bal {
    text-align: right;
}

@include main.mobile-device {
    .list {
        border-top-right-radius: 14px;
        border-top-left-radius: 14px;
        position: fixed;
        width: 100%;
        bottom: 0;
        left: 0;
        top: unset;
        height: 40vh;
    }

    .token_row {
        font-size: 16px;
        border-bottom: 1px solid var(--bg-light);
        padding-top: 14px;
        padding-bottom: 14px;
        img {
            height: 30px;
        }
    }
}
</style>
