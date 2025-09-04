<template>
    <div class="import_row" :export="isExport && !isExportReceiver">
        <p class="actionTitle">{{ actionTitle }} ({{ chainAlias }})</p>
        <div class="flex-column">
            <p v-if="isExportReceiver" class="amt">
                {{ toLocaleString(outputReceivedBalances, 9) }} AVAX
            </p>
            <template v-else>
                <p class="amt" v-for="(bal, key) in balances" :key="key">
                    {{ isExport ? '-' : '' }}{{ toLocaleString(bal.amount, bal.decimals) }}
                    {{ bal.symbol }}
                </p>
            </template>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from 'vuex'
import { avm, cChain, pChain } from '@/AVA'
import { BN } from 'avalanche'
import { bnToBig } from '@/helpers/helper'
import {
    isTransactionP,
    isTransactionX,
    TransactionType,
    XChainTransaction,
} from '@/js/Glacier/models'
import { getExportBalances } from '@/components/SidePanels/History/ViewTypes/getExportBalances'
import { WalletType } from '@/js/wallets/types'
import { isOwnedUTXO } from '@/js/Glacier/isOwnedUtxo'

function idToAlias(chainId: string | undefined) {
    if (chainId === pChain.getBlockchainID()) {
        return 'P'
    } else if (chainId === avm.getBlockchainID()) {
        return 'X'
    } else if (chainId === cChain.getBlockchainID()) {
        return 'C'
    }
    return chainId
}

export default defineComponent({
    name: 'ImportExport',
    props: {
        transaction: {
            type: Object as () => TransactionType,
            required: true
        }
    },
    setup(props) {
        const store = useStore()

        const toLocaleString = (val: BN, decimals: number) => {
            return bnToBig(val, decimals).toLocaleString()
        }

        const getAssetFromID = (id: string) => {
            return store.state.Assets.assetsDict[id]
        }

        const isExport = computed(() => {
            return props.transaction.txType === 'ExportTx'
        })

        const actionTitle = computed(() => {
            if (isExport.value) {
                if (isExportReceiver.value) {
                    return 'Received'
                } else {
                    return 'Export'
                }
            } else {
                return 'Import'
            }
        })

        /**
         * Returns the chain id we are exporting/importing to
         */
        const destinationChainId = computed(() => {
            //TODO: Remove type when PChainTx is ready
            return (props.transaction as XChainTransaction).destinationChain!
        })

        const sourceChainId = computed(() => {
            //TODO: Remove type when PChainTx is ready
            return (props.transaction as XChainTransaction).sourceChain
        })

        const chainAlias = computed(() => {
            let chainId = isExport.value ? sourceChainId.value : destinationChainId.value
            return idToAlias(chainId)
        })

        /**
         * All X/P addresses used by the wallet
         */
        const addresses = computed(() => {
            let wallet: WalletType | null = store.state.activeWallet
            if (!wallet) return []
            return wallet.getHistoryAddresses()
        })

        const ownedInputs = computed(() => {
            const tx = props.transaction
            if (isTransactionP(tx)) {
                return tx.consumedUtxos.filter((utxo) => {
                    return isOwnedUTXO(utxo, addresses.value)
                })
            } else {
                return []
            }
        })

        const ownedOutputs = computed(() => {
            const tx = props.transaction
            if (isTransactionP(tx)) {
                return tx.emittedUtxos.filter((utxo) => {
                    return isOwnedUTXO(utxo, addresses.value)
                })
            } else {
                return []
            }
        })

        const sourceChainAlias = computed(() => {
            return idToAlias(sourceChainId.value)
        })

        const wallet = computed((): WalletType => {
            return store.state.activeWallet
        })

        const balances = computed(() => {
            return getExportBalances(props.transaction, destinationChainId.value, getAssetFromID)
        })

        // If user received tokens from the export, but didnt consume any of their utxos
        // Essentially, the P chain sending hack
        const isExportReceiver = computed(() => {
            return isExport.value && ownedInputs.value.length === 0 && ownedOutputs.value.length > 0
        })

        const outputReceivedBalances = computed(() => {
            return ownedOutputs.value.reduce((agg, utxo) => {
                return agg.add(new BN(utxo.amount))
            }, new BN(0))
        })

        return {
            toLocaleString,
            getAssetFromID,
            isExport,
            actionTitle,
            destinationChainId,
            sourceChainId,
            chainAlias,
            addresses,
            ownedInputs,
            ownedOutputs,
            sourceChainAlias,
            wallet,
            balances,
            isExportReceiver,
            outputReceivedBalances
        }
    }
})
</script>
<style scoped lang="scss">
.import_row {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--primary-color-light);

    &[export] {
        .amt {
            color: #d04c4c;
        }
    }
}

.actionTitle {
    white-space: nowrap;
}

.amt {
    text-align: right;
    font-size: 15px;
    color: var(--success);
    word-break: normal;
}
</style>
