<template>
    <div class="avax_input">
        <div class="col1 hover_border">
            <button class="max_but" @click="maxOut" v-if="max">MAX</button>
            <BigNumInput
                ref="amtIn"
                class="amt_in"
                contenteditable="amt_in"
                :denomination="9"
                :max="max"
                placeholder="0.00"
                @change="amount_in"
            ></BigNumInput>
        </div>
        <p class="ticker">AVAX</p>
        <div v-if="balance" class="balance">
            <div>
                <p>
                    <b>{{ $t('misc.balance') }}:</b>
                    {{ balance.toLocaleString() }}
                </p>
                <p>
                    <b>$</b>
                    {{ amountUSD.toLocaleString(2) }}
                </p>
            </div>
            <div></div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'
import { Big, bnToBig } from '@/avalanche-wallet-sdk'
//@ts-ignore
import { BigNumInput } from '@/vue_components/bignum_input.vue'
import { BN } from '@/avalanche'
// Type for price data
type priceDict = { usd: number }

interface Props {
    amount: BN
    max?: BN | null
    balance?: Big | null
}

export default defineComponent({
    name: 'AvaxInput',
    components: {
        BigNumInput,
    },
    props: {
        amount: {
            type: Object as () => BN,
            required: true
        },
        max: {
            type: Object as () => BN | null,
            default: null
        },
        balance: {
            type: Object as () => Big | null,
            default: null
        }
    },
    emits: ['change'],
    setup(props: Props, { emit }) {
        const mainStore = useMainStore()
        const amtIn = ref<InstanceType<typeof BigNumInput>>()

        const priceDict = computed((): priceDict => {
            return mainStore.prices
        })

        const amountUSD = computed((): Big => {
            let usdPrice = priceDict.value.usd
            if (typeof usdPrice !== 'number' || isNaN(usdPrice)) {
                return Big(0)
            }
            let amount = bnToBig(props.amount, 9)
            let usdBig = amount.times(usdPrice)
            return usdBig
        })

        const maxOut = (ev: MouseEvent) => {
            ev.preventDefault()
            ev.stopPropagation()
            //@ts-ignore
            amtIn.value?.maxout()
        }

        const amount_in = (val: BN) => {
            emit('change', val)
        }

        return {
            amtIn,
            priceDict,
            amountUSD,
            maxOut,
            amount_in
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.avax_input {
    display: grid;
    grid-template-columns: 1fr max-content;
    grid-gap: 0px 10px;
    color: var(--primary-color);
    width: 100%;
    height: 40px;

    .amt_in {
        color: var(--primary-color);
        font-size: 15px;
        font-family: monospace;
        flex-grow: 1;
        flex-shrink: 1;
        display: block;
        box-sizing: content-box;
        outline: none !important;
        border: none !important;
        //padding: 0 12px !important;
    }

    .ticker,
    .amt_in,
    .max_but {
        background-color: var(--bg-light);
        //border-radius: 3px;
    }
}

.balance {
    display: grid;
    column-gap: 10px;
    font-size: 14px;
    color: var(--primary-color-light);
    padding: 2px 0px;

    > div {
        display: flex;
        justify-content: space-between;
    }

    p {
        text-align: left;
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

.col1 {
    border-radius: 3px;
    background-color: var(--bg-light);
    border: 1px solid transparent;
    //display: flex;
    display: grid;
    grid-template-columns: max-content 1fr;
    width: 100%;
    box-sizing: border-box;
    //overflow: auto;
    padding: 8px 14px;
    position: relative;

    //&:hover {
    //    border-color: var(--primary-color-light);
    //}
    //&:focus-within {
    //    border-color: var(--secondary-color);
    //}
}

.ticker {
    border-radius: 3px;
    padding: 8px 14px;
}

p {
    text-align: center;
}
.max_but {
    font-size: 13px;
    opacity: 0.4;
    &:hover {
        opacity: 1;
    }
}

@include main.mobile-device {
    .balance {
        font-size: 12px;
    }
}
</style>
