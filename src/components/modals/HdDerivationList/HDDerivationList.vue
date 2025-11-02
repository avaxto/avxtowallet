<template>
    <div class="list_cont no_scroll_bar">
        <v-tabs grow>
            <v-tab>Internal</v-tab>
            <v-tab>External</v-tab>
            <v-tab>Platform</v-tab>
            <v-tab-item>
                <HdChainTable
                    :addresses="addrsInternal"
                    :balance-dict="keyBalancesInternal"
                    :wallet="wallet"
                    :path="1"
                    :helper="internalHelper"
                ></HdChainTable>
            </v-tab-item>
            <v-tab-item>
                <HdChainTable
                    :addresses="addrsExternal"
                    :balance-dict="keyBalancesExternal"
                    :wallet="wallet"
                    :path="0"
                    :helper="externalHelper"
                ></HdChainTable>
            </v-tab-item>
            <v-tab-item>
                <HdChainTable
                    :addresses="addrsPlatform"
                    :balance-dict="keyBalancesPlatform"
                    :wallet="wallet"
                    :path="0"
                    :helper="platformHelper"
                ></HdChainTable>
            </v-tab-item>
        </v-tabs>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { useStore } from '@/stores'

import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import { KeyPair as AVMKeyPair, UTXOSet as AVMUTXOSet } from '@/avalanche/apis/avm'
import { UTXOSet as PlatformUTXOSet } from '@/avalanche/apis/platformvm'
import { ava, bintools } from '@/AVA'
import Big from 'big.js'
import AvaAsset from '@/js/AvaAsset'
import { DerivationListBalanceDict } from '@/components/modals/HdDerivationList/types'
import { LedgerWallet } from '../../../js/wallets/LedgerWallet'
import { bnToBig } from '@/helpers/helper'
import { BN } from '@/avalanche'
import HdChainTable from '@/components/modals/HdDerivationList/HdChainTable.vue'

export default defineComponent({
    name: 'HDDerivationList',
    components: {
        HdChainTable,
    },
    props: {
        wallet: {
            type: Object as () => MnemonicWallet | LedgerWallet,
            required: true
        }
    },
    setup(props) {
        const store = useStore()
        
        const addrsExternal = ref<string[]>([])
        const addrsInternal = ref<string[]>([])
        const addrsPlatform = ref<string[]>([])

        watch(() => props.wallet.internalHelper.utxoSet, () => {
            addrsInternal.value = props.wallet.internalHelper.getAllDerivedAddresses()
        }, { immediate: true })

        watch(() => props.wallet.externalHelper.utxoSet, () => {
            addrsExternal.value = props.wallet.externalHelper.getAllDerivedAddresses()
        }, { immediate: true })

        watch(() => props.wallet.platformHelper.utxoSet, () => {
            addrsPlatform.value = props.wallet.platformHelper.getAllDerivedAddresses()
        }, { immediate: true })

        const internalHelper = computed(() => {
            return props.wallet.internalHelper
        })

        const externalHelper = computed(() => {
            return props.wallet.externalHelper
        })

        const platformHelper = computed(() => {
            return props.wallet.platformHelper
        })

        const assetsDict = computed(() => {
            return store.state.Assets.assetsDict
        })

        const utxoSetToBalanceDict = (
            set: AVMUTXOSet | PlatformUTXOSet,
            addrs: string[]
        ): DerivationListBalanceDict[] => {
            let assets: AvaAsset[] = store.state.Assets.assets

            let denoms: number[] = assets.map((asset) => {
                return asset.denomination
            })
            let assetIds: string[] = store.getters['Assets/assetIds']

            let res = []
            for (var i = 0; i < addrs.length; i++) {
                let balDict: DerivationListBalanceDict = {}
                let addrBuff = bintools.stringToAddress(addrs[i])
                assetIds.forEach((assetId, index) => {
                    let bal: BN = set.getBalance([addrBuff], assetId)

                    if (!bal.isZero()) {
                        let balBig = bnToBig(bal, denoms[index])
                        balDict[assetId] = balBig
                    }
                })
                res.push(balDict)
            }
            return res
        }

        const keyBalancesExternal = computed((): DerivationListBalanceDict[] => {
            let wallet = props.wallet
            let utxoSet = wallet.externalHelper.utxoSet as AVMUTXOSet
            let addrs = addrsExternal.value

            return utxoSetToBalanceDict(utxoSet, addrs)
        })

        const keyBalancesInternal = computed((): DerivationListBalanceDict[] => {
            let wallet = props.wallet
            let utxoSet = wallet.internalHelper.utxoSet
            let addrs = addrsInternal.value
            return utxoSetToBalanceDict(utxoSet, addrs)
        })

        const keyBalancesPlatform = computed((): DerivationListBalanceDict[] => {
            let wallet = props.wallet
            let utxoSet = wallet.platformHelper.utxoSet
            let addrs = addrsPlatform.value
            return utxoSetToBalanceDict(utxoSet, addrs)
        })

        return {
            addrsExternal,
            addrsInternal,
            addrsPlatform,
            internalHelper,
            externalHelper,
            platformHelper,
            assetsDict,
            keyBalancesExternal,
            keyBalancesInternal,
            keyBalancesPlatform
        }
    }
})
</script>

<style scoped lang="scss">
.list_cont {
    max-height: 60vh;
    min-height: 290px;
    /*height: 290px;*/
    position: relative;
    overflow: scroll;
}

.list_row {
    border-bottom: 1px solid var(--bg-light);

    &:last-of-type {
        border: none;
    }
}

.headers {
    position: sticky;
    top: 0;
    border-bottom: 1px solid var(--bg-light);
    font-weight: bold;
    background-color: var(--bg);
}

.headers,
.list_row {
    display: grid;
    grid-template-columns: 35px 2fr 1fr;
    padding: 5px 0px;
    column-gap: 10px;
}

.col_bal {
    text-align: right;
    padding-right: 15px;
    padding-left: 15px;
}

.empty {
    width: 100%;
    text-align: center;
    padding: 30px;
}

.warn_row {
    padding: 14px;
    text-align: center;
    color: #fff;
    background-color: var(--secondary-color);
}

.more_address {
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    button {
        color: var(--secondary-color);
    }
}
</style>
