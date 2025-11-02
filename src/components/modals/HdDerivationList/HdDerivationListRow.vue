<template>
    <div class="list_row">
        <p class="col_index" style="text-align: center">{{ index }}</p>
        <p class="col_addr">
            <span>{{ address }}</span>
            &nbsp;
            <span class="verify" v-if="walletType === 'ledger'" @click="verifyLedgerAddress">
                {{ $t('create.verify') }}
            </span>
        </p>
        <div class="col_bal">
            <p v-if="noBalance">-</p>
            <template v-else>
                <p v-for="(bal, assetId) in cleanBalance" :key="assetId">
                    {{ bal.toLocaleString(assetsDict[assetId].denomination) }}
                    <span>{{ assetsDict[assetId].symbol }}</span>
                </p>
            </template>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useMainStore, useAssetsStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import Big from 'big.js'
import { DerivationListBalanceDict } from '@/components/modals/HdDerivationList/types'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { WalletType } from '@/js/wallets/types'

import { ava } from '@/AVA'
import { getPreferredHRP } from '@/avalanche/utils'
import { AVA_ACCOUNT_PATH } from '../../../js/wallets/MnemonicWallet'

export default defineComponent({
    name: 'HdDerivationListRow',
    props: {
        index: {
            type: Number,
            required: true
        },
        path: {
            type: Number,
            required: true
        },
        address: {
            type: String,
            required: true
        },
        balance: {
            type: Object as () => DerivationListBalanceDict,
            required: true
        }
    },
    setup(props) {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const { t } = useI18n()

        const cleanBalance = computed((): DerivationListBalanceDict => {
            let res: DerivationListBalanceDict = {}
            for (var bal in props.balance) {
                let balance: Big = props.balance[bal]
                if (balance.gt(Big(0))) {
                    res[bal] = balance
                }
            }
            return res
        })

        const noBalance = computed((): boolean => {
            return Object.keys(cleanBalance.value).length === 0
        })

        const assetsDict = computed(() => {
            // Placeholder - will be implemented when assets store is completed
            console.log('HdDerivationListRow: accessing assetsDict (placeholder)')
            return {}
        })

        const wallet = computed(() => {
            return mainStore.activeWallet as WalletType
        })

        const walletType = computed(() => {
            return wallet.value.type
        })

        const verifyLedgerAddress = async () => {
            const walletInstance = wallet.value as LedgerWallet
            const isInternal = props.path == 1
            walletInstance.verifyAddress(props.index, isInternal)
        }

        return {
            cleanBalance,
            noBalance,
            assetsDict,
            wallet,
            walletType,
            verifyLedgerAddress
        }
    }
})
</script>
<style scoped lang="scss">
.col_index {
    color: var(--primary-color-light);
}

.col_addr {
    /*white-space: nowrap;*/
    overflow: hidden;
    text-overflow: ellipsis;
    word-break: break-all;
    font-family: monospace;
    color: var(--primary-color-light);

    .verify {
        opacity: 0;
        cursor: pointer;
        color: var(--primary-color);
        transition: opacity 0.1s;
        font-size: 11px;
        padding: 2px 4px;
        background: var(--bg-light);
    }

    &:hover {
        .verify {
            opacity: 1;
            transition: opacity 0.2s;
        }
    }
}

.col_bal {
    text-align: right;
    padding-right: 15px;
    padding-left: 15px;
    font-family: monospace;
    word-break: keep-all;
    white-space: nowrap;
}

span {
    /*background-color: #ddd;*/
    /*padding: 2px 6px;*/
    border-radius: 2px;
    font-weight: bold;
}
</style>
