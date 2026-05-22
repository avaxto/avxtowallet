<template>
    <div class="addr_card">
        <q-r-modal ref="qrModalRef" :address="activeAddress"></q-r-modal>
        <paper-wallet
            ref="printModalRef"
            v-if="walletType === 'mnemonic'"
            :wallet="activeWallet"
        ></paper-wallet>
        <p class="addr_info">{{ addressMsg }}</p>
        <div class="bottom">
            <div class="col_qr">
                <canvas ref="qrRef"></canvas>
            </div>
            <div class="bottom_rest">
                <div class="subtitle-row">
                    <p class="subtitle">{{ addressLabel }}</p>
                    <div v-if="showIndexSpinner || walletType === 'injected'"
                         :style="walletType === 'injected' ? { visibility: 'hidden' } : {}"
                         class="addr-index-ctrl">
                        <input
                            type="number"
                            class="addr-index-input"
                            v-model.number="addrIndex"
                            :min="0"
                            :max="maxAddrIndex"
                            step="1"
                        />
                    </div>
                </div>

                <p class="addr_text" data-cy="wallet_address">
                    {{ activeAddress }}
                </p>
                <div class="buts">
                    <button
                        v-if="showNewAddressBtn"
                        :tooltip="'Advance HD index and show the next X-Chain address'"
                        class="bech32 new-addr-btn"
                        @click="getNewXAddress"
                        :disabled="newAddrLoading"
                    >
                        {{ newAddrLoading ? '…' : 'New Address' }}
                    </button>
                    <button
                        v-if="chainNow === 'C' && walletType !== 'injected'"
                        :tooltip="`View the bech32 encoded C-Chain address`"
                        class="bech32"
                        @click="toggleBech32"
                        :active="showBech"
                    >
                        Bech32
                    </button>
                    <button
                        :tooltip="$t('top.hover1')"
                        @click="viewQRModal"
                        class="qr_but"
                    ></button>
                    <button
                        v-if="walletType === 'mnemonic'"
                        :tooltip="$t('top.hover2')"
                        @click="viewPrintModal"
                        class="print_but"
                    ></button>
                    <button
                        v-if="walletType === 'ledger'"
                        :tooltip="$t('create.verify')"
                        @click="verifyLedgerAddress"
                        class="ledger_but"
                    ></button>
                    <CopyText
                        :tooltip="$t('top.hover3')"
                        :value="activeAddress"
                        class="copy_but"
                    ></CopyText>
                </div>
            </div>
        </div>
        <div class="bottom_tabs">
            <ChainSelect :modelValue="chainNow" @update:modelValue="chainNow = $event"></ChainSelect>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, watch, onMounted } from 'vue'
import { useMainStore } from '@/stores'
import { useI18n } from 'vue-i18n'

import CopyText from '@/components/misc/CopyText.vue'
import QRModal from '@/components/modals/QRModal.vue'
import PaperWallet from '@/components/modals/PaperWallet/PaperWallet.vue'
import QRCode from 'qrcode'
import { KeyPair as AVMKeyPair } from '@/avalanche/apis/avm'
import { AvalancheAccount, WalletNameType } from '@/js/wallets/types'

import MnemonicWallet, {
    AVA_ACCOUNT_PATH,
    LEDGER_ETH_ACCOUNT_PATH,
} from '@/js/wallets/MnemonicWallet'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { AbstractHdWallet } from '@/js/wallets/AbstractHdWallet'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'

import ChainSelect from '@/components/wallet/TopCards/AddressCard/ChainSelect.vue'
import { ChainIdType } from '@/constants'
import { ava } from '@/AVA'
import { getPreferredHRP } from '@/avalanche/utils'

export default defineComponent({
    name: 'AddressCard',
    components: {
        CopyText,
        PaperWallet,
        QRModal,
        ChainSelect,
    },
    setup() {
        const mainStore = useMainStore()
        const { t } = useI18n()
        
        const qrModalRef = ref<QRModal>()
        const printModalRef = ref<PaperWallet>()
        const qrRef = ref<HTMLCanvasElement>()
        
        const colorLight = ref('#FFF')
        const colorDark = ref('#242729')
        const xAddressOverride = ref<string | null>(null)
        const pAddressOverride = ref<string | null>(null)
        const addrIndex = ref<number>(0)
        const savedIndexX = ref<number>(0)
        const savedIndexP = ref<number>(0)
        const newAddrLoading = ref(false)
        const chainNow = ref<ChainIdType>(
            (['injected', 'singleton'] as string[]).includes(
                (mainStore.activeWallet as AvalancheAccount | null)?.type ?? ''
            ) ? 'C' : 'X'
        )
        const showBech = ref(false)
        
        const activeWallet = computed((): AvalancheAccount | null => {
            return mainStore.activeWallet as AvalancheAccount | null
        })

        const address = computed(() => {
            const wallet = activeWallet.value

            if (!wallet) {
                return '-'
            }
            return wallet.getCurrentAddressAvm()
        })

        const addressPVM = computed(() => {
            const wallet = activeWallet.value
            if (!wallet) {
                return '-'
            }
            return wallet.getCurrentAddressPlatform()
        })

        const addressEVM = computed(() => {
            const wallet = activeWallet.value
            if (!wallet) {
                return '-'
            }
            return wallet.getEvmChecksumAddress()
        })

        const addressEVMBech32 = computed(() => {
            const wallet = activeWallet.value
            if (!wallet) {
                return '-'
            }
            return wallet.getEvmAddressBech()
        })

        const activeAddress = computed((): string => {
            switch (chainNow.value) {
                case 'X':
                    // Use || so an empty-string override (returned when wallet has no
                    // externalHelper, e.g. InjectedWallet) falls through to the real
                    // computed address (wallet.getCurrentAddressAvm()).
                    return xAddressOverride.value || address.value
                case 'P':
                    return pAddressOverride.value || addressPVM.value
                case 'C':
                    return showBech.value ? addressEVMBech32.value : addressEVM.value
            }
            return address.value
        })

        const walletType = computed((): WalletNameType => {
            const wallet = activeWallet.value
            if (!wallet) return 'mnemonic'
            return wallet.type
        })

        const showNewAddressBtn = computed((): boolean => {
            return chainNow.value === 'X' && walletType.value === 'mnemonic'
        })

        const showIndexSpinner = computed((): boolean => {
            const type = walletType.value
            return (chainNow.value === 'X' || chainNow.value === 'P') &&
                   (type === 'mnemonic' || type === 'ledger')
        })

        const maxAddrIndex = computed((): number => {
            const wallet = activeWallet.value as unknown as AbstractHdWallet
            if (!wallet || typeof wallet.externalHelper === 'undefined') return 0
            switch (chainNow.value) {
                case 'X': return wallet.externalHelper.hdIndex
                case 'P': return wallet.platformHelper.hdIndex
                default: return 0
            }
        })

        const getAddressAtIndex = (idx: number): string => {
            const wallet = activeWallet.value as unknown as AbstractHdWallet
            if (!wallet) return ''
            if (typeof wallet.externalHelper === 'undefined') {
                // Injected / singleton wallets without an HdHelper: index into
                // getAllAddressesX/P so index 0 maps to the base (m/0/0) address.
                const base = activeWallet.value!
                switch (chainNow.value) {
                    case 'X': return base.getAllAddressesX()[idx] ?? ''
                    case 'P': return base.getAllAddressesP()[idx] ?? ''
                    default: return ''
                }
            }
            switch (chainNow.value) {
                case 'X': return wallet.externalHelper.getAddressForIndex(idx)
                case 'P': return wallet.platformHelper.getAddressForIndex(idx)
                default: return ''
            }
        }

        const activeIdx = computed((): number => {
            const wallet = activeWallet.value as MnemonicWallet
            if (!wallet) return 0
            const wType = wallet.type

            if (wType === 'singleton' || wType === 'injected') return 0
            if (typeof wallet.getExternalActiveIndex !== 'function') return 0

            switch (chainNow.value) {
                case 'X':
                    return wallet.getExternalActiveIndex()
                case 'P':
                    return wallet.getPlatformActiveIndex()
                default:
                    return 0
            }
        })

        const addressLabel = computed((): string => {
            switch (chainNow.value) {
                default:
                    return t('top.address.title_x') as string
                case 'P':
                    return t('top.address.title_p') as string
                case 'C':
                    return showBech.value
                        ? 'Derived C-Chain Address'
                        : (t('top.address.title_c') as string)
            }
        })

        const addressMsg = computed((): string => {
            switch (chainNow.value) {
                default:
                    return getAddressMsgX()
                case 'P':
                    return t('top.address.desc_p') as string
                case 'C':
                    return showBech.value
                        ? 'Used internally when moving funds to or from C-Chain'
                        : (t('top.address.desc_c') as string)
            }
        })

        const getAddressMsgX = () => {
            if (activeWallet.value?.type === 'singleton') {
                return t('top.address.desc_x_1') as string
            } else {
                return `${t('top.address.desc_x_1')} ${t('top.address.desc_x_2')}` as string
            }
        }

        const updateQR = () => {
            const canvas = qrRef.value
            if (!canvas) return

            const addr = activeAddress.value
            if (!addr || addr === '-') return

            const size = canvas.clientWidth
            QRCode.toCanvas(
                canvas,
                addr,
                {
                    scale: 6,
                    color: {
                        light: colorLight.value,
                        dark: colorDark.value,
                    },
                    width: size,
                },
                function (error: any) {
                    if (error) console.error(error)
                }
            )
        }

        const toggleBech32 = () => {
            showBech.value = !showBech.value
        }

        const getNewXAddress = async () => {
            const wallet = activeWallet.value
            if (!wallet || newAddrLoading.value) return
            newAddrLoading.value = true
            try {
                if (wallet.type === 'mnemonic') {
                    const hdWallet = wallet as unknown as AbstractHdWallet
                    hdWallet.externalHelper.incrementIndex()
                    xAddressOverride.value = hdWallet.externalHelper.getCurrentAddress()
                } else if (wallet.type === 'injected') {
                    xAddressOverride.value = await (wallet as unknown as InjectedWallet).getNextXAddress()
                }
            } finally {
                newAddrLoading.value = false
            }
        }

        const viewQRModal = () => {
            qrModalRef.value?.open()
        }

        const viewPrintModal = () => {
            printModalRef.value?.open()
        }

        const verifyLedgerAddress = async () => {
            const wallet = activeWallet.value as LedgerWallet
            const networkId = ava.getNetworkID()

            switch (chainNow.value) {
                case 'X':
                case 'P':
                    wallet.verifyAddress(activeIdx.value, false, chainNow.value)
                    break
                case 'C':
                    wallet.ethApp.getAddress(`${LEDGER_ETH_ACCOUNT_PATH}`, true)
            }
        }

        // Watchers
        watch(activeAddress, () => {
            updateQR()
        })

        watch(addrIndex, (val) => {
            const clamped = Math.max(0, Math.min(maxAddrIndex.value, Math.round(val || 0)))
            if (clamped !== val) {
                addrIndex.value = clamped
                return
            }
            if (chainNow.value === 'X') {
                xAddressOverride.value = getAddressAtIndex(clamped)
            } else if (chainNow.value === 'P') {
                pAddressOverride.value = getAddressAtIndex(clamped)
            }
        })

        // TODO: Add theme store for theme watching
        // watch(() => mainStore.theme, (val: string) => {
        //     if (val === 'night') {
        //         colorDark.value = '#E5E5E5'
        //         colorLight.value = '#242729'
        //     } else {
        //         colorDark.value = '#242729'
        //         colorLight.value = '#FFF'
        //     }
        //     updateQR()
        // }, { immediate: true })

        watch(chainNow, (val: ChainIdType, oldVal: ChainIdType) => {
            // Save the user-selected index for the chain we're leaving
            if (oldVal === 'X') savedIndexX.value = addrIndex.value
            else if (oldVal === 'P') savedIndexP.value = addrIndex.value

            if (val !== 'C') showBech.value = false

            if (val === 'X') {
                pAddressOverride.value = null
                addrIndex.value = savedIndexX.value
                // Force-update override in case addrIndex value didn't change
                xAddressOverride.value = getAddressAtIndex(savedIndexX.value)
            } else if (val === 'P') {
                xAddressOverride.value = null
                addrIndex.value = savedIndexP.value
                // Force-update override in case addrIndex value didn't change
                pAddressOverride.value = getAddressAtIndex(savedIndexP.value)
            } else {
                xAddressOverride.value = null
                pAddressOverride.value = null
                addrIndex.value = activeIdx.value
            }
        })

        watch(activeWallet, () => {
            xAddressOverride.value = null
            pAddressOverride.value = null
            savedIndexX.value = activeIdx.value
            savedIndexP.value = activeIdx.value
            addrIndex.value = activeIdx.value
        })

        // Force C-chain view for injected and singleton (private key) wallets
        watch(activeWallet, (wallet) => {
            if (wallet?.type === 'injected' || wallet?.type === 'singleton') {
                chainNow.value = 'C'
            }
        }, { immediate: true })

        onMounted(() => {
            savedIndexX.value = activeIdx.value
            savedIndexP.value = activeIdx.value
            addrIndex.value = activeIdx.value
            updateQR()
        })

        return {
            qrModalRef,
            printModalRef,
            qrRef,
            colorLight,
            colorDark,
            chainNow,
            showBech,
            activeWallet,
            address,
            addressPVM,
            addressEVM,
            addressEVMBech32,
            activeAddress,
            walletType,
            activeIdx,
            addressLabel,
            addressMsg,
            updateQR,
            toggleBech32,
            viewQRModal,
            viewPrintModal,
            verifyLedgerAddress,
            showNewAddressBtn,
            newAddrLoading,
            getNewXAddress,
            addrIndex,
            showIndexSpinner,
            maxAddrIndex,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../../main';

.addr_card {
    display: flex;
    flex-direction: column;
    padding: 0 !important;
}
.buts {
    width: 100%;
    display: flex;
    align-items: center;
    color: var(--primary-color-light);
    justify-content: flex-end;

    > * {
        font-size: 16px;
        margin-left: 14px;
        position: relative;
        outline: none;
        width: 18px;
        height: 18px;
        opacity: 0.6;

        background-size: contain;
        background-position: center;
        &:hover {
            opacity: 1;
        }
    }
}

.qr_but {
    background-image: url('/img/qr_icon.png');
}
.print_but {
    background-image: url('/img/faucet_icon.png');
}
.ledger_but {
    background-image: url('/img/ledger_icon.png');
}
.copy_but {
    color: var(--primary-color);
}

.bech32 {
    font-size: 0.8em;
    font-weight: bold;
    width: auto;

    &[active] {
        color: var(--secondary-color) !important;
    }
}

.new-addr-btn {
    color: var(--secondary-color);
    opacity: 0.85;

    &:hover {
        opacity: 1;
    }

    &:disabled {
        opacity: 0.4;
        cursor: default;
    }
}

.col_qr {
    display: flex;
    flex-direction: column;
    justify-content: center;
}
.mainnet_but {
    background-image: url('/img/modal_icons/mainnet_addr.svg');
}

@include main.night-mode {
    .qr_but {
        background-image: url('/img/qr_icon_night.svg');
    }
    .print_but {
        background-image: url('/img/print_icon_night.svg');
    }
    .ledger_but {
        background-image: url('/img/ledger_night.svg');
    }

    .mainnet_but {
        background-image: url('/img/modal_icons/mainnet_addr_night.svg');
    }
}

.addr_info {
    margin: 19px !important;
    margin-bottom: 0 !important;
    margin-top: 0 !important;
    background-color: var(--bg-light);
    font-size: 13px;
    font-weight: bold;
    text-align: center;
    padding: 12px 16px;
}

$qr_width: 110px;

.bottom {
    display: grid;
    grid-template-columns: $qr_width 1fr;
    column-gap: 14px;
    padding-right: 18px;
    margin-top: 4px;
    margin-bottom: 4px;
    padding-left: 8px;
    flex-grow: 1;

    canvas {
        width: $qr_width;
        height: $qr_width;
        background-color: transparent;
    }

    .bottom_rest {
        padding-top: 4px;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
}

.subtitle-row {
    display: flex;
    align-items: center;
    gap: 8px;
}

.addr-index-ctrl {
    display: flex;
    align-items: center;
    margin-left: auto;
}

.addr-index-input {
    width: 60px;
    text-align: center;
    background: var(--bg-light);
    color: var(--primary-color);
    border: 1px solid var(--secondary-color);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 0.78em;
    outline: none;

    &::-webkit-outer-spin-button,
    &::-webkit-inner-spin-button {
        opacity: 1;
    }
}

.sub {
    margin: 0px 10px !important;
    text-align: center;
    font-size: 0.7rem;
    background-color: main.$secondary-color;
    color: #fff;
    padding: 3px 6px;
    border-radius: 3px;
}

.subtitle {
    font-size: 0.7rem;
    color: var(--primary-color-light);
}

.addr_text {
    font-size: 15px;
    word-break: break-all;
    color: var(--primary-color);
    min-height: 55px;
}

@include main.medium-device {
    //.bottom{
    //    display: block;
    //}
    .bottom_rest {
        justify-content: space-between;
    }

    .addr_info {
        display: none;
    }
    canvas {
        display: block;
        margin: 0px auto;
    }

    .buts {
        justify-content: space-evenly;

        > * {
            margin: 0;
        }
    }

    .addr_text {
        font-size: 13px;
    }
}

.bottom_tabs {
    width: 100%;
}

@include main.mobile-device {
    .addr_info {
        display: none;
    }
}
</style>
