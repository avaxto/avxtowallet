<template>
    <div class="new_family">
        <div>
            <p>{{ $t('studio.family.desc') }}</p>
            <form @submit.prevent="submit" v-if="!isSuccess">
                <div style="display: flex">
                    <div style="flex-grow: 1">
                        <label>{{ $t('studio.family.label1') }}</label>
                        <input
                            type="text"
                            placeholder="Name"
                            v-model="name"
                            style="width: 100%"
                            maxlength="128"
                        />
                    </div>
                    <div class="symbol">
                        <label>{{ $t('studio.family.label2') }}</label>
                        <input
                            type="text"
                            placeholder="xxxx"
                            v-model="symbol"
                            max="4"
                            maxlength="4"
                        />
                    </div>
                </div>

                <div>
                    <label>{{ $t('studio.family.label3') }}</label>
                    <input
                        type="number"
                        placeholder="Name of the Collection"
                        min="1"
                        max="1024"
                        v-model="groupNum"
                    />
                </div>
                <div>
                    <p>{{ $t('studio.family.fee') }}: {{ txFee.toLocaleString() }} AVAX</p>
                </div>
                <p v-if="error" class="err">{{ error }}</p>
                <v-btn :loading="isLoading" type="submit" class="button_secondary" small>
                    {{ $t('studio.family.submit') }}
                </v-btn>
            </form>
            <div class="success_cont" v-if="isSuccess">
                <p style="color: var(--success); margin: 12px 0 !important">
                    <fa icon="check-circle"></fa>
                    {{ $t('studio.family.success.desc') }}
                </p>
                <div>
                    <label>{{ $t('studio.family.success.label1') }}</label>
                    <p style="word-break: break-all">{{ txId }}</p>
                </div>
                <div>
                    <label>{{ $t('studio.family.success.label2') }}</label>
                    <p>{{ name }}</p>
                </div>
                <div>
                    <label>{{ $t('studio.family.success.label3') }}</label>
                    <p>{{ symbol }}</p>
                </div>
                <div>
                    <label>{{ $t('studio.family.success.label4') }}</label>
                    <p>{{ groupNum }}</p>
                </div>
                <v-btn class="button_secondary" small @click="cancel" depressed>
                    {{ $t('studio.family.back') }}
                </v-btn>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { useAssetsStore, useHistoryStore, useMainStore, useNotificationsStore } from '@/stores'
import { BN } from '@/avalanche'
import { pChain } from '@/AVA'
import { bnToBig } from '@/helpers/helper'
import Big from 'big.js'

export default defineComponent({
    name: 'NewCollectibleFamily',
    emits: ['cancel'],
    setup(_, { emit }) {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const historyStore = useHistoryStore()
        const name = ref('')
        const symbol = ref('')
        const groupNum = ref(1)
        const isLoading = ref(false)
        const isSuccess = ref(false)
        const error = ref('')
        const txId = ref('')

        const txFee = computed((): Big => {
            return bnToBig(pChain.getCreationTxFee(), 9)
        })

        const mintUtxos = computed(() => {
            return assetsStore.nftMintUTXOs
        })

        watch(() => symbol.value, (val: string) => {
            let newVal = val.toUpperCase()
            // Remove numbers
            newVal = newVal.replace(/[0-9]/g, '')
            symbol.value = newVal
        })

        const validate = (): boolean => {
            if (symbol.value.length === 0) {
                error.value = 'You must provide a symbol.'
                return false
            } else if (symbol.value.length > 4) {
                error.value = 'Symbol must be 4 characters max.'
                return false
            } else if (groupNum.value < 1) {
                error.value = 'Number of groups must be at least 1.'
                return false
            }
            return true
        }

        const submit = async () => {
            if (!validate()) {
                return
            }
            let wallet = mainStore.activeWallet
            if (!wallet) return

            error.value = ''
            isLoading.value = true

            let nameTrimmed = name.value.trim()
            let symbolTrimmed = symbol.value.trim()

            try {
                let txIdValue = await wallet.createNftFamily(nameTrimmed, symbolTrimmed, groupNum.value)
                console.log(txIdValue)
                onSuccess(txIdValue)
            } catch (e) {
                onError(e)
            }
        }

        const cancel = () => {
            emit('cancel')
        }

        const onError = (e: any) => {
            error.value = e
            console.error(e)
            isLoading.value = false
        }

        const onSuccess = (txIdValue: string) => {
            isLoading.value = false
            isSuccess.value = true
            txId.value = txIdValue

            notificationsStore.add({
                type: 'success',
                title: 'Success',
                message: 'Collectible family created.',
            })

            setTimeout(() => {
                assetsStore.updateUTXOs()
                historyStore.updateTransactionHistory()
            }, 3000)
        }

        return {
            name,
            symbol,
            groupNum,
            isLoading,
            isSuccess,
            error,
            txId,
            txFee,
            mintUtxos,
            validate,
            submit,
            cancel,
            onError,
            onSuccess
        }
    }
})
</script>
<style scoped lang="scss">
.new_family {
    max-width: 100%;
    width: 340px;
    //display: grid;
    //grid-template-columns: 1fr 350px;
}
form > div {
    margin: 12px 0;
}

label {
    margin-top: 6px;
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 3px;
}

input {
    display: block;
    background-color: var(--bg-light);
    color: var(--primary-color);
    padding: 6px 14px;
    font-size: 13px;
}

.symbol {
    margin-left: 12px;
    > input {
        width: 60px;
        text-align: center;
    }
}

.groups {
    //display: grid;
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    //grid-template-columns: repeat(5, 1fr);

    > div {
        margin: 4px;
        background-color: var(--bg-light);
        width: 45px;
        height: 45px;
    }
}

.success_cont {
    > div {
        padding: 3px 12px;
        margin-bottom: 5px;
        background-color: var(--bg-light);
    }

    .v-btn {
        margin-top: 12px;
    }
}
</style>
