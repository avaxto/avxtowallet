<template>
    <div class="my_keys">
        <p class="label">{{ $t('keys.active_wallet') }}</p>
        <key-row
            v-if="activeWallet"
            :wallet="activeWallet"
            class="key_row"
            :is_default="true"
        ></key-row>
        <hr v-if="inactiveWallets.length > 0" />
        <p class="label" v-if="inactiveWallets.length > 0">Other Keys</p>
        <transition-group name="fade" tag="div">
            <key-row
                v-for="wallet in inactiveWallets"
                :wallet="wallet"
                :key="wallet.id"
                class="key_row"
                @select="selectWallet"
                @remove="removeWallet(wallet)"
            ></key-row>
        </transition-group>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { useI18n } from 'vue-i18n'

import KeyRow from '@/components/wallet/manage/KeyRow.vue'
import RememberKey from '@/components/misc/RememberKey.vue'
import { WalletType } from '@/js/wallets/types'

export default defineComponent({
    name: 'MyKeys',
    components: {
        KeyRow,
        RememberKey,
    },
    setup() {
        const store = useStore()
        const { t } = useI18n()

        const selectWallet = (wallet: WalletType) => {
            store.dispatch('activateWallet', wallet)
            store.dispatch('History/updateTransactionHistory')
        }

        const account = computed(() => {
            return store.getters['Accounts/account']
        })

        const removeWallet = async (wallet: WalletType) => {
            let msg = t('keys.del_check') as string
            let isConfirm = confirm(msg)

            if (isConfirm) {
                await store.dispatch('Accounts/deleteKey', wallet)
                await store.dispatch('removeWallet', wallet)
                store.dispatch('Notifications/add', {
                    title: t('keys.remove_success_title'),
                    message: t('keys.remove_success_msg'),
                })
            }
        }

        const inactiveWallets = computed((): WalletType[] => {
            let wallets = store.state.wallets

            let res = wallets.filter((wallet: WalletType) => {
                if (activeWallet.value === wallet) return false
                return true
            })

            return res
        })

        const wallets = computed((): WalletType[] => {
            return store.state.wallets
        })

        const activeWallet = computed((): WalletType => {
            return store.state.activeWallet
        })

        return {
            selectWallet,
            account,
            removeWallet,
            inactiveWallets,
            wallets,
            activeWallet
        }
    }
})
</script>
<style scoped lang="scss">
@use "../../../main";

hr {
    border-top: 1px solid var(--bg-light);
    border-left: 1px solid var(--bg-light);
    border-right: 1px solid var(--bg-light);
    border-color: var(--bg-light) !important;
    margin: 12px 0;
}

.label {
    font-size: 13px;
    color: #999;
    font-weight: bold;
    padding: 2px 10px;
}
.key_row {
    background-color: var(--bg-light);
    padding: 15px;
    border-radius: 8px;
    margin-bottom: 10px;
    transition-duration: 0.2s;
}

.my_keys {
    padding-top: 15px;
}

.volatile_cont {
    max-width: 380px;
    /*border-top: 1px solid #eee;*/
    margin-top: 20px;
    padding-top: 20px;
    /*display: grid;*/
    /*grid-template-columns: 1fr 1fr;*/
}

.alert_box {
    /*margin: 0px 25px;*/
    font-size: 0.9rem;
}
</style>
<style lang="scss">
.volatile_cont {
    .v-expansion-panel {
        background-color: transparent !important;
    }

    .passwords input {
        background-color: #d2e9fd;
    }

    .v-expansion-panel-header,
    .v-expansion-panel-content__wrap {
        padding: 8px 0;
    }
}
</style>
