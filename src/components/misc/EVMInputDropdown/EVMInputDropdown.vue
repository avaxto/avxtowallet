<template>
    <div class="evm_input_dropdown">
        <div class="col_in hover_border" :disabled="disabled">
            <template v-if="!isCollectible">
                <button class="max_but" @click="maxOut" :disabled="disabled">MAX</button>
                <div class="col_big_in">
                    <BigNumInput
                        :max="max_amount"
                        :denomination="denomination"
                        :step="stepSize"
                        :placeholder="placeholder"
                        ref="bigIn"
                        @update:modelValue="amount_in"
                        class="bigIn"
                        :disabled="disabled"
                    ></BigNumInput>
                    <p class="usd_val" :active="token === 'native' && !isGeneralEvm">
                        ${{ usd_val.toLocaleString(2) }}
                    </p>
                </div>
            </template>
            <template v-else>
                <ERC721View
                    :token="collectible.token"
                    :index="collectible.id"
                    class="collectible_item"
                ></ERC721View>
                <p style="align-self: center; padding-left: 12px">TOKEN ID: {{ collectible.id }}</p>
            </template>
        </div>
        <EVMAssetDropdown
            @change="onAssetChange"
            @changeCollectible="onCollectibleChange"
            :disabled="disabled"
            :native-symbol="nativeSymbol"
            ref="dropdown"
        ></EVMAssetDropdown>
        <div class="bal_col" v-if="!isCollectible">
            <p class="bal">Balance: {{ balance.toLocaleString() }}</p>
        </div>
    </div>
</template>
<script lang="ts">

import { defineComponent, ref, shallowRef, computed, nextTick, toRaw } from 'vue'
import { useMainStore } from '@/stores'
//@ts-ignore
import { BigNumInput } from '@/vue_components'
import { BN } from '@/avalanche'
import { bigToBN } from '@/avalanche-wallet-sdk'
import EVMAssetDropdown from '@/components/misc/EVMInputDropdown/EVMAssetDropdown.vue'
import Erc20Token from '@/js/Erc20Token'
import type { EvmPortfolioToken } from '@/stores/evmPortfolio'
import Big from 'big.js'
import { Wallet } from '@/js/wallets/AbstractWallet'
import { useActivePlatformStore } from '@/platforms'
import { useEvmStore } from '@/platforms/evm/store'

import { bnToBig } from '@/helpers/helper'
import EVMTokenSelectModal from '@/components/modals/EvmTokenSelect/EVMTokenSelectModal.vue'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import ERC721View from '@/components/misc/ERC721View.vue'
import ERC721Token from '@/js/ERC721Token'

export default defineComponent({
    name: 'EVMInputDropdown',
    components: {
        ERC721View,
        EVMTokenSelectModal,
        EVMAssetDropdown,
        BigNumInput,
    },
    props: {
        disabled: {
            type: Boolean,
            default: false
        },
        gasPrice: {
            type: Object as () => BN,
            required: true
        },
        gasLimit: {
            type: Number,
            default: 21000
        }
    },
    emits: ['tokenChange', 'collectibleChange', 'amountChange'],
    setup(props, { emit }) {
        const mainStore = useMainStore()
        const platformStore = useActivePlatformStore()
        const evmStore = useEvmStore()
        const bigIn = ref<InstanceType<typeof BigNumInput>>()
        const dropdown = ref<InstanceType<typeof EVMAssetDropdown>>()

        // True on the generalized EVM platform (Optimism, Polygon, BNB, …)
        // rather than Avalanche's own C-Chain — its wallet and balance live in
        // a different store, so every native-asset read below has to branch.
        const isGeneralEvm = computed(
            (): boolean => platformStore.activePlatform?.descriptor.id === 'evm'
        )

        const nativeSymbol = computed((): string =>
            isGeneralEvm.value ? evmStore.network.native.symbol : 'AVAX'
        )

        const token = ref<Erc20Token | EvmPortfolioToken | 'native'>('native')
        const isCollectible = ref(false)
        const collectible = ref<iErc721SelectInput | null>(null)
        const amt = shallowRef(new BN(0))

        const clear = () => {
            if (dropdown.value) {
                dropdown.value.clear()
            }
        }

        const usd_val = computed((): Big => {
            if (token.value != 'native') return Big(0)
            // mainStore.prices.usd is Avalanche's AVAX price — applying it to
            // any other chain's native asset would show a fabricated number,
            // not just a missing one. There is no multi-chain price feed wired
            // up yet, so this is honestly blank until there is one.
            if (isGeneralEvm.value) return Big(0)

            let price = mainStore.prices.usd
            if (typeof price !== 'number' || isNaN(price)) {
                return Big(0)
            }
            let big = bnToBig(toRaw(amt.value), 18)
            return big.mul(Big(price))
        })

        const isNative = computed(() => {
            return token.value === 'native'
        })

        const denomination = computed((): number => {
            if (isNative.value) {
                return 18
            }
            const t = token.value as Erc20Token | EvmPortfolioToken
            // EvmPortfolioToken carries decimals read from the contract
            // itself; Erc20Token keeps them (as a string) under `.data`.
            return 'data' in t ? parseInt(t.data.decimals as string) : t.decimals
        })

        const stepSize = computed((): BN => {
            if (denomination.value > 3) {
                let powBN = new BN(10).pow(new BN(denomination.value - 2))
                return powBN
            } else {
                let powBN = new BN(10).pow(new BN(denomination.value))
                return powBN
            }
        })

        const asset_now = computed(() => {
            return {
                denomination: 2,
            }
        })

        const placeholder = computed((): string => {
            let deno = denomination.value
            let res = '0'
            if (deno > 2) {
                res = '0.00'
            }
            return res
        })

        const avaxBalanceBN = computed((): BN => {
            if (isGeneralEvm.value) {
                return bigToBN(evmStore.nativeBalance, evmStore.network.native.decimals)
            }
            let w: Wallet | null = mainStore.activeWallet
            if (!w) return new BN(0)
            return w.ethBalance
        })

        const avaxBalance = computed((): Big => {
            return bnToBig(toRaw(avaxBalanceBN.value), 18)
        })

        const balance = computed((): Big => {
            if (token.value === 'native') {
                return avaxBalance.value
            }
            const t = token.value
            return 'data' in t ? t.balanceBig : t.balance
        })

        const balanceBN = computed((): BN => {
            if (token.value === 'native') {
                return avaxBalanceBN.value
            }
            const t = token.value
            // EvmPortfolioToken keeps the unscaled integer as a decimal
            // string (`raw`) rather than a BN, since it never passes through
            // Avalanche's BN-based helpers.
            return 'data' in t ? t.balanceBN : new BN(t.raw)
        })

        const max_amount = computed((): BN => {
            // Subtract gas
            if (isNative.value) {
                let limit = new BN(props.gasLimit)
                let fee = limit.mul(props.gasPrice)
                return balanceBN.value.sub(fee)
            } else {
                return balanceBN.value
            }
        })

        const maxOut = () => {
            if (bigIn.value) {
                bigIn.value.maxout()
            }
        }

        const setToken = (tokenValue: 'native' | Erc20Token | EvmPortfolioToken) => {
            if (dropdown.value) {
                dropdown.value.select(tokenValue)
            }
        }

        const setErc721Token = (tokenValue: ERC721Token, tokenId: string) => {
            if (dropdown.value) {
                dropdown.value.selectERC721({
                    token: tokenValue,
                    id: tokenId,
                })
            }
        }

        const onAssetChange = (tokenValue: Erc20Token | EvmPortfolioToken | 'native') => {
            isCollectible.value = false
            token.value = tokenValue
            nextTick(() => {
                if (bigIn.value) {
                    bigIn.value.clear()
                }
            })
            emit('tokenChange', tokenValue)
        }

        const onCollectibleChange = (val: iErc721SelectInput) => {
            isCollectible.value = true
            collectible.value = val
            emit('collectibleChange', val)
        }

        const amount_in = (amtValue: BN) => {
            amt.value = amtValue
            emit('amountChange', amtValue)
        }

        return {
            bigIn,
            dropdown,
            isGeneralEvm,
            nativeSymbol,
            token,
            isCollectible,
            collectible,
            amt,
            clear,
            usd_val,
            max_amount,
            isNative,
            denomination,
            stepSize,
            asset_now,
            placeholder,
            avaxBalanceBN,
            avaxBalance,
            balance,
            balanceBN,
            maxOut,
            setToken,
            setErc721Token,
            onAssetChange,
            onCollectibleChange,
            amount_in
        }
    }
})
</script>
<style scoped lang="scss">
.evm_input_dropdown {
    display: grid;
    // minmax(0, …) — not a bare px value — so the token button's label
    // ("Transferring X (Click to Change)") wraps inside this column instead
    // of forcing it wider (grid tracks default to min-width: auto, sized to
    // the child's un-wrapped content).
    grid-template-columns: 1fr minmax(0, 110px);
    column-gap: 10px;
    font-size: 15px;

    > div {
        border-radius: 3px;
        background-color: var(--bg-light);
        padding: 8px 14px;
    }
}

.col_in {
    position: relative;
    display: grid;
    grid-template-columns: max-content 1fr;
}

.col_big_in {
    text-align: right;
    font-family: monospace;
    display: flex;
    flex-direction: column;
}

.bigIn {
    border: none !important;
    color: var(--primary-color);
}

.bal_col {
    background-color: transparent !important;
    padding-top: 2px !important;
}

.bal {
    text-align: right;
    font-family: monospace;
    color: var(--primary-color-light);
}

.usd_val {
    color: var(--primary-color-light);
    font-size: 13px;
    max-height: 0px;
    overflow: hidden;
    transition-duration: 0.2s;

    &[active] {
        max-height: 20px;
    }
}
.max_but {
    opacity: 0.4;
    font-size: 13px;
    &:hover {
        opacity: 1;
    }
}

.collectible_item {
    height: 40px;
    width: 40px;
}
</style>
