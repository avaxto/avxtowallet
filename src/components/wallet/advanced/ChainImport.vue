<template>
    <div class="chain_import">
        <h2>{{ $t('advanced.import.title') }}</h2>
        <p>{{ $t('advanced.import.desc') }}</p>
        <div v-if="isSuccess" class="is_success">
            <label>Tx ID</label>
            <p class="tx_id">{{ txId }}</p>
        </div>
        <p class="err" v-else-if="err">{{ err }}</p>
        <template v-if="!isLoading">
            <v-btn block class="button_secondary" depressed @click="atomicImportX('P')" small>
                Import X (From P)
            </v-btn>
            <v-btn block class="button_secondary" depressed @click="atomicImportX('C')" small>
                Import X (From C)
            </v-btn>
            <v-btn block class="button_secondary" depressed @click="atomicImportP('X')" small>
                Import P (From X)
            </v-btn>
            <v-btn block class="button_secondary" depressed @click="atomicImportP('C')" small>
                Import P (From C)
            </v-btn>
            <v-btn
                v-if="isEVMSupported"
                block
                class="button_secondary"
                depressed
                @click="atomicImportC('X')"
                small
            >
                Import C (from X)
            </v-btn>
            <v-btn block class="button_secondary" depressed @click="atomicImportC('P')" small>
                Import C (from P)
            </v-btn>
        </template>
        <Spinner class="spinner" v-else></Spinner>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed } from 'vue'
import { useStore } from '@/stores'

import Spinner from '@/components/misc/Spinner.vue'
import { WalletType } from '@/js/wallets/types'
import { BN } from '@/avalanche'
import {
    avaxCtoX,
    ExportChainsC,
    ExportChainsP,
    ExportChainsX,
    GasHelper,
} from '@/avalanche-wallet-sdk'

export default defineComponent({
    name: 'ChainImport',
    components: { Spinner },
    setup() {
        const store = useStore()
        const err = ref('')
        const isSuccess = ref(false)
        const isLoading = ref(false)
        const txId = ref('')

        const wallet = computed((): null | WalletType => {
            let wallet: null | WalletType = store.state.activeWallet
            return wallet
        })

        const isEVMSupported = computed(() => {
            if (!wallet.value) return false
            return wallet.value.ethAddress
        })

        const atomicImportX = async (sourceChain: ExportChainsX) => {
            beforeSubmit()
            if (!wallet.value) return

            // // Import from C
            try {
                let txIdVal = await wallet.value.importToXChain(sourceChain)
                onSuccess(txIdVal)
            } catch (e) {
                if (isSuccess.value) return
                onError(e)
            }
        }

        const atomicImportP = async (source: ExportChainsP) => {
            beforeSubmit()
            if (!wallet.value) return
            try {
                let txIdVal = await wallet.value.importToPlatformChain(source)
                onSuccess(txIdVal)
            } catch (e) {
                onError(e)
            }
        }

        const atomicImportC = async (source: ExportChainsC) => {
            beforeSubmit()
            if (!wallet.value) return
            try {
                const utxoSet = await wallet.value.evmGetAtomicUTXOs(source)
                const utxos = utxoSet.getAllUTXOs()

                const numIns = utxos.length
                const baseFee = await GasHelper.getBaseFeeRecommended()

                if (numIns === 0) {
                    throw new Error('Nothing to import.')
                }

                // Calculate number of signatures
                const numSigs = utxos.reduce((acc, utxo) => {
                    return acc + utxo.getOutput().getAddresses().length
                }, 0)

                const gas = GasHelper.estimateImportGasFeeFromMockTx(numIns, numSigs)

                const totFee = baseFee.mul(new BN(gas))
                let txIdVal = await wallet.value.importToCChain(source, avaxCtoX(totFee))
                onSuccess(txIdVal)
            } catch (e) {
                onError(e)
            }
        }

        const beforeSubmit = () => {
            isLoading.value = true
            err.value = ''
            isSuccess.value = false
            txId.value = ''
        }

        const onSuccess = (txIdVal: string) => {
            isLoading.value = false
            err.value = ''
            isSuccess.value = true
            txId.value = txIdVal

            store.dispatch('Notifications/add', {
                type: 'success',
                title: 'Import Success',
                message: txIdVal,
            })

            setTimeout(() => {
                store.dispatch('Assets/updateUTXOs')
                store.dispatch('History/updateTransactionHistory')
            }, 3000)
        }

        const onError = (error: Error) => {
            isLoading.value = false
            let msg = ''
            if (error.message.includes('No atomic')) {
                err.value = 'Nothing found to import.'
                return
            } else {
                err.value = error.message
            }
        }

        return {
            err,
            isSuccess,
            isLoading,
            txId,
            wallet,
            isEVMSupported,
            atomicImportX,
            atomicImportP,
            atomicImportC
        }
    },
    deactivated() {
        this.err = ''
        this.txId = ''
        this.isSuccess = false
    }
})
</script>
<style scoped lang="scss">
.v-btn {
    margin: 8px 0;
}

.is_success {
    label {
        color: var(--primary-color-light);
    }
}

.spinner {
    color: var(--primary-color) !important;
    margin: 14px auto !important;
}

.tx_id {
    font-size: 13px;
    word-break: break-all;
}
</style>
