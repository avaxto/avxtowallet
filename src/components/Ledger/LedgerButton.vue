<template>
    <button class="button_primary" @click="submit" :disabled="disabled">
        <template v-if="!isLoading">
            Ledger

            <span v-if="disabled" class="no_firefox">{{ browserName }} is not supported</span>
            <ImageDayNight
                day="/img/access_icons/day/ledger.svg"
                night="/img/access_icons/night/ledger.svg"
                class="ledger_img"
                v-else
            ></ImageDayNight>
        </template>
        <Spinner v-else class="spinner"></Spinner>
    </button>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, onUnmounted } from 'vue'
import { useStore } from 'vuex'
import TransportU2F from '@ledgerhq/hw-transport-u2f'
//@ts-ignore
import TransportWebUSB from '@ledgerhq/hw-transport-webusb'
// @ts-ignore
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
// @ts-ignore
import Eth from '@ledgerhq/hw-app-eth'
import Transport from '@ledgerhq/hw-transport'

import Spinner from '@/components/misc/Spinner.vue'
import LedgerBlock from '@/components/modals/LedgerBlock.vue'
import { LedgerWallet } from '@/js/wallets/LedgerWallet'
import { AVA_ACCOUNT_PATH, LEDGER_ETH_ACCOUNT_PATH } from '@/js/wallets/MnemonicWallet'
import { LEDGER_EXCHANGE_TIMEOUT } from '@/store/modules/ledger/types'
import ImageDayNight from '@/components/misc/ImageDayNight.vue'
import { getLedgerProvider } from '@avalabs/avalanche-wallet-sdk'
import { MIN_LEDGER_V } from '@/js/wallets/constants'
import { detect } from 'detect-browser'

const UnsupportedBrowsers = ['firefox', 'safari']

export default defineComponent({
    name: 'LedgerButton',
    components: {
        ImageDayNight,
        Spinner,
        LedgerBlock,
    },
    setup() {
        const store = useStore()
        
        const isLoading = ref(false)
        const version = ref<string | undefined>(undefined)

        const browser = computed(() => {
            return detect()
        })

        // For display
        const browserName = computed(() => {
            return browser.value ? browser.value.name[0].toUpperCase() + browser.value.name.slice(1) : ''
        })

        const disabled = computed(() => {
            // If unsupported return true
            if (browser.value && UnsupportedBrowsers.includes(browser.value.name)) return true
            return false
        })

        const getTransport = async () => {
            let transport

            try {
                transport = await TransportWebHID.create()
                return transport
            } catch (e) {
                console.log('Web HID not supported.')
            }

            //@ts-ignore
            if (window.USB) {
                transport = await TransportWebUSB.create()
            } else {
                transport = await TransportU2F.create()
            }
            return transport
        }

        const waitForConfig = async (t: Transport) => {
            // Config is found immediately if the device is connected and the app is open.
            // If no config was found that means user has not opened the Avalanche app.
            setTimeout(() => {
                if (version.value) return
                store.commit('Ledger/setIsUpgradeRequired', true)
            }, 1000)

            try {
                const prov = await getLedgerProvider(t)
                version.value = await prov.getVersion(t)
            } catch (e) {
                // this.version = await (app as AvalancheApp).
            }
        }

        const showWalletLoading = () => {
            store.commit('Ledger/closeModal')
            store.commit('Ledger/setIsWalletLoading', true)
        }

        const loadWallet = async (wallet: LedgerWallet) => {
            showWalletLoading()
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    store
                        .dispatch('accessWalletLedger', wallet)
                        .then(() => {
                            resolve(undefined)
                        })
                        .catch((err) => {
                            reject(err)
                        })
                }, 1000)
            })
        }

        const onsuccess = () => {
            store.commit('Ledger/setIsWalletLoading', false)
            isLoading.value = false
            version.value = undefined
        }

        const onerror = (err: any) => {
            isLoading.value = false
            version.value = undefined
            store.commit('Ledger/closeModal')
            console.error(err)

            store.dispatch('Notifications/add', {
                type: 'error',
                title: 'Ledger Access Failed',
                message: 'Failed to get public key from ledger device.',
            })
        }

        const submit = async () => {
            try {
                const transport = await getTransport()
                transport.setExchangeTimeout(LEDGER_EXCHANGE_TIMEOUT)

                // Wait for app config
                await waitForConfig(transport)

                // Close the initial prompt modal if exists
                store.commit('Ledger/setIsUpgradeRequired', false)
                isLoading.value = true

                if (!version.value) {
                    store.commit('Ledger/setIsUpgradeRequired', true)
                    isLoading.value = false
                    throw new Error('')
                }

                if (version.value < MIN_LEDGER_V) {
                    store.commit('Ledger/setIsUpgradeRequired', true)
                    isLoading.value = false
                    throw new Error('')
                }

                const messages = [
                    {
                        title: 'Derivation Path',
                        value: AVA_ACCOUNT_PATH,
                    },
                    {
                        title: 'Derivation Path',
                        value: LEDGER_ETH_ACCOUNT_PATH,
                    },
                ]

                store.commit('Ledger/openModal', {
                    title: 'Getting Public Keys',
                    messages,
                    isPrompt: false,
                })

                const wallet = await LedgerWallet.fromTransport(transport)
                try {
                    await loadWallet(wallet)
                    onsuccess()
                } catch (e) {
                    onerror(e)
                }
            } catch (e) {
                onerror(e)
            }
        }

        onUnmounted(() => {
            store.commit('Ledger/closeModal')
        })

        return {
            isLoading,
            version,
            browser,
            browserName,
            disabled,
            submit
        }
    }
})
</script>
<style scoped lang="scss">
.spinner {
    width: 100% !important;
    color: inherit;
}

.ledger_img {
    width: 24px;
    height: 24px;
    object-fit: contain;
}

.spinner::v-deep p {
    color: inherit;
}

.no_firefox {
    font-size: 0.8em;
    color: var(--primary-color-light);
}
</style>
