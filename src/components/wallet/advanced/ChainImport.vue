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
import { bintools } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
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

        const refreshBeforeImport = async () => {
            if (!wallet.value) return
            await Promise.allSettled([
                assetsStore.updateUTXOs(),
                wallet.value.getEthBalance(),
            ])
        }

        const atomicImportX = async (sourceChain: ExportChainsX) => {
            beforeSubmit()
            if (!wallet.value) return
            await refreshBeforeImport()

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
            await refreshBeforeImport()
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
            await refreshBeforeImport()
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

                // Per-gas price (wei).
                // We use 2× the raw baseFee rather than the 1.25× "recommended"
                // value because Avalanche allows baseFee to rise 12.5% per block.
                // Over the ~5 s between export and import (≈4 blocks), the fee
                // can increase by up to 1.125^4 ≈ 1.6×.  A 25% buffer fails
                // consistently under mild congestion; 2× covers the drift.
                // Floor: 50 gwei (2× the Avalanche C-chain minimum of 25 gwei).
                const FALLBACK_PER_GAS_WEI = new BN('50000000000') // 50 gwei
                let perGasWei: BN
                let perGasSource = 'baseFee×2'
                try {
                    const bf = await GasHelper.getBaseFee()
                    perGasWei = BN.max(bf.muln(2), FALLBACK_PER_GAS_WEI)
                } catch {
                    try {
                        perGasSource = 'gasPrice×2'
                        perGasWei = BN.max((await GasHelper.getGasPrice()).muln(2), FALLBACK_PER_GAS_WEI)
                    } catch {
                        perGasSource = 'fallback-50gwei'
                        perGasWei = FALLBACK_PER_GAS_WEI
                    }
                }

                const totFee = perGasWei.mul(new BN(gas))
                let feeNAvax = avaxCtoX(totFee)
                if (feeNAvax.lten(0)) {
                    perGasSource = `${perGasSource}+navax-floor`
                    // ~2× the Avalanche minimum import fee (25 gwei × 11228 gas ≈ 280 700 nAVAX)
                    feeNAvax = new BN(600000)
                }
                console.log(
                    `[atomicImportC] per-gas=${perGasWei.toString(10)} wei (${perGasSource}), ` +
                    `gas=${gas}, totFee=${totFee.toString(10)} wei, ` +
                    `feeNAvax=${feeNAvax.toString(10)}`
                )
                // Guard: ensure the atomic UTXOs contain enough AVAX to cover
                // the import fee — the node rejects with "import tx flow check
                // failed due to: insufficient funds" if they don't.
                const avaxAssetId = assetsStore.AVA_ASSET_ID
                if (avaxAssetId) {
                    const avaxIdBuf = bintools.cb58Decode(avaxAssetId)
                    const totalAvax = utxos.reduce((sum: BN, u: any) => {
                        if (u.getAssetID().equals(avaxIdBuf)) {
                            return sum.add((u.getOutput() as any).getAmount() as BN)
                        }
                        return sum
                    }, new BN(0))
                    if (totalAvax.lte(feeNAvax)) {
                        const totalStr = bnToBig(totalAvax, 9).toFixed(4)
                        const feeStr = bnToBig(feeNAvax, 9).toFixed(4)
                        throw new Error(
                            `Import fee (${feeStr} AVAX) is too high for the importable amount (${totalStr} AVAX). ` +
                            `Export a larger AVAX amount to C-chain first.`
                        )
                    }
                }

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
