<template>
    <div class="chain_card">
        <div class="input_group">
            <h4 v-if="isSource">{{ $t('cross_chain.card.source') }}</h4>
            <h4 v-else>{{ $t('cross_chain.card.destination') }}</h4>
            <p style="font-size: 3em" class="chain_alias">{{ chain }}</p>
        </div>
        <div>
            <div class="input_group">
                <label>{{ $t('cross_chain.card.name') }}</label>
                <p>{{ chainNames[chain] }}</p>
            </div>
            <div class="input_group">
                <label>{{ $t('cross_chain.card.balance') }}</label>
                <p class="balance">{{ balanceText }}</p>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, onMounted } from 'vue'
import { useStore } from '@/stores'
import { UTXO } from '@/avalanche/apis/platformvm'
import { ChainIdType } from '@/constants'
import { BN } from '@/avalanche'
import AvaAsset from '@/js/AvaAsset'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { WalletType } from '@/js/wallets/types'

import { bnToBig } from '@/helpers/helper'
import NumberCounter from '@/components/misc/NumberCounter.vue'

const chainTypes: ChainIdType[] = ['X', 'P', 'C']
const chainNames = {
    X: 'Exchange Chain',
    C: 'Contract Chain',
    P: 'Platform Chain',
}

export default defineComponent({
    name: 'ChainCard',
    components: {
        NumberCounter,
    },
    props: {
        chain: {
            type: String as () => ChainIdType,
            required: true
        },
        isSource: {
            type: Boolean,
            default: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const store = useStore()

        const onChange = (ev: any) => {
            let val: ChainIdType = ev.target.value
            emit('change', val)
        }

        const ava_asset = computed((): AvaAsset | null => {
            let ava = store.getters['Assets/AssetAVA']
            return ava
        })

        const wallet = computed((): WalletType => {
            let wallet: MnemonicWallet = store.state.activeWallet
            return wallet
        })

        const platformUnlocked = computed((): BN => {
            return store.getters['Assets/walletPlatformBalance'].available
        })

        const avmUnlocked = computed((): BN => {
            if (!ava_asset.value) return new BN(0)
            return ava_asset.value.amount
        })

        const evmUnlocked = computed((): BN => {
            let balRaw = wallet.value.ethBalance
            return balRaw.div(new BN(Math.pow(10, 9)))
        })

        const balance = computed(() => {
            if (props.chain === 'X') {
                return avmUnlocked.value
            } else if (props.chain === 'P') {
                return platformUnlocked.value
            } else {
                return evmUnlocked.value
            }
        })

        const balanceBig = computed(() => {
            return bnToBig(balance.value, 9)
        })

        const balanceText = computed(() => {
            return balanceBig.value.toLocaleString()
        })

        onMounted(() => {
            // mounted logic
        })

        return {
            chainNames,
            onChange,
            ava_asset,
            wallet,
            platformUnlocked,
            avmUnlocked,
            evmUnlocked,
            balance,
            balanceBig,
            balanceText
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../main';

label {
    text-align: left;
    color: var(--primary-color-light);
    font-size: 13px;
}

.chain_card {
    //height: max-content;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 14px;
}

.input_group {
    display: flex;
    flex-direction: column;
    margin-bottom: 12px;
}

p {
    font-size: 14px;
    word-break: break-all;
}

@include main.mobile-device {
    .chain_card {
        display: block;
    }
    h4,
    .chain_alias {
        text-align: center;
    }
}
</style>
