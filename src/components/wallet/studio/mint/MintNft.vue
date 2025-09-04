<template>
    <div>
        <div v-if="!mintUtxo">
            <p>{{ $t('studio.mint.desc') }}</p>
            <SelectMintUTXO @change="setUtxo" class="select_mint_utxo"></SelectMintUTXO>
        </div>
        <MintForm v-else :mint-utxo="mintUtxo" @clearUtxo="clearUtxo" @cancel="cancel"></MintForm>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, onMounted } from 'vue'
import { useStore } from 'vuex'
import { useRoute } from 'vue-router'
import { pChain } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'

import SelectMintUTXO from '@/components/wallet/studio/mint/SelectMintUtxo/SelectMintUTXO.vue'
import MintForm from '@/components/wallet/studio/mint/MintForm.vue'
import { UTXO } from 'avalanche/dist/apis/avm'

export default defineComponent({
    name: 'MintNft',
    components: {
        SelectMintUTXO,
        MintForm,
    },
    emits: ['cancel'],
    setup(props, { emit }) {
        const store = useStore()
        const route = useRoute()
        
        const isLoading = ref(false)
        const mintUtxo = ref<null | UTXO>(null)

        const txFee = computed((): Big => {
            return bnToBig(pChain.getTxFee(), 9)
        })

        const mintUtxos = computed(() => {
            return store.state.Assets.nftMintUTXOs
        })

        const submit = async () => {
            let wallet = store.state.activeWallet
            if (!wallet) return

            isLoading.value = true
            isLoading.value = false
        }

        const setUtxo = (utxo: UTXO) => {
            mintUtxo.value = utxo
        }

        const clearUtxo = () => {
            mintUtxo.value = null
        }

        const cancel = () => {
            emit('cancel')
        }

        onMounted(() => {
            let utxoId = route.query.utxo

            // Select the utxo in the query if possible
            if (utxoId) {
                let utxos: UTXO[] = mintUtxos.value

                for (var i = 0; i < utxos.length; i++) {
                    let utxo = utxos[i]
                    let id = utxo.getUTXOID()

                    if (id === utxoId) {
                        setUtxo(utxo)
                    }
                }
            }
        })

        return {
            isLoading,
            mintUtxo,
            txFee,
            mintUtxos,
            submit,
            setUtxo,
            clearUtxo,
            cancel
        }
    }
})
</script>
<style scoped lang="scss"></style>
