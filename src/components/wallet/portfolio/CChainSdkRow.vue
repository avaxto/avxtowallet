<template>
    <div class="cchain_sdk_row" :class="{ alt: alternate }">
        <img :src="asset.logoUri" v-if="asset.logoUri" />
        <div v-else class="no_logo">
            <img src="/src/assets/AVXTO_Icon.png" />
        </div>
        <p class="col_name">
            {{ asset.name }} ({{ asset.symbol }})
            <span>{{ ercLabel }}</span>
        </p>
        <router-link
            :to="sendLink"
            class="send_col"
            :class="{ disabled: asset.type !== 'erc20' }"
        >
            <img v-if="isDay" src="@/assets/sidebar/transfer_nav.png" />
            <img v-else src="@/assets/sidebar/transfer_nav_night.svg" />
        </router-link>
        <p class="balance_col">{{ asset.balance }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useTheme } from '@/composables/useTheme'
import type { CChainSdkAsset } from '@/composables/useCChainSdkBalances'

interface Props {
    asset: CChainSdkAsset
}

export default defineComponent({
    name: 'CChainSdkRow',
    props: {
        asset: {
            type: Object as () => CChainSdkAsset,
            required: true,
        },
        alternate: {
            type: Boolean,
            default: false,
        },
    },
    setup(props: Props) {
        const { isDay } = useTheme()

        const ercLabel = computed(() => {
            switch (props.asset.type) {
                case 'erc20':
                    return 'ERC-20'
                case 'erc721':
                    return 'ERC-721'
                case 'erc1155':
                    return 'ERC-1155'
            }
        })

        const sendLink = computed(() => {
            if (props.asset.type === 'erc20') {
                return `/wallet/transfer?chain=C&token=${props.asset.address}`
            }
            return ''
        })

        return { isDay, ercLabel, sendLink }
    },
})
</script>
<style scoped lang="scss">
@use '../../../main';

.cchain_sdk_row {
    > * {
        align-self: center;
    }
    padding: 14px 0px;

    &.alt {
        background-color: rgba(0, 0, 0, 0.06);
        border-radius: 4px;
    }
}

img {
    object-fit: contain;
    width: 40px;
    height: 40px;
    border-radius: 40px;
}

.balance_col {
    text-align: right;
    font-size: 18px;
}

.col_name {
    padding-left: 10px;

    span {
        font-size: 12px;
        color: var(--secondary-color);
    }
}

.send_col {
    text-align: center;
    opacity: 0.4;

    &:hover {
        opacity: 1;
    }

    &.disabled {
        pointer-events: none;
        opacity: 0.15;
    }

    img {
        width: 18px;
        object-fit: contain;
    }
}

.no_logo {
    text-align: center;
    height: 40px;
    width: 40px;
    border-radius: 40px;
    align-self: center;
    justify-self: center;
    background-color: var(--bg-light);
    display: flex;
    justify-content: center;
    align-items: center;
    color: var(--primary-color-light);
}

.no_logo img {
    width: 30px;
    height: 30px;
}

@include main.medium-device {
    .cchain_sdk_row {
        padding: 6px 0;
    }

    $logo_w: 30px;
    img,
    .no_logo {
        width: $logo_w;
        height: $logo_w;
        border-radius: $logo_w;
    }
}
</style>
