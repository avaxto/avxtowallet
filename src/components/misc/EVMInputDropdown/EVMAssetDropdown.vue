<template>
    <div class="evm_dropdown hover_border" :active="isPopup" :disabled="disabled">
        <button @click="showPopup" :disabled="disabled">
            Transferring {{ symbol }} (Click to Change)
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
import { Wallet } from '@/js/wallets/AbstractWallet'

import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'
import EVMTokenSelectModal from '@/components/modals/EvmTokenSelect/EVMTokenSelectModal.vue'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import ERC721Token from '@/js/ERC721Token'
import type { EvmPortfolioToken } from '@/stores/evmPortfolio'

export default defineComponent({
    name: 'EVMAssetDropdown',
    components: { 
        EVMTokenSelectModal 
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        },
        /** Symbol to show while `selected` is `'native'`. */
        nativeSymbol: {
            type: String,
            default: 'AVAX'
        }
    },
    emits: ['change', 'changeCollectible'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const select_modal = ref<InstanceType<typeof EVMTokenSelectModal>>()
        const isPopup = ref(false)
        const selected = ref<Erc20Token | ERC721Token | EvmPortfolioToken | 'native'>('native')

        const symbol = computed(() => {
            if (selected.value === 'native') return props.nativeSymbol
            // Avalanche's Erc20Token/ERC721Token wrap their metadata in
            // `.data`; an EvmPortfolioToken is flat.
            return 'data' in selected.value
                ? selected.value.data.symbol
                : selected.value.symbol
        })

        const showPopup = () => {
            if (select_modal.value) {
                select_modal.value.open()
            }
        }

        const avaxBalance = computed((): Big => {
            let w: Wallet | null = mainStore.activeWallet
            if (!w) return Big(0)
            let balBN = w.ethBalance
            return bnToBig(balBN, 18)
        })

        const select = (token: Erc20Token | EvmPortfolioToken | 'native') => {
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
    // A button's intrinsic content width doesn't shrink to fit a CSS grid
    // track on its own (grid items default to min-width: auto) — without
    // this the "Transferring X (Click to Change)" label blows out past
    // whatever column EVMInputDropdown gives it instead of wrapping inside
    // it.
    min-width: 0;
}

button {
    // A <button> has an intrinsic min-width based on its own unwrapped text
    // (form/replaced elements ignore `width: 100%` shrink-to-fit by default,
    // regardless of a parent's own `min-width: 0`) — without this here too,
    // "Transferring X (Click to Change)" keeps forcing itself wider than the
    // 110px grid column EVMInputDropdown.vue caps it at, spilling past the
    // button's own border instead of wrapping inside it.
    min-width: 0;
    box-sizing: border-box;
    width: 100%;
    text-align: center;
    top: 0;
    left: 0;
    font-weight: bold;
    font-size: 14px;
    line-height: 1.3;
    white-space: normal;
    overflow-wrap: break-word;
    border-radius: 4px;
    padding: 4px 10px;
    // `--primary-color` is a light, text-intended token (near-white, meant to
    // sit on the app's dark background) — used here as the button's own
    // background, so its paired text must be dark, matching how
    // `.button_primary` (_main.scss) pairs the same background with
    // `var(--bg)` rather than white.
    background-color: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--bg);
    border: 1px solid var(--bg-light) !important;
    cursor: pointer;
    transition: background-color 0.15s, border-color 0.15s;

    &:hover:not(:disabled) {
        background-color: var(--secondary-color);
        border-color: var(--secondary-color);
        // `--secondary-color` is the platform accent — a high-luminance
        // chartreuse on the EVM platform's theme — so, same as
        // `.button_secondary` (_main.scss), the text has to follow
        // `--platform-on-accent` rather than a hardcoded white, or it reads
        // as white-on-yellow.
        color: var(--platform-on-accent, #fff);
    }

    &:disabled {
        opacity: 0.6;
        cursor: default;
    }
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
