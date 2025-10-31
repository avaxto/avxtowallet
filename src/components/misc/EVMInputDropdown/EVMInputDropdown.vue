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
                        @change="amount_in"
                        class="bigIn"
                        :disabled="disabled"
                    ></BigNumInput>
                    <p class="usd_val" :active="token === 'native'">
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
            ref="dropdown"
        ></EVMAssetDropdown>
        <div class="bal_col" v-if="!isCollectible">
            <p class="bal">Balance: {{ balance.toLocaleString() }}</p>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, nextTick } from 'vue'
import { useStore } from '@/stores'
//@ts-ignore
import { BigNumInput } from '@avalabs/vue_components'
import { BN } from 'avalanche'
import EVMAssetDropdown from '@/components/misc/EVMInputDropdown/EVMAssetDropdown.vue'
import Erc20Token from '@/js/Erc20Token'
import Big from 'big.js'
import { WalletType } from '@/js/wallets/types'

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
        const store = useStore()
        
        const bigIn = ref<InstanceType<typeof BigNumInput>>()
        const dropdown = ref<InstanceType<typeof EVMAssetDropdown>>()
        
        const token = ref<Erc20Token | 'native'>('native')
        const isCollectible = ref(false)
        const collectible = ref<iErc721SelectInput | null>(null)
        const amt = ref(new BN(0))

        const clear = () => {
            if (dropdown.value) {
                dropdown.value.clear()
            }
        }

        const usd_val = computed((): Big => {
            if (token.value != 'native') return Big(0)

            let price = store.state.prices.usd
            let big = bnToBig(amt.value, 18)
            return big.mul(Big(price))
        })

        const isNative = computed(() => {
            return token.value === 'native'
        })

        const denomination = computed((): number => {
            if (isNative.value) {
                return 18
            } else {
                return parseInt((token.value as Erc20Token).data.decimals as string)
            }
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
            let w: WalletType | null = store.state.activeWallet
            if (!w) return new BN(0)
            return w.ethBalance
        })

        const avaxBalance = computed((): Big => {
            return bnToBig(avaxBalanceBN.value, 18)
        })

        const balance = computed((): Big => {
            if (token.value === 'native') {
                return avaxBalance.value
            }
            return token.value.balanceBig
        })

        const balanceBN = computed((): BN => {
            if (token.value === 'native') {
                return avaxBalanceBN.value
            }
            return token.value.balanceBN
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

        const setToken = (tokenValue: 'native' | Erc20Token) => {
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

        const onAssetChange = (tokenValue: Erc20Token | 'native') => {
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
    grid-template-columns: 1fr 90px;
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
