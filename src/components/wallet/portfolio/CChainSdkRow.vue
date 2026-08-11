<template>
    <div class="cchain_sdk_row" :class="{ alt: alternate }">
        <img :src="asset.logoUri" v-if="asset.logoUri" />
        <div v-else class="no_logo">
            <img src="@/assets/AVXTO_Icon.png" />
        </div>
        <p class="col_name">
            {{ asset.name }} ({{ asset.symbol }})
            <span>{{ ercLabel }}</span>
            <a
                :href="explorerUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="explorer_link"
                title="View contract on explorer"
                @click.stop
            >
                <fa icon="link"></fa>
            </a>
            <CopyText
                :value="asset.address"
                class="copy_addr"
                title="Copy contract address"
                @click.stop
            ></CopyText>
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
import { useAssetsStore } from '@/stores'
import type { CChainSdkAsset } from '@/composables/useCChainSdkBalances'
import CopyText from '@/components/misc/CopyText.vue'

interface Props {
    asset: CChainSdkAsset
}

export default defineComponent({
    name: 'CChainSdkRow',
    components: { CopyText },
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
        const assetsStore = useAssetsStore()

        const explorerUrl = computed(() => {
            const base =
                assetsStore.evmChainId === 43113
                    ? 'https://testnet.snowtrace.io'
                    : 'https://snowtrace.io'
            return `${base}/token/${props.asset.address}`
        })

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
                const params = new URLSearchParams({
                    chain: 'C',
                    token: props.asset.address,
                    name: props.asset.name,
                    symbol: props.asset.symbol,
                    decimals: String(props.asset.decimals ?? 18),
                })
                if (props.asset.logoUri) params.set('logoUri', props.asset.logoUri)
                return `/wallet/transfer?${params.toString()}`
            }
            return ''
        })

        return { isDay, ercLabel, sendLink, explorerUrl }
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

.explorer_link {
    display: inline-flex;
    margin-left: 6px;
    color: var(--primary-color-light);
    opacity: 0.6;
    font-size: 12px;

    &:hover {
        opacity: 1;
        color: var(--primary-color);
    }
}

.copy_addr {
    display: inline-flex;
    margin-left: 4px;
    opacity: 0.6;
    vertical-align: middle;

    &:hover {
        opacity: 1;
    }

    :deep(.copyBut) {
        margin: 0;
    }

    :deep(.copyBut img) {
        max-height: 12px;
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
