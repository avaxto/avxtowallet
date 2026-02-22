<template>
    <div class="balance_card">
        <UtxosBreakdownModal ref="utxos_modal"></UtxosBreakdownModal>
        <div class="fungible_card">
            <div class="header">
                <div class="refresh">
                    <Spinner v-if="isUpdateBalance" class="spinner"></Spinner>
                    <button v-else @click="updateBalance">
                        <fa icon="sync"></fa>
                    </button>
                </div>
                <h4>{{ $t('top.title2') }}</h4>
                <template v-if="!isBreakdown">
                    <button class="breakdown_toggle" @click="toggleBreakdown">
                        <fa icon="eye"></fa>
                        {{ $t('top.balance.show') }}
                    </button>
                </template>
                <template v-else>
                    <button class="breakdown_toggle" @click="toggleBreakdown">
                        <fa icon="eye-slash"></fa>
                        {{ $t('top.balance.hide') }}
                    </button>
                </template>
                <button @click="showUTXOsModal" class="breakdown_toggle">Show UTXOs</button>
            </div>
            <div class="balance_row">
                <p class="balance" data-cy="wallet_balance" v-if="!balanceTextRight">
                    {{ balanceTextLeft }} AVAX
                </p>
                <p class="balance" data-cy="wallet_balance" v-else>
                    {{ balanceTextLeft }}
                    <span>.{{ balanceTextRight }}</span>
                    AVAX
                </p>
                <div style="display: flex; flex-direction: row">
                    <p class="balance_usd">
                        <b>$ {{ totalBalanceUSDText }}</b>
                        USD
                    </p>
                    <p class="balance_usd" style="background-color: transparent">
                        <b>1 AVAX</b>
                        =
                        <b>${{ avaxPriceText }}</b>
                        USD
                    </p>
                </div>
            </div>
            <!--            <button class="expand_but">Show Breakdown<fa icon="list-ol"></fa></button>-->
            <div class="alt_info">
                <div class="alt_non_breakdown" v-if="!isBreakdown">
                    <div>
                        <label>{{ $t('top.balance.available') }}</label>
                        <p>{{ isInjected ? cleanAvaxBN(evmUnlocked) : unlockedText }} AVAX</p>
                    </div>
                    <div v-if="hasLocked && !isInjected">
                        <label>{{ $t('top.locked') }}</label>
                        <p>{{ balanceTextLocked }} AVAX</p>
                    </div>
                    <div v-if="hasMultisig && !isInjected">
                        <label>Multisig</label>
                        <p>{{ balanceTextMultisig }} AVAX</p>
                    </div>
                    <div v-if="!isInjected">
                        <label>{{ $t('top.balance.stake') }}</label>
                        <p>{{ stakingText }} AVAX</p>
                    </div>
                </div>
                <div class="alt_breakdown" v-else>
                    <div>
                        <template v-if="!isInjected">
                            <label>{{ $t('top.balance.available') }} (X)</label>
                            <p>{{ cleanAvaxBN(avmUnlocked) }} AVAX</p>
                            <label>{{ $t('top.balance.available') }} (P)</label>
                            <p>{{ cleanAvaxBN(platformUnlocked) }} AVAX</p>
                        </template>
                        <label>{{ $t('top.balance.available') }} (C)</label>
                        <p>{{ cleanAvaxBN(evmUnlocked) }} AVAX</p>
                    </div>
                    <div v-if="hasLocked && !isInjected">
                        <label>{{ $t('top.balance.locked') }} (X)</label>
                        <p>{{ cleanAvaxBN(avmLocked) }} AVAX</p>
                        <label>{{ $t('top.balance.locked') }} (P)</label>
                        <p>{{ cleanAvaxBN(platformLocked) }} AVAX</p>
                        <label>{{ $t('top.balance.locked_stake') }} (P)</label>
                        <p>{{ cleanAvaxBN(platformLockedStakeable) }} AVAX</p>
                    </div>
                    <div v-if="hasMultisig && !isInjected">
                        <label>Multisig (X)</label>
                        <p>{{ cleanAvaxBN(avmMultisig) }} AVAX</p>
                        <label>Multisig (P)</label>
                        <p>{{ cleanAvaxBN(platformMultisig) }} AVAX</p>
                    </div>
                    <div v-if="!isInjected">
                        <label>{{ $t('top.balance.stake') }}</label>
                        <p>{{ stakingText }} AVAX</p>
                    </div>
                </div>
            </div>
        </div>
        <NftCol class="nft_card"></NftCol>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useStore } from '@/stores'
import { useAssetsStore } from '@/stores'
import AvaAsset from '@/js/AvaAsset'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import Spinner from '@/components/misc/Spinner.vue'
import NftCol from './NftCol.vue'
import Tooltip from '@/components/misc/Tooltip.vue'

import Big from 'big.js'
import { BN } from '@/avalanche'
import { ONEAVAX } from '@/avalanche/utils'
import { bnToBig } from '@/helpers/helper'
// Type for price data
type priceDict = { usd: number }
import { WalletType } from '@/js/wallets/types'
import UtxosBreakdownModal from '@/components/modals/UtxosBreakdown/UtxosBreakdownModal.vue'

export default defineComponent({
    name: 'BalanceCard',
    components: {
        UtxosBreakdownModal,
        Spinner,
        NftCol,
        Tooltip,
    },
    setup() {
        const store = useStore()
        const assetsStore = useAssetsStore()

        const isBreakdown = ref(true)
        const utxos_modal = ref<InstanceType<typeof UtxosBreakdownModal>>()

        const cleanAvaxBN = (val: BN) => {
            let big = Big(val.toString()).div(Big(ONEAVAX.toString()))
            return big.toLocaleString()
        }

        const updateBalance = (): void => {
            store.dispatch('Assets/updateUTXOs')
            store.dispatch('History/updateTransactionHistory')
        }

        const showUTXOsModal = () => {
            utxos_modal.value?.open()
        }

        const toggleBreakdown = () => {
            isBreakdown.value = !isBreakdown.value
        }

        const ava_asset = computed((): AvaAsset | null => {
            return assetsStore.AssetAVA
        })

        const avmUnlocked = computed((): BN => {
            if (!ava_asset.value) return new BN(0)
            return ava_asset.value.amount
        })

        const avmLocked = computed((): BN => {
            if (!ava_asset.value) return new BN(0)
            return ava_asset.value.amountLocked
        })

        const evmUnlocked = computed((): BN => {
            if (!wallet.value) return new BN(0)
            // convert from ^18 to ^9
            let bal = wallet.value.ethBalance
            return bal.div(new BN(Math.pow(10, 9).toString()))
        })

        const totalBalance = computed((): BN => {
            if (!ava_asset.value) return new BN(0)

            let tot = ava_asset.value.getTotalAmount()
            // add EVM balance
            tot = tot.add(evmUnlocked.value)
            return tot
        })

        const totalBalanceBig = computed((): Big => {
            if (ava_asset.value && ava_asset.value.denomination !== undefined) {
                let denom = ava_asset.value.denomination
                let bigTot = bnToBig(totalBalance.value, denom)
                return bigTot
            }
            return Big(0)
        })

        const avaxPriceText = computed(() => {
            return priceDict.value.usd
        })

        const totalBalanceUSD = computed((): Big => {
            let usdPrice = priceDict.value.usd
            if (typeof usdPrice !== 'number' || isNaN(usdPrice)) {
                return Big(0)
            }
            let usdBig = totalBalanceBig.value.times(Big(usdPrice))
            return usdBig
        })

        const totalBalanceUSDText = computed((): string => {
            if (isUpdateBalance.value) return '--'
            return totalBalanceUSD.value.toLocaleString(2)
        })

        const balanceText = computed((): string => {
            if (ava_asset.value && ava_asset.value.denomination !== undefined) {
                let denom = ava_asset.value.denomination
                return totalBalanceBig.value.toLocaleString(denom)
            } else {
                return '?'
            }
        })

        const balanceTextLeft = computed((): string => {
            if (isUpdateBalance.value) return '--'
            let text = balanceText.value
            if (text.includes('.')) {
                let left = text.split('.')[0]
                return left
            }
            return text
        })

        const balanceTextRight = computed((): string => {
            if (isUpdateBalance.value) return ''
            let text = balanceText.value
            if (text.includes('.')) {
                let right = text.split('.')[1]
                return right
            }
            return ''
        })

        const balanceTextLocked = computed((): string => {
            if (isUpdateBalance.value) return '--'

            if (ava_asset.value && ava_asset.value.denomination !== undefined) {
                let denom = ava_asset.value.denomination
                let tot = platformLocked.value.add(platformLockedStakeable.value)
                let pLocked = Big(tot.toString()).div(Math.pow(10, denom))
                let amt = ava_asset.value.getAmount(true)
                amt = amt.add(pLocked)

                return amt.toLocaleString(denom)
            } else {
                return '--'
            }
        })

        const balanceTextMultisig = computed(() => {
            if (isUpdateBalance.value) return '--'

            if (ava_asset.value && ava_asset.value.denomination !== undefined) {
                let denom = ava_asset.value.denomination
                return bnToBig(avmMultisig.value.add(platformMultisig.value), denom).toLocaleString()
            } else {
                return '--'
            }
        })

        const avmMultisig = computed((): BN => {
            if (ava_asset.value !== null) {
                return ava_asset.value.amountMultisig
            } else {
                return new BN(0)
            }
        })

        const platformBalance = computed(() => {
            return assetsStore.walletPlatformBalance
        })

        const platformUnlocked = computed((): BN => {
            return platformBalance.value.available
        })

        const platformMultisig = computed((): BN => {
            return platformBalance.value.multisig
        })

        const platformLocked = computed((): BN => {
            return platformBalance.value.locked
        })

        const platformLockedStakeable = computed((): BN => {
            return platformBalance.value.lockedStakeable
        })

        const unlockedText = computed(() => {
            if (isUpdateBalance.value) return '--'

            if (ava_asset.value && ava_asset.value.denomination !== undefined) {
                let xUnlocked = ava_asset.value.amount
                let pUnlocked = platformUnlocked.value

                let denom = ava_asset.value.denomination

                let tot = xUnlocked.add(pUnlocked).add(evmUnlocked.value)

                let amtBig = bnToBig(tot, denom)

                return amtBig.toLocaleString(denom)
            } else {
                return '--'
            }
        })

        const pBalanceText = computed(() => {
            if (!ava_asset.value || ava_asset.value.denomination === undefined) return '--'
            if (isUpdateBalance.value) return '--'

            let denom = ava_asset.value.denomination
            let bal = platformUnlocked.value
            let bigBal = Big(bal.toString())
            bigBal = bigBal.div(Math.pow(10, denom))

            if (bigBal.lt(Big('1'))) {
                return bigBal.toLocaleString(9)
            } else {
                return bigBal.toLocaleString(3)
            }
        })

        const stakingAmount = computed((): BN => {
            return assetsStore.walletStakingBalance
        })

        const stakingText = computed(() => {
            let balance = stakingAmount.value
            if (!balance) return '0'
            if (isUpdateBalance.value) return '--'

            let denom = 9
            let bigBal = Big(balance.toString())
            bigBal = bigBal.div(Math.pow(10, denom))

            if (bigBal.lt(Big('1'))) {
                return bigBal.toString()
            } else {
                return bigBal.toLocaleString()
            }
        })

        const wallet = computed((): WalletType | null => {
            return store.state.activeWallet.value as WalletType | null
        })

        const isInjected = computed((): boolean => {
            if (!wallet.value) return false
            return wallet.value.type === 'injected'
        })

        const isUpdateBalance = computed((): boolean => {
            if (!wallet.value) return true
            return wallet.value.isFetchUtxos
        })

        const priceDict = computed((): priceDict => {
            return store.state.prices.value
        })

        const hasLocked = computed((): boolean => {
            return (
                !avmLocked.value.isZero() ||
                !platformLocked.value.isZero() ||
                !platformLockedStakeable.value.isZero()
            )
        })

        const hasMultisig = computed((): boolean => {
            return !avmMultisig.value.isZero() || !platformMultisig.value.isZero()
        })

        return {
            isBreakdown,
            utxos_modal,
            cleanAvaxBN,
            updateBalance,
            showUTXOsModal,
            toggleBreakdown,
            ava_asset,
            avmUnlocked,
            avmLocked,
            evmUnlocked,
            totalBalance,
            totalBalanceBig,
            avaxPriceText,
            totalBalanceUSD,
            totalBalanceUSDText,
            balanceText,
            balanceTextLeft,
            balanceTextRight,
            balanceTextLocked,
            balanceTextMultisig,
            avmMultisig,
            platformBalance,
            platformUnlocked,
            platformMultisig,
            platformLocked,
            platformLockedStakeable,
            unlockedText,
            pBalanceText,
            stakingAmount,
            stakingText,
            wallet,
            isInjected,
            isUpdateBalance,
            priceDict,
            hasLocked,
            hasMultisig,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../main';
.balance_card {
    display: grid;
    grid-template-columns: 1fr 230px;
    column-gap: 20px;
}

.nft_card {
    border-left: 2px solid var(--bg-light);
}
.fungible_card {
    height: 100%;
    display: grid !important;
    grid-template-rows: max-content 1fr max-content;
    flex-direction: column;
}

.where_info {
    grid-row: 2;
    grid-column: 1/3;
    margin-top: 8px;
    /*max-width: 460px;*/
}
.header {
    display: flex;

    h4 {
        margin-left: 12px;
        flex-grow: 1;
    }
}
h4 {
    font-weight: normal;
}

.alert_cont {
    margin: 0;
}

.balance_row {
    align-self: center;
}
.balance {
    font-size: 2.4em;
    white-space: normal;
    /*font-weight: bold;*/
    font-family: sans-serif !important;

    span {
        font-size: 0.8em;
        /*color: var(--primary-color-light);*/
    }
}

.balance_usd {
    width: max-content;
    background: var(--bg-light);
    color: var(--primary-color-light);
    font-size: 13px;
    padding: 1px 6px;
    border-radius: 3px;
    margin-right: 6px !important;
}

.refresh {
    width: 20px;
    height: 20px;
    color: var(--primary-color);

    button {
        outline: none !important;
    }
    img {
        object-fit: contain;
        width: 100%;
    }

    .spinner {
        color: var(--primary-color) !important;
    }
}
.buts {
    width: 100%;
    text-align: right;
}
.buts button {
    font-size: 18px;
    margin: 0px 18px;
    margin-right: 0px;
    position: relative;
    outline: none !important;
}

.buts img {
    height: 20px;
    width: 20px;
    object-fit: contain;
    outline: none !important;
}
.buts button[tooltip]:hover:before {
    border-radius: 4px;
    /*left: 0;*/
    left: 0;
    transform: translateX(-50%);
    content: attr(tooltip);
    position: absolute;
    background-color: #303030;
    bottom: 100%;
    color: #ddd;
    width: max-content;
    max-width: 100px;
    font-size: 14px;
    padding: 4px 8px;
}

.alt_info > div {
    display: grid;
    grid-template-columns: repeat(4, max-content);
    column-gap: 0px;
    margin-top: 12px;
    > div {
        position: relative;
        padding: 0 24px;
        border-right: 2px solid var(--bg-light);
        &:first-of-type {
            padding-left: 0;
        }
        &:last-of-type {
            border: none;
        }
    }

    label {
        font-size: 13px;
        color: var(--primary-color-light);
    }
}

.nft_card {
    padding-left: 20px;
}

.breakdown_toggle {
    color: var(--primary-color-light);
    font-size: 13px;
    outline: none !important;
    margin-left: 12px;

    &:hover {
        color: var(--secondary-color);
    }
}

@include main.medium-device {
    .balance_card {
        display: block;
        //grid-template-columns: 1fr 120px;
    }

    .balance {
        font-size: 1.8rem !important;
    }

    .balance_usd {
        font-size: 11px;
    }
    .nft_col {
        display: none;
    }

    .alt_info {
        font-size: 12px;
    }
}

@include main.mobile-device {
    .balance_card {
        grid-template-columns: none;
        display: block !important;
    }

    .nft_col {
        display: none;
    }

    .nft_card {
        padding: 0;
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid var(--primary-color-light);
        border-left: none;
    }

    .balance {
        font-size: 2em !important;
    }

    /* .where_info styles removed - empty ruleset */

    .alt_info {
        > div {
            text-align: left;
            grid-template-columns: none;
            column-gap: 0;
        }

        .alt_non_breakdown,
        .alt_breakdown {
            > div {
                padding: 8px 0;
                border-right: none;
                border-bottom: 1px solid var(--bg-light);

                &:last-of-type {
                    border: none;
                }
            }
        }
    }

    .alt_non_breakdown {
        display: none !important;
    }
}
</style>
