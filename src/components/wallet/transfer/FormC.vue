<template>
    <div class="cols">
        <div class="form">
            <slot></slot>
            <div class="table_title">
                <p>{{ $t('transfer.tx_list.amount') }}</p>
                <p>{{ $t('transfer.tx_list.token') }}</p>
            </div>
            <div class="list_item">
                <EVMInputDropdown
                    @amountChange="onAmountChange"
                    @tokenChange="onTokenChange"
                    @collectibleChange="onCollectibleChange"
                    :disabled="isConfirm"
                    ref="token_in"
                    :gas-price="gasPrice"
                    :gas-limit="gasLimit"
                ></EVMInputDropdown>
            </div>
        </div>
        <div class="right_col">
            <div class="to_address">
                <h4>{{ $t('transfer.to') }}</h4>
                <qr-input
                    v-model="addressIn"
                    class="qrIn"
                    placeholder="xxx"
                    :disabled="isConfirm"
                ></qr-input>
            </div>
            <div class="gas_cont">
                <div>
                    <h4>
                        {{ $t('transfer.c_chain.gasPrice') }}
                        <br />
                        <small>Adjusted automatically according to network load.</small>
                    </h4>
                    <p></p>
                    <input
                        type="number"
                        v-model="gasPriceNumber"
                        min="0"
                        inputmode="numeric"
                        disabled
                    />
                </div>
                <div>
                    <h4>{{ $t('transfer.c_chain.gasLimit') }}</h4>
                    <template>
                        <p v-if="!isConfirm" style="font-size: 13px">
                            Gas Limit will be automatically calculated after you click Confirm.
                        </p>
                        <p v-else class="confirm_data">{{ gasLimit }}</p>
                    </template>
                </div>
            </div>

            <div class="fees" v-if="isConfirm">
                <p>
                    {{ $t('transfer.fee_tx') }}
                    <span>{{ maxFeeText }} AVAX</span>
                </p>
                <p>
                    <span>${{ maxFeeUSD.toLocaleString(2) }} USD</span>
                </p>
            </div>
            <template v-if="!isSuccess">
                <p class="err">{{ err }}</p>
                <v-btn
                    class="button_primary checkout"
                    depressed
                    block
                    @click="confirm"
                    :disabled="!canConfirm"
                    v-if="!isConfirm"
                >
                    {{ $t('transfer.c_chain.confirm') }}
                </v-btn>
                <template v-else>
                    <v-btn
                        class="button_primary checkout"
                        depressed
                        block
                        @click="submit"
                        :loading="isLoading"
                    >
                        {{ $t('transfer.send') }}
                    </v-btn>
                    <v-btn
                        class="checkout"
                        style="color: var(--primary-color)"
                        text
                        block
                        @click="cancel"
                        small
                    >
                        {{ $t('transfer.c_chain.cancel') }}
                    </v-btn>
                </template>
            </template>
            <template v-else>
                <p style="color: var(--success)">
                    <fa icon="check-circle"></fa>
                    {{ $t('transfer.c_chain.success.desc') }}
                </p>
                <div>
                    <label>{{ $t('transfer.c_chain.success.label1') }}</label>
                    <p class="confirm_data" style="word-break: break-all">
                        {{ txHash }}
                    </p>
                </div>
                <v-btn
                    style="margin: 14px 0"
                    :disabled="!canSendAgain"
                    class="button_primary"
                    small
                    block
                    @click="startAgain"
                >
                    {{ $t('transfer.c_chain.reset') }}
                </v-btn>
            </template>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, ref, markRaw, onMounted, onBeforeUnmount } from 'vue'
import { useMainStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import AvaxInput from '@/components/misc/AvaxInput.vue'
import { priceDict } from '@/types'
import { AvalancheAccount } from '@avalanche-sdk/client/accounts'
import {
    GasHelper,
    TxHelper,
    bnToBigAvaxX,
    bnToBigAvaxC,
    bnToAvaxC,
} from '@/avalanche-wallet-sdk'

import { QrInput } from '@/vue_components'
import Big from 'big.js'
import { BN } from '@/avalanche'
import { bnToBig } from '@/helpers/helper'
import { web3 } from '@/evm'
import EVMInputDropdown from '@/components/misc/EVMInputDropdown/EVMInputDropdown.vue'
import Erc20Token from '@/js/Erc20Token'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import { WalletHelper } from '@/helpers/wallet_helper'

export default defineComponent({
    name: 'FormC',
    components: {
        EVMInputDropdown,
        AvaxInput,
        QrInput,
    },
    setup() {
        const mainStore = useMainStore()
        const { t } = useI18n()

        const isConfirm = ref(false)
        const isSuccess = ref(false)
        const addressIn = ref('')
        const amountIn = ref(markRaw(new BN(0)))
        const gasPrice = ref(markRaw(new BN(225000000000)))
        const gasPriceInterval = ref<ReturnType<typeof setTimeout> | undefined>(undefined)
        const gasLimit = ref(21000)
        const err = ref('')
        const isLoading = ref(false)

        const formAddress = ref('')
        const formAmount = ref(new BN(0))
        const formToken = ref<Erc20Token | 'native'>('native')
        const canSendAgain = ref(false)

        const isCollectible = ref(false)
        const formCollectible = ref<iErc721SelectInput | null>(null)

        const txHash = ref('')

        // Template refs
        const token_in = ref<InstanceType<typeof EVMInputDropdown> | null>(null)

        const updateGasPrice = async () => {
            gasPrice.value = markRaw(await GasHelper.getAdjustedGasPrice())
        }

        // Lifecycle methods
        onMounted(() => {
            // Update gas price automatically
            updateGasPrice()
            gasPriceInterval.value = setInterval(() => {
                if (!isConfirm.value) {
                    updateGasPrice()
                }
            }, 15000)
        })

        onBeforeUnmount(() => {
            if (gasPriceInterval.value) {
                clearInterval(gasPriceInterval.value)
            }
        })

        // Continue with rest of component logic...

        // ---- Computed ----

        const wallet = computed(() => mainStore.activeWallet as any)

        const gasPriceNumber = computed({
            get: () => gasPrice.value.div(new BN(1e9)).toNumber(),
            set: (val: number) => {
                gasPrice.value = new BN(val).mul(new BN(1e9))
            },
        })

        const maxFee = computed((): BN => {
            return gasPrice.value.mul(new BN(gasLimit.value))
        })

        const maxFeeText = computed((): string => {
            return bnToAvaxC(maxFee.value)
        })

        const maxFeeUSD = computed((): Big => {
            const prices = (mainStore as any).prices
            const usd = prices?.usd
            if (typeof usd !== 'number' || isNaN(usd)) return Big(0)
            return bnToBigAvaxC(maxFee.value).times(usd)
        })

        const canConfirm = computed((): boolean => {
            if (!addressIn.value) return false
            if (isCollectible.value) {
                return !!formCollectible.value
            }
            
            return amountIn.value.gt(new BN(0))
        })

        // ---- Event handlers ----

        const onAmountChange = (val: BN) => {
            amountIn.value = markRaw(val)
        }

        const onTokenChange = (token: Erc20Token | 'native') => {
            formToken.value = token
        }

        const onCollectibleChange = (val: iErc721SelectInput | null) => {
            formCollectible.value = val
            isCollectible.value = !!val
        }

        // ---- Actions ----

        const confirm = async () => {
            formAddress.value = addressIn.value
            formAmount.value = amountIn.value
            err.value = ''

            // Estimate gas limit for ERC20 / native
            try {
                if (formToken.value !== 'native' && formToken.value instanceof Erc20Token) {
                    gasLimit.value = await (wallet.value as any).estimateGas(
                        formAddress.value,
                        formAmount.value,
                        formToken.value
                    )
                } else {
                    gasLimit.value = 21000
                }
            } catch (e: any) {
                gasLimit.value = 21000
            }
            isConfirm.value = true
        }

        const cancel = () => {
            isConfirm.value = false
            err.value = ''
        }

        const submit = async () => {
            isLoading.value = true
            err.value = ''
            try {
                let hash: string
                if (isCollectible.value && formCollectible.value) {
                    hash = await WalletHelper.sendErc721(
                        wallet.value,
                        formAddress.value,
                        gasPrice.value,
                        gasLimit.value,
                        formCollectible.value.token,
                        formCollectible.value.id
                    )
                } else if (formToken.value !== 'native' && formToken.value instanceof Erc20Token) {
                    hash = await WalletHelper.sendErc20(
                        wallet.value,
                        formAddress.value,
                        formAmount.value,
                        gasPrice.value,
                        gasLimit.value,
                        formToken.value
                    )
                } else {
                    hash = await WalletHelper.sendEth(
                        wallet.value,
                        formAddress.value,
                        formAmount.value,
                        gasPrice.value,
                        gasLimit.value
                    )
                }
                txHash.value = hash
                isSuccess.value = true
                canSendAgain.value = true
            } catch (e: any) {
                err.value = e.message || String(e)
            } finally {
                isLoading.value = false
            }
        }

        const startAgain = () => {
            isConfirm.value = false
            isSuccess.value = false
            addressIn.value = ''
            amountIn.value = markRaw(new BN(0))
            txHash.value = ''
            canSendAgain.value = false
            err.value = ''
            token_in.value?.clear?.()
        }

        return {
            isConfirm,
            isSuccess,
            addressIn,
            amountIn,
            gasPrice,
            gasLimit,
            err,
            isLoading,
            formAddress,
            formAmount,
            formToken,
            canSendAgain,
            isCollectible,
            formCollectible,
            txHash,
            token_in,
            updateGasPrice,
            gasPriceNumber,
            maxFeeText,
            maxFeeUSD,
            canConfirm,
            onAmountChange,
            onTokenChange,
            onCollectibleChange,
            confirm,
            cancel,
            submit,
            startAgain,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

h4 {
    display: block;
    text-align: left;
    font-size: 12px;
    font-weight: bold;
    margin: 12px 0;
}

.cols {
    display: grid;
    grid-template-columns: 1fr 1fr 300px;
    column-gap: 45px;
    padding: 0;
}

.form {
    padding-right: 60px;
    grid-column: 1/3;
    border-right: 1px solid var(--bg-light);
}

.list_item {
    margin-bottom: 12px;
}
.table_title {
    display: flex;
    flex-direction: row;
    justify-content: space-between;
    margin: 0;
    p {
        font-weight: bold;
        padding: 12px 0;
    }
}

input,
.confirm_data {
    background-color: var(--bg-light);
    padding: 6px 12px;
    color: var(--primary-color);
    font-size: 14px;
}
.gas_cont {
    column-gap: 14px;
    input {
        width: 100%;
    }
}

label {
    color: var(--primary-color-light);
    font-size: 12px;
    font-weight: bold;
    margin: 2px 0 !important;
}

.fees {
    display: flex;
    flex-direction: column;
    margin-top: 14px;
    border-top: 1px solid var(--bg-light);
    padding-top: 14px;
}
.fees p {
    text-align: left;
    font-size: 13px;
    color: var(--primary-color-light);
}

.fees span {
    float: right;
}
.to_address {
}

.checkout {
    margin-top: 14px;
}

.right_col {
    padding-bottom: 30px;
}

@include main.medium-device {
    .cols {
        grid-template-columns: 1fr 1fr 220px;
        column-gap: 25px;
    }
}

@include main.mobile-device {
    .cols {
        display: block;
    }
    .form {
        padding-bottom: 14px;
        border: none;
        padding-right: 0;
    }
    .gas_cont {
        display: block;

        > div {
            margin-bottom: 14px;
            display: flex;
            flex-direction: column;
        }
    }
}
</style>
