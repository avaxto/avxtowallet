<template>
    <div class="asset">
        <div class="icon" :avax="isAvaxToken">
            <img v-if="iconUrl" :src="iconUrl" />
            <p v-else>?</p>
        </div>
        <p class="name_col not_mobile">
            {{ name }} ({{ symbol }})
            <span v-if="!isAvaxToken">ANT</span>
        </p>
        <p class="name_col mobile_only">{{ symbol }}</p>
        <router-link :to="sendLink" class="send_col" v-if="isBalance">
            <img v-if="$root.theme === 'day'" src="@/assets/sidebar/transfer_nav.png" />
            <img v-else src="@/assets/sidebar/transfer_nav_night.svg" />
        </router-link>
        <p v-else></p>
        <p class="balance_col" v-if="isBalance">
            <span>
                {{ amtBig.toLocaleString() }}
            </span>
            <br />
            <span class="fiat" v-if="isAvaxToken">
                {{ totalUSD.toLocaleString(2) }}
                &nbsp;USD
            </span>
        </p>
        <p class="balance_col" v-else>0</p>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'

import AvaAsset from '../../../js/AvaAsset'
import Hexagon from '@/components/misc/Hexagon.vue'
import { BN } from '@/avalanche'
import { bnToBig } from '../../../helpers/helper'
import { priceDict } from '../../../store/types'
import { WalletType } from '@/js/wallets/types'

import Big from 'big.js'

interface Props {
    asset: AvaAsset
}

export default defineComponent({
    name: 'FungibleRow',
    components: {
        Hexagon,
    },
    props: {
        asset: {
            type: Object as () => AvaAsset,
            required: true
        }
    },
    setup(props: Props) {
        const store = useStore()

        const avaxToken = computed((): AvaAsset => {
            return store.getters['Assets/AssetAVA']
        })

        const isAvaxToken = computed(() => {
            if (!props.asset) return false

            if (avaxToken.value.id === props.asset.id) {
                return true
            } else {
                return false
            }
        })

        const iconUrl = computed((): string | null => {
            if (!props.asset) return null

            if (isAvaxToken.value) {
                return '/img/avax_icon_circle.png'
            }

            return null
        })

        const evmAvaxBalance = computed((): BN => {
            let wallet: WalletType | null = store.state.activeWallet

            if (!isAvaxToken.value || !wallet) {
                return new BN(0)
            }
            // Convert to 9 decimal places
            let bal = wallet.ethBalance
            let balRnd = bal.divRound(new BN(Math.pow(10, 9).toString()))
            return balRnd
        })

        const amount = computed(() => {
            let amt = props.asset.getTotalAmount()
            return amt.add(evmAvaxBalance.value)
        })

        const isBalance = computed((): boolean => {
            if (!props.asset) return false
            if (!amount.value.isZero()) {
                return true
            }
            return false
        })

        const priceDict = computed((): priceDict => {
            return store.state.prices
        })

        const totalUSD = computed((): Big => {
            if (!isAvaxToken.value) return Big(0)
            let usdPrice = priceDict.value.usd
            let bigAmt = bnToBig(amount.value, props.asset.denomination)
            let usdBig = bigAmt.times(usdPrice)
            return usdBig
        })

        const sendLink = computed((): string => {
            if (!props.asset) return `/wallet/transfer`
            return `/wallet/transfer?asset=${props.asset.id}&chain=X`
        })

        const name = computed((): string => {
            let name = props.asset.name
            // TODO: Remove this hack after network change
            if (name === 'AVA') return 'AVAX'
            return name
        })

        const symbol = computed((): string => {
            let sym = props.asset.symbol

            // TODO: Remove this hack after network change
            if (sym === 'AVA') return 'AVAX'
            return sym
        })

        const amtBig = computed(() => {
            return bnToBig(amount.value, props.asset.denomination)
        })

        return {
            iconUrl,
            isBalance,
            totalUSD,
            priceDict,
            sendLink,
            avaxToken,
            isAvaxToken,
            name,
            symbol,
            amount,
            amtBig,
            evmAvaxBalance
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.asset {
    padding: 14px 0px;
    justify-self: center;

    > * {
        align-self: center;
    }

    .balance_col {
        font-size: 18px;
        text-align: right;
        .fiat {
            font-size: 12px;
            color: var(--primary-color-light);
        }
    }

    .name_col {
        padding-left: 15px;
        white-space: nowrap;
        overflow-y: hidden;
        text-overflow: ellipsis;
    }

    .send_col {
        text-align: center;
        opacity: 0.4;
        &:hover {
            opacity: 1;
        }
        img {
            width: 18px;
            object-fit: contain;
        }
    }
}

$icon_w: 40px;
.icon {
    position: relative;
    align-self: center;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    transition-duration: 1s;
    width: $icon_w;
    height: $icon_w;
    border-radius: $icon_w;
    background-color: var(--bg-light);

    p {
        color: var(--primary-color-light);
    }

    img {
        width: 100%;
        object-fit: contain;
    }
}

.hex_bg {
    height: 100%;
    width: 100%;
}

.mobile_only {
    display: none;
}

.name_col {
    span {
        font-size: 12px;
        color: var(--secondary-color);
    }
}

@include main.medium-device {
    .asset {
        padding: 6px 0;
    }

    .balance_col {
        span {
            font-size: 15px;
        }
        font-size: 15px;
    }
    .send_col {
        img {
            width: 14px;
        }
    }

    .name_col {
        font-size: 14px;
    }

    $icon_w: 30px;
    .icon {
        width: $icon_w;
        height: $icon_w;
        border-radius: $icon_w;
    }
}
@include main.mobile-device {
    .name_col {
        display: none;
    }

    .balance_col {
        font-size: 1rem !important;
    }

    .mobile_only {
        display: initial;
    }
}
</style>
