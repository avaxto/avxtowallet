<template>
    <div>
        <div class="utxos">
            <div v-if="isSender">
                <label v-if="!sentToSelf">Sent</label>
                <label v-else>Sent to self</label>
                <template v-if="!sentToSelf">
                    <BaseTxUtxo
                        v-for="(utxo, i) in sentUTXOs"
                        :key="i"
                        :utxo="utxo"
                        :ins="inputUTXOs"
                        :outs="outputUTXOs"
                        :is-sent="true"
                    ></BaseTxUtxo>
                </template>
                <template v-else>
                    <BaseTxUtxo
                        v-for="(utxo, i) in outputUTXOs"
                        :key="i"
                        :utxo="utxo"
                        :ins="inputUTXOs"
                        :outs="outputUTXOs"
                        :is-sent="true"
                    ></BaseTxUtxo>
                </template>
                <div class="nft_cols">
                    <!--                    <div class="nft_addr">-->
                    <!--                        <p v-for="addr in summary.collectibles.sent.addresses" :key="addr">-->
                    <!--                            to {{ 'X-' + addr }}-->
                    <!--                        </p>-->
                    <!--                    </div>-->
                    <!--                    <div class="nft_fams">-->
                    <!--                        <BaseTxNFTOutput-->
                    <!--                            v-for="(asset, assetId) in summary.collectibles.sent.assets"-->
                    <!--                            :key="assetId"-->
                    <!--                            :asset-i-d="assetId"-->
                    <!--                            :summary="asset"-->
                    <!--                            class="nft_out"-->
                    <!--                        ></BaseTxNFTOutput>-->
                    <!--                    </div>-->
                </div>
            </div>
            <div v-else>
                <label>Received</label>
                <BaseTxUtxo
                    v-for="(utxo, i) in receivedUTXOs"
                    :key="i"
                    :utxo="utxo"
                    :ins="inputUTXOs"
                    :outs="outputUTXOs"
                    :is-sent="true"
                ></BaseTxUtxo>
                <!--                <BaseTxOutput-->
                <!--                    v-for="(asset, assetId) in tokensReceived"-->
                <!--                    :key="assetId"-->
                <!--                    :asset-i-d="assetId"-->
                <!--                    :summary="asset"-->
                <!--                ></BaseTxOutput>-->
                <!--                <div class="nft_cols">-->
                <!--                    <div class="nft_addr">-->
                <!--                        <p v-for="addr in summary.collectibles.received.addresses" :key="addr">-->
                <!--                            from {{ 'X-' + addr }}-->
                <!--                        </p>-->
                <!--                    </div>-->
                <!--                    <div class="nft_fams">-->
                <!--                        <BaseTxNFTOutput-->
                <!--                            v-for="(asset, assetId) in summary.collectibles.received.assets"-->
                <!--                            :key="assetId"-->
                <!--                            :asset-i-d="assetId"-->
                <!--                            :summary="asset"-->
                <!--                            class="nft_out"-->
                <!--                        ></BaseTxNFTOutput>-->
                <!--                    </div>-->
                <!--                </div>-->
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useStore } from '@/stores'
import { TransactionValueDict } from '@/components/SidePanels/types'
import { PayloadBase, PayloadTypes } from '@/avalanche/utils'
import { BN, Buffer } from '@/avalanche'
import { WalletType } from '@/js/wallets/types'
import { avm, pChain } from '@/AVA'

import TxHistoryValue from '@/components/SidePanels/TxHistoryValue.vue'
import TxHistoryValueFunctional from '@/components/SidePanels/History/TxHistoryValueFunctional.vue'
import TxHistoryNftFamilyGroup from '@/components/SidePanels/TxHistoryNftFamilyGroup.vue'
import { getTransactionSummary } from '@/helpers/history_helper'
import BaseTxOutput from '@/components/SidePanels/History/ViewTypes/BaseTxOutput.vue'
import BaseTxNFTOutput from '@/components/SidePanels/History/ViewTypes/BaseTxNFTOutput.vue'
import { isOwnedUTXO } from '@/js/Glacier/isOwnedUtxo'
import { TransactionTypeName, XChainTransaction } from '@/js/Glacier/models'
import BaseTxUtxo from '@/components/SidePanels/History/ViewTypes/BaseTxUtxo.vue'

let payloadtypes = PayloadTypes.getInstance()

export default defineComponent({
    name: 'BaseTx',
    components: {
        BaseTxUtxo,
        BaseTxNFTOutput,
        BaseTxOutput,
        TxHistoryValue,
        TxHistoryValueFunctional,
        TxHistoryNftFamilyGroup,
    },
    props: {
        transaction: {
            type: Object as () => XChainTransaction,
            required: true
        }
    },
    setup(props) {
        const store = useStore()

        const inputUTXOs = computed(() => {
            return props.transaction.consumedUtxos || []
        })

        const outputUTXOs = computed(() => {
            return props.transaction.emittedUtxos || []
        })

        /**
         * All X/P addresses used by the wallet
         */
        const addresses = computed(() => {
            let wallet: WalletType | null = store.state.activeWallet
            if (!wallet) return []
            return wallet.getHistoryAddresses()
        })

        /**
         * Addresses stripped of the chain prefix
         */
        const addrsRaw = computed(() => {
            let addrs: string[] = addresses.value
            return addrs.map((addr) => addr.split('-')[1])
        })

        /**
         * Output UTXOs owned by this wallet
         */
        const receivedUTXOs = computed(() => {
            return outputUTXOs.value.filter((utxo) => {
                return isOwnedUTXO(utxo, addresses.value)
            })
        })

        /**
         * Output UTXOs not owned by this wallet
         */
        const sentUTXOs = computed(() => {
            const utxos = outputUTXOs.value.filter((utxo) => {
                return !isOwnedUTXO(utxo, addresses.value)
            })

            return utxos
        })

        /**
         * True if this wallet owns one of the input UTXOs
         */
        const isSender = computed(() => {
            return (
                inputUTXOs.value.filter((utxo) => {
                    return isOwnedUTXO(utxo, addresses.value)
                }).length > 0
            )
        })

        const sentToSelf = computed(() => {
            return isSender.value && !sentUTXOs.value.length
        })

        const hasReceived = computed(() => {
            return (
                props.transaction.emittedUtxos.filter((utxo) => {
                    return isOwnedUTXO(utxo, addresses.value)
                }).length > 0
            )
        })

        const type = computed(() => {
            return props.transaction.txType as TransactionTypeName
        })

        return {
            inputUTXOs,
            outputUTXOs,
            receivedUTXOs,
            sentUTXOs,
            sentToSelf,
            isSender,
            hasReceived,
            addresses,
            addrsRaw,
            type
        }
    }
})
</script>
<style scoped lang="scss">
label {
    font-size: 12px;
    color: var(--primary-color-light);
}
.nfts {
    display: flex;
    flex-wrap: wrap;
    margin-top: 5px;
    justify-content: flex-end;
    > div {
        margin-left: 5px;
    }
}

.nft_cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
}
.nft_addr {
    display: flex;
    flex-direction: column;
    justify-content: center;
    font-size: 12px;
    color: var(--primary-color-light);
    overflow: hidden;
    font-family: monospace;
    white-space: nowrap;

    p {
        overflow: hidden;
        text-overflow: ellipsis;
    }
}
.nft_fams {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: flex-end;
}

.nft_out {
    margin-bottom: 4px;
}
</style>
