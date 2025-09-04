<template>
    <div class="content">
        <template v-if="isLoading">
            <Spinner style="width: 40px" class="_spin"></Spinner>
            <p>Loading Wallet</p>
        </template>
        <div v-if="!isLoading" class="wallet_body">
            <Balances
                :balances="balances"
                :stake-amt="stakeAmt"
                class="balances section"
            ></Balances>
            <div class="">
                <v-btn
                    depressed
                    class="button_secondary"
                    small
                    @click="downloadRewardsHistory"
                    :loading="isStakeDownloading"
                    disabled
                >
                    Download Staking History
                </v-btn>
            </div>
            <v-btn @click="logout" small style="margin-top: 1em" depressed>Logout</v-btn>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useStore } from 'vuex'

import {
    PublicMnemonicWallet,
    iAvaxBalance,
    BN,
    createCsvNormal,
    createCsvStaking,
    ethersProvider,
    getTransactionSummary,
    parseStakingTxs,
    HistoryItemType,
    isHistoryStakingTx,
} from '@avalabs/avalanche-wallet-sdk'
import { UTXOSet as AVMUTXOSet } from 'avalanche/dist/apis/avm'
import { UTXOSet as PlatformUTXOSet, TransferableOutput } from 'avalanche/dist/apis/platformvm'
import Balances from '@/views/wallet_readonly/Balances.vue'
import { downloadCSVFile } from '@/store/modules/history/history_utils'
import Addresses from '@/views/wallet_readonly/Addresses.vue'
import Spinner from '@/components/misc/Spinner.vue'
import { Network } from 'avalanche/dist/utils'
import { getPriceAtUnixTime } from '@/helpers/price_helper'

export default defineComponent({
    name: 'WalletReadonly',
    components: { Spinner, Addresses, Balances },
    setup() {
        const router = useRouter()
        const route = useRoute()
        const store = useStore()

        const isWalletLoading = ref(true)
        const isBalanceLoading = ref(false)
        const isStakeDownloading = ref(false)
        const balances = ref<iAvaxBalance | null>(null)
        const stakeAmt = ref<BN | null>(null)
        const addressX = ref('')
        const addressP = ref('')
        const addressC = ref('')
        const utxosX = ref<null | AVMUTXOSet>(null)
        const utxosP = ref<null | PlatformUTXOSet>(null)
        const stakeOuts = ref<null | TransferableOutput[]>(null)

        const wallet = computed(() => {
            return route.params.wallet as PublicMnemonicWallet
        })

        const evmAddress = computed(() => {
            return route.params.evmAddress as string
        })

        const isLoading = computed(() => {
            return isWalletLoading.value || isBalanceLoading.value
        })

        const network = computed(() => {
            return store.state.Network.selectedNetwork as Network | null
        })

        const updateAddresses = () => {
            addressX.value = wallet.value.getAddressX()
            addressP.value = wallet.value.getAddressP()
            addressC.value = wallet.value.getAddressC()
        }

        const updateBalance = async () => {
            isBalanceLoading.value = true
            utxosX.value = await wallet.value.updateUtxosX()
            utxosP.value = await wallet.value.updateUtxosP()
            await wallet.value.updateAvaxBalanceC()

            const avaxBalance = wallet.value.getAvaxBalance()
            balances.value = avaxBalance

            const cBal = await ethersProvider.getSigner(evmAddress.value).getBalance('latest')
            avaxBalance.C = new BN(cBal.toString())

            const { staked, stakedOutputs } = await wallet.value.getStake()
            stakeAmt.value = staked
            stakeOuts.value = stakedOutputs
            isBalanceLoading.value = false
        }

        const downloadAvaxHistory = async () => {
            const hist = await wallet.value.getHistory()
            const csvContent = createCsvNormal(hist)
            const encoding = 'data:text/csv;charset=utf-8,'
            downloadCSVFile(encoding + csvContent, 'avax_transfers')
        }

        const downloadRewardsHistory = async () => {
            try {
                isStakeDownloading.value = true
                // const hist = await wallet.value.getHistory()
                const hist = await wallet.value.getHistoryP()
                let parsed: HistoryItemType[] = []

                for (let i = 0; i < hist.length; i++) {
                    const tx = hist[i]
                    try {
                        const summary = await getTransactionSummary(
                            tx,
                            wallet.value.getAllAddressesPSync(),
                            evmAddress.value
                        )
                        parsed.push(summary)
                    } catch (e) {
                        console.log('Error parsing transaction: ', tx.id)
                        console.log(e)
                    }
                }

                parsed = parsed.map((item) => {
                    if (isHistoryStakingTx(item)) {
                        let unixTime = item.stakeEnd.getTime()
                        let price = getPriceAtUnixTime(unixTime)
                        return {
                            ...item,
                            avaxPrice: price,
                        }
                    } else {
                        return item
                    }
                })

                const csvContent = createCsvStaking(parsed)
                const encoding = 'data:text/csv;charset=utf-8,'
                const fileName = `avax_staking_txs_${new Date().toLocaleDateString()}`
                downloadCSVFile(encoding + csvContent, fileName)
            } catch (e) {
                isStakeDownloading.value = false
                store.dispatch('Notifications/add', {
                    type: 'error',
                    title: 'Request Failed',
                    message: 'Failed to download rewards history.',
                })
                console.log(e)
            }
            isStakeDownloading.value = false
        }

        const logout = () => {
            router.push('/access')
        }

        const init = () => {
            isWalletLoading.value = true
            wallet.value.resetHdIndices().then(() => {
                updateAddresses()
                isWalletLoading.value = false
                updateBalance()
            })
        }

        watch(network, () => {
            init()
        })

        onMounted(() => {
            if (!wallet.value) {
                logout()
                return
            }
            init()
        })

        onUnmounted(() => {
            if (wallet.value) {
                wallet.value.destroy()
            }
        })

        return {
            isWalletLoading,
            isBalanceLoading,
            isStakeDownloading,
            balances,
            stakeAmt,
            addressX,
            addressP,
            addressC,
            utxosX,
            utxosP,
            stakeOuts,
            wallet,
            evmAddress,
            isLoading,
            network,
            updateAddresses,
            updateBalance,
            downloadAvaxHistory,
            downloadRewardsHistory,
            logout,
            init
        }
    }
})
</script>
<style scoped lang="scss">
.wallet_body {
    display: flex;
    flex-direction: column;
}

.content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

.section {
    border: 1px solid var(--primary-color-light);
    border-radius: 1em;
    padding: 1em;
    margin-bottom: 1em;
}

._spin {
    width: 40px;
    height: 40px;
    font-size: 25px;
}
</style>
