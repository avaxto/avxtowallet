<template>
    <div class="cols">
        <div class="batch_toggle_row">
            <slot></slot>
            <label class="batch_switch">
                <input type="checkbox" v-model="batchMode" />
                Batch send (multiple recipients)
            </label>
        </div>
        <BatchFormC v-if="batchMode"></BatchFormC>
        <template v-else>
        <div class="form">
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
            <div v-if="selectedTokenAddress" class="contract_row">
                <span class="contract_label">Verify that {{ selectedTokenSymbol }} CA - Contract Address Is Correct!</span>
                <div class="contract_addr">
                    <a
                        :href="selectedTokenExplorerUrl"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mono"
                        title="View contract on explorer"
                    >{{ selectedTokenAddress }}</a>
                    <CopyText :value="selectedTokenAddress" class="copy_btn"></CopyText>
                </div>
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
            <SignedTxExport
                v-if="offline.hasRecords"
                :records="offline.records"
                @done="startAgain"
            ></SignedTxExport>

            <template v-else-if="!isSuccess">
                <p class="err">{{ err }}</p>
                <SignOnlyToggle :disabled="isLoading"></SignOnlyToggle>
                <v-btn
                    v-if="err"
                    class="button_primary checkout"
                    depressed
                    block
                    @click="startAgain"
                >
                    {{ $t('transfer.c_chain.reset') }}
                </v-btn>
                <v-btn
                    v-else-if="isInjectedWallet"
                    class="button_primary checkout"
                    depressed
                    block
                    @click="sendOneClick"
                    :disabled="!canConfirm || isLoading"
                    :loading="isLoading"
                >
                    {{ $t('transfer.send') }}
                </v-btn>
                <v-btn
                    class="button_primary checkout"
                    depressed
                    block
                    @click="confirm"
                    :disabled="!canConfirm"
                    v-else-if="!isConfirm"
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
            <template v-else-if="isSuccess">
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
        </template>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, ref, markRaw, onMounted, onBeforeUnmount, watch } from 'vue'
import { useMainStore, useAssetsStore, useTransferPrefillStore } from '@/stores'
import { useI18n } from 'vue-i18n'
import AvaxInput from '@/components/misc/AvaxInput.vue'
import { priceDict } from '@/types'
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
import { bnToBig, errorToString } from '@/helpers/helper'
import { web3 } from '@/evm'
import EVMInputDropdown from '@/components/misc/EVMInputDropdown/EVMInputDropdown.vue'
import Erc20Token from '@/js/Erc20Token'
import { resolveErc20Token } from '@/helpers/erc20_resolve'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import { WalletHelper } from '@/helpers/wallet_helper'
import BatchFormC from '@/components/wallet/transfer/BatchFormC.vue'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'
import { useOfflineSigningStore, isOfflineTxId, useCChainSdkAssetsStore } from '@/stores'
import SignOnlyToggle from '@/components/misc/SignOnlyToggle.vue'
import SignedTxExport from '@/components/misc/SignedTxExport.vue'
import CopyText from '@/components/misc/CopyText.vue'

export default defineComponent({
    name: 'FormC',
    components: {
        EVMInputDropdown,
        AvaxInput,
        QrInput,
        BatchFormC,
        SignOnlyToggle,
        SignedTxExport,
        CopyText,
    },
    setup() {
        const mainStore = useMainStore()
        const assetsStore = useAssetsStore()
        const offline = useOfflineSigningStore()
        const transferPrefill = useTransferPrefillStore()
        const { t } = useI18n()

        const isConfirm = ref(false)
        const isSuccess = ref(false)
        const batchMode = ref(false)
        const addressIn = ref('')
        const amountIn = ref(markRaw(new BN(0)))
        const gasPrice = ref(markRaw(new BN(225000000000)))
        const gasPriceGwei = ref(225)
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
            try {
                const price = await GasHelper.getAdjustedGasPrice()
                gasPrice.value = markRaw(price)
                gasPriceGwei.value = price.div(new BN(1000000000)).toNumber()
            } catch (e) {
                console.warn('Gas price fetch failed', e)
            }
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

        // Signals that FormC's own mount (and therefore the EVMInputDropdown
        // template ref below) is actually in the DOM. We can't use nextTick()
        // for this: Wallet.vue wraps the router-view's <keep-alive> in a
        // <transition mode="out-in">, and on a component's genuinely first
        // mount (as opposed to a <keep-alive> reactivation, which reuses an
        // already-mounted instance) that transition defers the real DOM
        // patch — and therefore ref binding — past a plain microtask/
        // nextTick() until its enter animation is scheduled. onMounted()
        // fires exactly when the ref is guaranteed to be bound, however long
        // that takes, so we await a promise that resolves there instead.
        let resolveMounted: (() => void) | undefined
        const mountedPromise = new Promise<void>((resolve) => {
            resolveMounted = resolve
        })
        onMounted(() => resolveMounted?.())

        // Pre-select token from the transferPrefill store (set by the portfolio
        // page's "send" icons via goToTransfer() instead of a URL query string).
        // Watches transferPrefill.token so it re-runs on every navigation to
        // this page (onMounted only fires once when the component is already
        // alive). Guarded against out-of-order resolution: a fast second
        // click (or a slow first one) could otherwise let an older
        // resolveErc20Token() call land after a newer one.
        let requestId = 0
        watch(
            () => transferPrefill.token,
            async (tokenAddress) => {
                const thisRequest = ++requestId

                // This watcher's immediate run fires during setup(), before the
                // EVMInputDropdown template ref is bound — wait until FormC is
                // actually mounted so token_in.value is guaranteed to exist
                // below, on the very first navigation to this page as much as
                // on later ones.
                await mountedPromise
                if (thisRequest !== requestId) return

                if (!tokenAddress) {
                    // No token param — reset to native AVAX.
                    token_in.value?.setToken('native')
                    return
                }

                // Resolves to the assets store's own instance when the address
                // is already known there (ERC20Row's "send" icon only exists
                // for tokens that are, so this is the common case), otherwise
                // builds a throwaway one from the prefill store's metadata
                // (CChainSdkRow's SDK-only-discovered tokens) and fetches its
                // balance.
                const token = await resolveErc20Token(tokenAddress, {
                    name: transferPrefill.name,
                    symbol: transferPrefill.symbol,
                    decimals: transferPrefill.decimals,
                    logoUri: transferPrefill.logoUri,
                })
                if (thisRequest !== requestId) return
                token_in.value?.setToken(token)
            },
            { immediate: true }
        )

        onBeforeUnmount(() => {
            if (gasPriceInterval.value) {
                clearInterval(gasPriceInterval.value)
            }
        })

        // Continue with rest of component logic...

        // ---- Computed ----

        const wallet = computed(() => mainStore.activeWallet as any)

        // Injected wallets (Core App / MetaMask) sign+broadcast through the
        // extension's own confirmation UI, so this app's separate Confirm step
        // is redundant friction — collapse Confirm+Submit into a single click.
        // Mnemonic (and other local-key) wallets keep the 2-step flow since
        // there's no external confirmation prompt to lean on.
        const isInjectedWallet = computed((): boolean => wallet.value?.type === 'injected')

        // Contract address of the currently selected ERC20 (blank for native
        // AVAX or while a collectible is selected instead).
        const selectedTokenAddress = computed((): string => {
            if (isCollectible.value) return ''
            if (formToken.value === 'native') return ''
            return formToken.value.data.address
        })

        const selectedTokenSymbol = computed((): string => {
            if (formToken.value === 'native') return ''
            return formToken.value.data.symbol
        })

        const selectedTokenExplorerUrl = computed((): string => {
            if (!selectedTokenAddress.value) return ''
            const base =
                assetsStore.evmChainId === 43113
                    ? 'https://testnet.snowtrace.io'
                    : 'https://snowtrace.io'
            return `${base}/token/${selectedTokenAddress.value}`
        })

        const gasPriceNumber = computed({
            get: () => gasPriceGwei.value,
            set: (val: number) => {
                gasPriceGwei.value = val
                gasPrice.value = markRaw(new BN(val).mul(new BN(1000000000)))
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

        const sendOneClick = async () => {
            await confirm()
            if (isConfirm.value) {
                await submit()
            }
        }

        const submit = async () => {
            isLoading.value = true
            err.value = ''
            try {
                const hash: string = await authorizeSingle(
                    wallet.value,
                    'Send a C-chain transaction',
                    async () => {
                        if (isCollectible.value && formCollectible.value) {
                            return await WalletHelper.sendErc721(
                                wallet.value,
                                formAddress.value,
                                gasPrice.value,
                                gasLimit.value,
                                formCollectible.value.token,
                                formCollectible.value.id
                            )
                        } else if (
                            formToken.value !== 'native' &&
                            formToken.value instanceof Erc20Token
                        ) {
                            return await WalletHelper.sendErc20(
                                wallet.value,
                                formAddress.value,
                                formAmount.value,
                                gasPrice.value,
                                gasLimit.value,
                                formToken.value
                            )
                        } else {
                            return await WalletHelper.sendEth(
                                wallet.value,
                                formAddress.value,
                                formAmount.value,
                                gasPrice.value,
                                gasLimit.value
                            )
                        }
                    }
                )
                // A captured (not broadcast) transaction has a sentinel id —
                // the export panel renders instead of the success screen.
                if (!isOfflineTxId(hash)) {
                    txHash.value = hash
                    isSuccess.value = true

                    // Unlike the X-chain send path (Transfer.vue's onsuccess,
                    // via assetsStore.updateUTXOs()), nothing on the C-chain
                    // path refreshed balances after a broadcast — so the
                    // portfolio kept showing pre-send amounts until an
                    // unrelated poll tick happened to catch up. Covers all
                    // three C-chain balance sources: native AVAX, "Default
                    // Assets" ERC20s and the Glacier/chainkit-discovered
                    // "All Assets" list (shared store — also updates the
                    // Portfolio page even though it's kept-alive and won't
                    // remount to refetch on its own).
                    Promise.all([
                        wallet.value.getEthBalance(),
                        assetsStore.updateERC20Balances(),
                        useCChainSdkAssetsStore().refresh(),
                    ]).catch((e) => {
                        console.warn('[FormC] post-send balance refresh failed:', e)
                    })
                }
                canSendAgain.value = true
            } catch (e: any) {
                // A dismissed password prompt is not an error — just stop.
                if (e instanceof SessionAuthCancelled) return
                err.value = errorToString(e)
            } finally {
                isLoading.value = false
            }
        }

        const startAgain = () => {
            offline.clearRecords()
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
            offline,
            isConfirm,
            isSuccess,
            batchMode,
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
            isInjectedWallet,
            selectedTokenAddress,
            selectedTokenSymbol,
            selectedTokenExplorerUrl,
            onAmountChange,
            onTokenChange,
            onCollectibleChange,
            confirm,
            cancel,
            submit,
            sendOneClick,
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
    display: block;
    padding: 0;
}

.batch_toggle_row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 14px;
}

.batch_switch {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--primary-color-light);
    cursor: pointer;
    margin: 0 !important;
    font-weight: normal;

    input {
        cursor: pointer;
    }
}

.form {
}

.list_item {
    margin-bottom: 12px;
}

.contract_row {
    margin-bottom: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--bg-light);

    .contract_label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: var(--primary-color-light);
        margin-bottom: 4px;
    }

    .contract_addr {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .mono {
        font-family: monospace;
        font-size: 12px;
        color: var(--primary-color);
        word-break: break-all;
        flex: 1;
        text-decoration: none;

        &:hover {
            color: var(--secondary-color);
            text-decoration: underline;
        }
    }

    .copy_btn {
        flex-shrink: 0;
    }
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
