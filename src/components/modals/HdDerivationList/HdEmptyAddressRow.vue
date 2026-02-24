<template>
    <div class="list_row list_row_empty">
        <p class="col_index" style="text-align: center">{{ index }}</p>
        <p class="col_addr">
            <span>{{ address }}</span>
            &nbsp;
            <span class="verify" v-if="walletType === 'ledger'" @click="verifyLedgerAddress">
                {{ $t('create.verify') }}
            </span>
        </p>
        <p class="col_bal">{{ $t('modal.hd.no_use') }}</p>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useMainStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import { WalletType } from '@/js/wallets/types'

import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { ava } from '@/AVA'
import { getPreferredHRP } from '@/avalanche/utils'
import { AVA_ACCOUNT_PATH } from '@/js/wallets/MnemonicWallet'

export default defineComponent({
    name: 'HdEmptyAddressRow',
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
        }
    },
    setup(props) {
        const mainStore = useMainStore()
        const { t } = useI18n()

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
            wallet,
            walletType,
            verifyLedgerAddress
        }
    }
})
</script>
<style scoped lang="scss">
.list_row_empty {
    color: var(--primary-color-light);
}
.col_index,
.col_bal {
    user-select: none;
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
        user-select: none;
    }

    &:hover {
        .verify {
            opacity: 1;
            transition: opacity 0.2s;
        }
    }
}

.col_bal {
    padding-right: 15px;
    text-align: right;
}
</style>
