<template>
    <modal ref="modal" title="Export AVAX Transfers" class="modal_main">
        <div class="csv_modal_body">
            <p>Export AVAX transactions including cross chain transfers on X,P and C chains.</p>
            <p class="err" v-if="error">{{ error }}</p>
            <v-btn
                class="button_secondary"
                small
                @click="submit"
                :disabled="!canSubmit"
                :loading="isLoading"
                depressed
                block
                style="margin-top: 12px"
            >
                Download CSV File
            </v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from 'vuex'

import Modal from '@/components/modals/Modal.vue'
import { CsvRowAvaxTransferData, ITransactionData, UTXO } from '@/store/modules/history/types'
import { bnToBig } from '@/helpers/helper'
const generate = require('csv-generate')
import { downloadCSVFile } from '@/store/modules/history/history_utils'
import { createCsvNormal, getHistoryForOwnedAddresses } from '@avalabs/avalanche-wallet-sdk'

export default defineComponent({
    name: 'ExportAvaxCsvModal',
    components: {
        Modal,
    },
    setup() {
        const store = useStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const error = ref<Error | null>(null)
        const isLoading = ref(false)

        const open = (): void => {
            error.value = null
            modal.value?.open()
        }

        const canSubmit = computed(() => {
            return true
        })

        const transactions = computed((): ITransactionData[] => {
            return store.state.History.allTransactions
        })

        const wallet = computed(() => {
            return store.state.activeWallet
        })

        const xAddresses = computed((): string[] => {
            return wallet.value.getAllAddressesX()
        })

        const xAddressesStripped = computed((): string[] => {
            return xAddresses.value.map((addr: string) => addr.split('-')[1])
        })

        const avaxID = computed(() => {
            return store.state.Assets.AVA_ASSET_ID
        })

        const generateCSVFile = async () => {
            isLoading.value = true

            try {
                const hist = await getHistoryForOwnedAddresses(
                    wallet.value.getAllAddressesX(),
                    wallet.value.getAllAddressesP(),
                    wallet.value.getEvmAddressBech(),
                    wallet.value.getEvmAddress()
                )

                const encoding = 'data:text/csv;charset=utf-8,'
                const csvContent = createCsvNormal(hist)
                downloadCSVFile(encoding + csvContent, 'avax_transfers')
            } catch (e: any) {
                error.value = e
            }
            isLoading.value = false
        }

        const submit = () => {
            try {
                error.value = null
                generateCSVFile()
            } catch (e: any) {
                error.value = e
            }
        }

        return {
            modal,
            error,
            isLoading,
            open,
            canSubmit,
            transactions,
            wallet,
            xAddresses,
            xAddressesStripped,
            avaxID,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
.csv_modal_body {
    width: 420px;
    max-width: 100%;
    padding: 10px 20px;
}
</style>
