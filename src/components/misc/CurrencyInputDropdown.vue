<template>
    <div>
        <div class="curr_in_drop">
            <div class="max_in_cont hover_border">
                <button class="max_but" @click="maxOut" :disabled="disabled">MAX</button>
                <div class="col_big_in">
                    <big-num-input
                        ref="bigIn"
                        @change="amount_in"
                        class="bigIn"
                        contenteditable="bigIn"
                        :max="max_amount"
                        :denomination="denomination"
                        :step="stepSize"
                        :placeholder="placeholder"
                        :disabled="disabled"
                    ></big-num-input>
                    <p class="usd_val" :active="isAvax">${{ amountUSD.toLocaleString(2) }}</p>
                </div>
            </div>
            <BalanceDropdown
                :disabled_assets="disabled_assets"
                v-model="asset_now"
                :disabled="disabled"
            ></BalanceDropdown>
            <div class="col_balance">
                <p>
                    {{ $t('misc.balance') }}:
                    {{ maxAmountBig.toLocaleString(denomination) }}
                </p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useStore } from '@/stores'

import { BN } from '@/avalanche'
// import Big from 'big.js';
import Dropdown from '@/components/misc/Dropdown.vue'
// import BigNumInput from "@/components/misc/BigNumInput";

// @ts-ignore
import { BigNumInput } from '@avalabs/vue_components'
import AvaAsset from '@/js/AvaAsset'
import { ICurrencyInputDropdownValue } from '@/components/wallet/transfer/types'
import { IWalletAssetsDict, IWalletBalanceDict, priceDict } from '@/store/types'

import BalanceDropdown from '@/components/misc/BalancePopup/BalanceDropdown.vue'
import { avm } from '@/AVA'
import Big from 'big.js'
import { bnToBig } from '@/helpers/helper'
interface IDropdownValue {
    label: string
    key: string
    data: any
    disabled: boolean
}

export default defineComponent({
    name: 'CurrencyInputDropdown',
    components: {
        Dropdown,
        BigNumInput,
        BalanceDropdown,
    },
    props: {
        disabled_assets: {
            type: Array as () => AvaAsset[],
            default: () => []
        },
        initial: {
            type: String,
            default: ''
        },
        disabled: {
            type: Boolean,
            default: false
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()
        
        const bigIn = ref<InstanceType<typeof BigNumInput>>()
        const amount = ref<BN>(new BN(0))
        
        const walletAssetsArray = computed((): AvaAsset[] => {
            return store.getters['Assets/walletAssetsArray']
        })
        
        const asset_now = ref<AvaAsset>(walletAssetsArray.value[0])

        const walletAssetsDict = computed((): IWalletAssetsDict => {
            return store.getters['Assets/walletAssetsDict']
        })

        const avaxAsset = computed((): AvaAsset | null => {
            return store.getters['Assets/AssetAVA']
        })

        const priceDict = computed((): priceDict => {
            return store.state.prices
        })

        onMounted(() => {
            if (isEmpty.value) return
            if (props.initial) {
                let initialAsset = walletAssetsDict.value[props.initial]
                drop_change(initialAsset)
            } else {
                drop_change(walletAssetsArray.value[0])
            }
        })

        watch(() => asset_now.value, (val: AvaAsset) => {
            drop_change(val)
        })

        const drop_change = (val: AvaAsset) => {
            asset_now.value = val
            if (bigIn.value) {
                bigIn.value.clear()
            }
            // amount_in(new BN(0))
            onchange()
        }

        const stepSize = computed((): BN => {
            if (denomination.value > 3) {
                let stepNum = Math.pow(10, denomination.value - 2)
                return new BN(stepNum.toString())
            } else {
                let stepNum = Math.pow(10, denomination.value)
                return new BN(stepNum.toString())
            }
        })

        const maxOut = () => {
            // @ts-ignore
            if (bigIn.value) {
                bigIn.value.maxout()
            }
        }

        const amount_in = (val: BN) => {
            amount.value = val
            onchange()
        }

        // onchange event for the Component
        const onchange = (): ICurrencyInputDropdownValue => {
            const result = {
                asset: asset_now.value,
                amount: amount.value,
            }
            emit('change', result)
            return result
        }

        const onfocus = () => {
            console.log('focus')
        }

        const amountUSD = computed((): Big => {
            let usdPrice = priceDict.value.usd
            let bigAmt = bnToBig(amount.value, denomination.value)
            let usdBig = bigAmt.times(usdPrice)
            return usdBig
        })

        const isEmpty = computed((): boolean => {
            if (walletAssetsArray.value.length === 0) {
                return true
            } else {
                return false
            }
        })

        const isAvax = computed((): boolean => {
            if (asset_now.value.id === avaxAsset.value?.id) return true
            return false
        })

        const display = computed((): string => {
            return ''
        })

        const placeholder = computed((): string => {
            if (isEmpty.value || !asset_now.value) return '0.00'
            let deno = asset_now.value.denomination
            let res = '0'
            if (deno > 2) {
                res = '0.00'
            }
            return res
        })

        const denomination = computed((): number => {
            if (!asset_now.value) return 0
            return asset_now.value.denomination
        })

        const max_amount = computed((): null | BN => {
            if (!asset_now.value) return null
            if (!avaxAsset.value) return null

            let assetId = asset_now.value.id
            let balance = walletAssetsDict.value[assetId]

            let avaxId = avaxAsset.value.id

            // Max amount is BALANCE - FEE for AVAX
            if (assetId === avaxId) {
                let fee = avm.getTxFee()
                // console.log(fee);
                if (fee.gte(balance.amount)) {
                    return new BN(0)
                } else {
                    return balance.amount.sub(fee)
                }
            }

            if (balance.amount.isZero()) return null
            return balance.amount
        })

        const maxAmountBig = computed((): Big => {
            if (!max_amount.value) return Big(0)
            return bnToBig(max_amount.value, denomination.value)
        })

        return {
            bigIn,
            amount,
            asset_now,
            stepSize,
            maxOut,
            amount_in,
            onchange,
            onfocus,
            amountUSD,
            isEmpty,
            isAvax,
            display,
            placeholder,
            denomination,
            walletAssetsArray,
            walletAssetsDict,
            avaxAsset,
            max_amount,
            maxAmountBig,
            priceDict
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.bigIn {
    width: 100%;
    border: none !important;
    font-size: 15px;
    font-family: monospace;
    /*background-color: #303030;*/
}

.max_in_cont {
    position: relative;
    display: grid;
    grid-template-columns: max-content 1fr;
    padding: 8px 14px;
}

.curr_in_drop {
    display: grid;
    grid-template-columns: 1fr 90px;
    background-color: transparent;
    //font-size: 12px;
    width: 100%;
    outline: none;
    text-align: right;
    column-gap: 10px;

    > * {
        background-color: var(--bg-light);
        border-radius: 2px;
    }
}

input {
    flex-grow: 1;
    outline: none;
    text-align: right;
    flex-basis: 0px;
    width: 0px;
    color: var(--primary-color);
}

.max_but {
    opacity: 0.4;
    font-size: 13px;
    &:hover {
        opacity: 1;
    }
}

.dropdown {
    /*flex-basis: 140px;*/
    width: 100%;
    /*border-left: 1px solid #d2d2d2;*/
}

.balance {
    display: grid;
    column-gap: 10px;
    grid-template-columns: 1fr 140px;
    font-size: 14px;
    color: var(--primary-color-light);
    padding: 2px 0px;

    > div {
        display: flex;
        justify-content: space-between;
    }

    p {
        padding: 2px 0px;
    }

    p:last-child {
        text-align: right;
    }

    span {
        font-family: monospace;
        padding-left: 14px;
    }
}

.col_big_in {
    text-align: right;
    font-family: monospace;
    display: flex;
    flex-direction: column;
}

.col_balance {
    padding-right: 14px;
    padding-top: 2px !important;
    font-size: 15px;
    color: var(--primary-color-light);
    font-family: monospace;
    background-color: transparent;
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

@include main.medium-device {
    .balance {
        grid-template-columns: 1fr;
    }
}

@include main.mobile-device {
    .balance,
    .curr_in_drop {
        grid-template-columns: 1fr 80px;
    }

    .balance {
        font-size: 12px;
    }
}
</style>
