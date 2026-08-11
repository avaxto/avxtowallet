<template>
    <div class="erc_row">
        <img :src="token.data.logoURI" v-if="token.data.logoURI" />
        <div v-else class="no_logo">
            <p>?</p>
        </div>
        <p class="col_name">
            {{ token.data.name }} ({{ token.data.symbol }})
            <span>ERC20</span>
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
            <a
                href="#"
                class="copy_addr"
                title="Copy contract address"
                @click.stop.prevent="copyAddress"
            >
                <fa icon="copy"></fa>
            </a>
        </p>
        <div class="send_col" :class="{ disabled: !isBalance }" @click="send">
            <img v-if="isDay" src="@/assets/sidebar/transfer_nav.png" />
            <img v-else src="@/assets/sidebar/transfer_nav_night.svg" />
        </div>
        <p class="balance_col">
            {{ balText }}
        </p>
    </div>
</template>
<script lang="ts">
import { useTheme } from '@/composables/useTheme'
import { defineComponent, computed } from 'vue'
import { useRouter } from 'vue-router'
import Erc20Token from '@/js/Erc20Token'
import { useAssetsStore, useNotificationsStore } from '@/stores'
import { goToTransfer } from '@/helpers/transfer_link'

interface Props {
    token: Erc20Token
}

export default defineComponent({
    name: 'ERC20Row',
    props: {
        token: {
            type: Object as () => Erc20Token,
            required: true
        }
    },
    setup(props: Props) {
        const { isDay } = useTheme()
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const router = useRouter()

        const balText = computed(() => {
            return props.token.balanceBig.toLocaleString()
        })

        const isBalance = computed(() => {
            return !props.token.balanceBN.isZero()
        })

        const send = () => {
            if (!isBalance.value) return
            goToTransfer(router, {
                chain: 'C',
                token: props.token.data.address,
                name: props.token.data.name,
                symbol: props.token.data.symbol,
                decimals: parseInt(props.token.data.decimals as string) || 18,
                logoUri: props.token.data.logoURI,
            })
        }

        const explorerUrl = computed(() => {
            const base =
                assetsStore.evmChainId === 43113
                    ? 'https://testnet.snowtrace.io'
                    : 'https://snowtrace.io'
            return `${base}/token/${props.token.data.address}`
        })

        const copyAddress = () => {
            const el = document.createElement('textarea')
            el.value = props.token.data.address
            el.style.position = 'fixed'
            el.style.opacity = '0'
            document.body.appendChild(el)
            el.select()
            el.setSelectionRange(0, 99999)
            document.execCommand('copy')
            document.body.removeChild(el)
            notificationsStore.add({
                title: ' Copied',
                message: 'Copied to clipboard.',
            })
        }

        return {
            balText,
            isBalance,
            send,
            explorerUrl,
            copyAddress,
            isDay
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.erc_row {
    > * {
        align-self: center;
    }
    padding: 14px 0px;
    //display: grid;
    //grid-template-columns: 30px;
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

    span {
        color: var(--primary-color-light) !important;
    }
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
    margin-left: 6px;
    color: var(--primary-color-light);
    opacity: 0.6;
    font-size: 12px;

    &:hover {
        opacity: 1;
        color: var(--primary-color);
    }
}

.send_col {
    text-align: center;
    opacity: 0.4;
    cursor: pointer;
    &:hover {
        opacity: 1;
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

@include main.medium-device {
    .erc_row {
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

@include main.mobile-device {
}
</style>
