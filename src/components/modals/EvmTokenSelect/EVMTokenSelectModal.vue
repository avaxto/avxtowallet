<template>
    <modal ref="modal" title="Select Token" class="modal_main">
        <div class="token_select_body">
            <p v-if="switching" class="switch_notice">
                Switching to {{ switching }} — confirm the network change in your wallet…
            </p>
            <p v-if="err" class="switch_err">{{ err }}</p>
            <TokenListPicker
                :tokens="heldTokens"
                :loading="loading"
                @select="onPick"
            ></TokenListPicker>
            <div class="nft_list" v-if="!isEvm">
                <ERC721Row
                    class="nft_row"
                    v-for="t in erc721s"
                    :key="t.contractAddress"
                    :token="t"
                    @select="onERC721Select"
                ></ERC721Row>
            </div>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useErc721Store } from '@/stores'

import Modal from '@/components/modals/Modal.vue'
import ERC721Token from '@/js/ERC721Token'
import ERC721Row from '@/components/modals/EvmTokenSelect/ERC721Row.vue'
import TokenListPicker from '@/components/misc/TokenListPicker.vue'
import { useHeldErc20Tokens, HeldToken } from '@/composables/useHeldErc20Tokens'
import { resolveErc20Token } from '@/helpers/erc20_resolve'
import { iErc721SelectInput } from '@/components/misc/EVMInputDropdown/types'
import { useActivePlatformStore } from '@/platforms'
import { useEvmStore } from '@/platforms/evm/store'
import { useEvmPortfolioStore, type EvmPortfolioToken } from '@/stores/evmPortfolio'

export default defineComponent({
    name: 'EVMTokenSelectModal',
    components: {
        ERC721Row,
        Modal,
        TokenListPicker,
    },
    emits: ['select', 'selectCollectible'],
    setup(props, { emit }) {
        const erc721Store = useErc721Store()
        const platformStore = useActivePlatformStore()
        const evmStore = useEvmStore()
        const evmPortfolio = useEvmPortfolioStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)

        const isEvm = computed(() => platformStore.activePlatform?.descriptor.id === 'evm')

        // Avalanche's list: the assets store's "Default Assets" merged with
        // Glacier/chainkit-discovered ones, same source as the swap picker.
        const {
            tokens: avalancheTokens,
            loading: avalancheLoading,
            refresh: refreshAvalanche,
        } = useHeldErc20Tokens()

        /**
         * On the EVM platform the picker reads the SAME store the portfolio
         * renders from, so the two lists cannot disagree. Previously it always
         * showed Avalanche's C-Chain tokens, which on any other network meant
         * offering assets the wallet does not hold while hiding the ones it
         * does.
         *
         * `EvmPortfolioToken` already carries everything `HeldToken` needs;
         * the only difference is that the native asset is keyed 'native' here
         * rather than by a sentinel address, and `isNative` is what every
         * consumer actually branches on.
         */
        const evmTokens = computed((): HeldToken[] =>
            evmPortfolio.tokens.map((t: EvmPortfolioToken) => ({
                address: t.address,
                symbol: t.symbol,
                name: t.name,
                decimals: t.decimals,
                logoUri: t.logoUri,
                balance: t.balance,
                isNative: t.isNative,
                network: t.network,
            }))
        )

        const heldTokens = computed((): HeldToken[] =>
            isEvm.value ? evmTokens.value : avalancheTokens.value
        )

        /**
         * Maps a picked row back to the store's own token.
         *
         * The rows above are flattened into `HeldToken` for the shared picker,
         * which drops fields the send path needs — notably `raw`, the unscaled
         * integer balance. Emitting the flattened copy would hand downstream a
         * token whose balance reads as undefined, so the original is emitted
         * instead. Keyed by chain id + address because an address alone is
         * ambiguous across networks.
         */
        const evmSourceByKey = computed(
            (): Map<string, EvmPortfolioToken> =>
                new Map(evmPortfolio.tokens.map((t) => [t.key, t]))
        )
        const loading = computed(() =>
            isEvm.value ? evmPortfolio.loading : avalancheLoading.value
        )

        const switching = ref<string | null>(null)
        const err = ref('')

        const refresh = async (): Promise<void> => {
            if (isEvm.value) {
                const address = platformStore.activeWallet?.getPrimaryAddress()
                if (!address) return
                // ensureLoaded, NOT fetch: this is the same call the portfolio
                // page makes, so both render one list from one scan. Calling
                // fetch() here re-scanned every network on every open — slow,
                // and because the store is shared it also blanked the
                // portfolio page behind this modal while it ran.
                await evmPortfolio.ensureLoaded(address, evmStore.network.isTestnet)
                return
            }
            await refreshAvalanche()
        }

        const open = (): void => {
            err.value = ''
            modal.value?.open()
            // This modal is always mounted (EVMAssetDropdown renders it
            // unconditionally, popup or not), so the list reflects whatever
            // was last fetched — possibly nothing yet, on a wallet that just
            // connected. Force a fresh pull when the user actually opens the
            // picker rather than leaving them staring at a list that's missing
            // tokens until an unrelated poll tick catches up.
            refresh().catch((e) => {
                console.warn('[EVMTokenSelectModal] token refresh on open failed:', e)
            })
        }

        const erc721s = computed((): ERC721Token[] => erc721Store.networkContracts)

        const onPick = async (t: HeldToken) => {
            err.value = ''

            if (isEvm.value) {
                // The list spans every registry network, so the picked token
                // may not be on the chain the wallet is currently pointed at.
                // Move the wallet first — sending is `eth_sendTransaction`
                // against whatever chain the extension is on, so selecting
                // without switching would compose a transfer for one chain and
                // broadcast it on another.
                if (t.network && t.network.evmChainId !== evmStore.network.evmChainId) {
                    switching.value = t.network.name
                    try {
                        await evmStore.setNetwork(t.network.id)
                    } catch (e: any) {
                        err.value =
                            e?.message ?? `Could not switch to ${t.network.name}. Selection cancelled.`
                        return
                    } finally {
                        switching.value = null
                    }
                }
                if (t.isNative) {
                    emit('select', 'native')
                    close()
                    return
                }
                const key = `${t.network?.evmChainId}:${t.address.toLowerCase()}`
                const source = evmSourceByKey.value.get(key)
                if (!source) {
                    err.value = 'That token is no longer in the list — refresh and try again.'
                    return
                }
                emit('select', source)
                close()
                return
            }

            if (t.isNative) {
                emit('select', 'native')
                close()
                return
            }
            const token = await resolveErc20Token(t.address, {
                name: t.name,
                symbol: t.symbol,
                decimals: t.decimals,
                logoUri: t.logoUri,
            })
            emit('select', token)
            close()
        }

        const onERC721Select = (val: iErc721SelectInput) => {
            emit('selectCollectible', val)
            close()
        }

        const close = () => {
            switching.value = null
            modal.value?.close()
        }

        return {
            modal,
            open,
            isEvm,
            heldTokens,
            loading,
            switching,
            err,
            erc721s,
            onPick,
            onERC721Select,
            close,
        }
    },
})
</script>
<style scoped lang="scss">
@use '../../../main';

.token_select_body {
    width: 420px;
    max-width: 100%;
}

.switch_notice,
.switch_err {
    font-size: 12px;
    padding: 8px 20px 0;
    margin: 0;
}

.switch_notice {
    color: var(--primary-color-light);
}

.switch_err {
    color: var(--error);
}

.nft_row {
    padding: 10px 20px;
    border-top: 1px solid var(--bg-light);
}

@include main.mobile-device {
    .token_select_body {
        width: 100%;
        height: 40vh;
        overflow: scroll;
    }
}
</style>
