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
import { useAssetsStore, useHistoryStore, useMainStore, useNotificationsStore } from '@/stores'

import Spinner from '@/components/misc/Spinner.vue'
import { Wallet } from '@/js/wallets/AbstractWallet'
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
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const historyStore = useHistoryStore()
        const err = ref('')
        const isSuccess = ref(false)
        const isLoading = ref(false)
        const txId = ref('')

        const wallet = computed((): null | Wallet => {
            let wallet: null | Wallet = mainStore.activeWallet
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

                if (utxos.length === 0) {
                    throw new Error('Nothing to import.')
                }

                const numIns = utxos.length
                // Calculate number of signatures (sum of owner addresses across all UTXOs).
                const numSigs = utxos.reduce((acc, utxo) => {
                    return acc + utxo.getOutput().getAddresses().length
                }, 0)
                const gas = GasHelper.estimateImportGasFeeFromMockTx(numIns, numSigs)

                // Per-gas price (wei).  Try in order:
                //   1. `eth_baseFee` (AvalancheGo-specific atomic fee source)
                //   2. `eth_gasPrice` (standard EVM; same source the C send form uses)
                //   3. Hardcoded 25 gwei floor
                // The MIN_PER_GAS_WEI = 1 gwei threshold is critical: if perGasWei is below
                // 1 gwei, `perGasWei * gas` stays under 10^9 wei, and the subsequent
                // `avaxCtoX(totFee)` (integer-divides by 10^9 to convert wei → nAVAX)
                // truncates to 0.  That's exactly how the fee silently became 0 even when
                // baseFee/gasPrice returned a "non-zero" value — they were returning a
                // value too small to survive the wei→nAVAX rounding.
                const MIN_PER_GAS_WEI = new BN('1000000000')  // 1 gwei
                const FALLBACK_PER_GAS_WEI = new BN('25000000000') // 25 gwei
                let perGasWei: BN
                let perGasSource = 'baseFee'
                try {
                    const bf = await GasHelper.getBaseFeeRecommended()
                    if (bf.gte(MIN_PER_GAS_WEI)) {
                        perGasWei = bf
                    } else {
                        perGasSource = 'gasPrice'
                        perGasWei = await GasHelper.getAdjustedGasPrice()
                    }
                } catch {
                    perGasSource = 'gasPrice'
                    perGasWei = await GasHelper.getAdjustedGasPrice()
                }
                if (perGasWei.lt(MIN_PER_GAS_WEI)) {
                    perGasSource = `${perGasSource}→fallback-25gwei`
                    perGasWei = FALLBACK_PER_GAS_WEI
                }

                const totFee = perGasWei.mul(new BN(gas))
                let feeNAvax = avaxCtoX(totFee)
                // Defensive: should never trigger now (per-gas ≥ 1 gwei × gas ≥ 10138
                // always yields ≥ 10138 nAVAX), but if avaxCtoX still rounds to 0
                // (e.g. gas computation returns 0 for an unexpected input shape),
                // floor the fee at 1e5 nAVAX (= 0.0001 AVAX) so the node never sees 0.
                if (feeNAvax.lten(0)) {
                    perGasSource = `${perGasSource}+navax-floor`
                    feeNAvax = new BN(100000)
                }
                console.log(
                    `[atomicImportC] per-gas=${perGasWei.toString(10)} wei (${perGasSource}), ` +
                    `gas=${gas}, totFee=${totFee.toString(10)} wei, ` +
                    `feeNAvax=${feeNAvax.toString(10)}`
                )
                let txIdVal = await wallet.value.importToCChain(source, feeNAvax)
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

            notificationsStore.add({
                type: 'success',
                title: 'Import Success',
                message: txIdVal,
            })

            setTimeout(() => {
                assetsStore.updateUTXOs()
                historyStore.updateTransactionHistory()
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
