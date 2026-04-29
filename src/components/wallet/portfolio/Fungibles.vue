<template>
    <div class="fungibles_view">
        <AddERC20TokenModal ref="addTokenModal"></AddERC20TokenModal>
        <TokenListModal ref="tokenlistModal"></TokenListModal>
        <div class="headers">
            <p class="icon_col"></p>
            <p class="name_col">{{ $t('portfolio.name') }}</p>
            <p class="send_col">{{ $t('portfolio.send') }}</p>
            <p class="balance_col balance_header">{{ $t('portfolio.balance') }}</p>
        </div>
        <div v-show="networkStatus !== 'connected'" class="empty">
            <p>{{ $t('portfolio.error_network') }}</p>
        </div>
        <div v-show="networkStatus === 'connected'" style="flex-grow: 1">
            <div class="sdk_section_header">Default Assets</div>
            <div v-if="walletBalances.length === 0 && erc20Balances.length === 0 && sdkAssetsFiltered.length === 0 && !sdkLoading" class="empty">
                <p>{{ $t('portfolio.nobalance') }}</p>
            </div>
            <div class="scrollable no_scroll_bar" v-else>
                <div class="scrollabe_cont">
                    <fungible-row
                        class="asset"
                        v-for="asset in walletBalances"
                        :key="asset.id"
                        :asset="asset"
                    ></fungible-row>
                    <ERC20Row
                        class="asset"
                        v-for="erc in erc20Balances"
                        :key="erc.data.address"
                        :token="erc"
                    ></ERC20Row>
                    <template v-if="sdkAssetsFiltered.length > 0">
                        <div class="sdk_section_header">All Assets</div>
                        <CChainSdkRow
                            class="asset"
                            v-for="(asset, i) in sdkAssetsFiltered"
                            :key="asset.address + (asset.tokenId ?? '') + i"
                            :asset="asset"
                            :alternate="i % 2 === 1"
                        ></CChainSdkRow>
                    </template>
                    <div v-else-if="sdkLoading" class="sdk_loading">Loading C-chain assets…</div>
                    <div class="asset add_token_row">
                        <button @click="addToken">Manually Add Token</button>                        
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import 'reflect-metadata'
import { defineComponent, ref, computed, toRef } from 'vue'
import { useAssetsStore, useNetworkStore, useMainStore } from '@/stores'

import FaucetLink from '@/components/misc/FaucetLink.vue'
import FungibleRow from '@/components/wallet/portfolio/FungibleRow.vue'
import AvaAsset from '@/js/AvaAsset'
import Erc20Token from '@/js/Erc20Token'
import ERC20Row from '@/components/wallet/portfolio/ERC20Row.vue'
import CChainSdkRow from '@/components/wallet/portfolio/CChainSdkRow.vue'
import AddERC20TokenModal from '@/components/modals/AddERC20TokenModal.vue'
import TokenListModal from '@/components/modals/TokenList/TokenListModal.vue'
import { AvalancheAccount } from '@avalanche-sdk/client/accounts'
import { useCChainSdkBalances } from '@/composables/useCChainSdkBalances'
import type { CChainSdkAsset } from '@/composables/useCChainSdkBalances'

interface Props {
    search: string
}

export default defineComponent({
    name: 'Fungibles',
    components: {
        TokenListModal,
        AddERC20TokenModal,
        ERC20Row,
        CChainSdkRow,
        FaucetLink,
        FungibleRow,
    },
    props: {
        search: {
            type: String,
            required: true
        }
    },
    setup(props: Props) {
        const assetsStore = useAssetsStore()
        const networkStore = useNetworkStore()
        const mainStore = useMainStore()
        const addTokenModal = ref<InstanceType<typeof AddERC20TokenModal>>()
        const tokenlistModal = ref<InstanceType<typeof TokenListModal>>()

        const networkStatus = computed((): string => {
            let stat = networkStore.status
            return stat
        })

        const avaxToken = computed((): AvaAsset => {
            return assetsStore.AssetAVA
        })

        const erc20Balances = computed((): Erc20Token[] => {
            let tokens: Erc20Token[] = assetsStore.networkErc20Tokens
            let filt = tokens.filter((token) => {
                if (token.balanceBN.isZero()) return false
                return true
            })
            return filt
        })

        const walletBalancesSorted = computed((): AvaAsset[] => {
            
            let balance: AvaAsset[] = assetsStore.walletAssetsArray

            // Sort by balance, then name
            balance.sort((a, b) => {
                let symbolA = a.symbol.toUpperCase()
                let symbolB = b.symbol.toUpperCase()
                let amtA = a.getAmount()
                let amtB = b.getAmount()
                let idA = a.id
                let idB = b.id

                // AVA always on top
                if (idA === avaxToken.value.id) {
                    return -1
                } else if (idB === avaxToken.value.id) {
                    return 1
                }

                if (amtA.gt(amtB)) {
                    return -1
                } else if (amtA.lt(amtB)) {
                    return 1
                }

                if (symbolA < symbolB) {
                    return -1
                } else if (symbolA > symbolB) {
                    return 1
                }
                return 0
            })

            return balance
        })

        const walletBalances = computed((): AvaAsset[] => {
            let balance = walletBalancesSorted.value

            if (props.search) {
                balance = balance.filter((val) => {
                    let query = props.search.toUpperCase()

                    let nameUp = val.name.toUpperCase()
                    let symbolUp = val.symbol.toUpperCase()

                    if (nameUp.includes(query) || symbolUp.includes(query)) {
                        return true
                    } else {
                        return false
                    }
                })
            }

            return balance
        })

        const cChainAddress = computed((): string | null => {
            const wallet = mainStore.activeWallet as any
            if (!wallet) return null
            const addr: string | undefined = wallet.ethAddress
            if (!addr) return null
            return addr.startsWith('0x') ? addr : `0x${addr}`
        })

        const evmChainId = computed((): number => assetsStore.evmChainId)

        const { assets: sdkAssets, loading: sdkLoading } = useCChainSdkBalances(
            cChainAddress,
            evmChainId
        )

        const sdkAssetsFiltered = computed((): CChainSdkAsset[] => {
            let list = sdkAssets.value
            if (props.search) {
                const query = props.search.toUpperCase()
                list = list.filter((a) => {
                    return (
                        a.name.toUpperCase().includes(query) ||
                        a.symbol.toUpperCase().includes(query)
                    )
                })
            }
            return list
        })

        const addToken = () => {
            addTokenModal.value?.open()
        }

        const addTokenList = () => {
            tokenlistModal.value?.open()
        }

        return {
            addTokenModal,
            tokenlistModal,
            networkStatus,
            walletBalancesSorted,
            avaxToken,
            erc20Balances,
            walletBalances,
            sdkAssetsFiltered,
            sdkLoading,
            addToken,
            addTokenList
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';
@use './portfolio';

.fungibles_view {
    display: flex;
    flex-direction: column;
}

.search {
    height: 20px;
    font-size: 15px;
    display: flex;
    align-items: center;
    margin-bottom: 30px;
    img {
        height: 100%;
        object-fit: contain;
        margin-right: 15px;
        opacity: 0.4;
    }

    input {
        outline: none;
    }
}

.headers {
    border-bottom: 1px solid var(--bg-light);
    font-size: 12px;
    padding: 12px 0;
    color: var(--primary-color-light);
    font-weight: bold;
}

.scrollable {
    flex-grow: 1;
}

.scrollabe_cont {
    height: auto;
}
.asset {
    border-bottom: 1px solid var(--bg-light);
}

.send_col {
    text-align: center;
}

.empty {
    padding: 30px;
    text-align: center;
}

.sdk_section_header {
    font-size: 11px;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--primary-color-light);
    padding: 14px 0 6px;
    border-top: 1px solid var(--bg-light);
    margin-top: 4px;
}

.sdk_loading {
    padding: 14px 0;
    font-size: 13px;
    color: var(--primary-color-light);
}

.faucet {
    margin: 0px auto;
    margin-top: 60px;
}

.name_col {
    white-space: nowrap;
}

@include main.mobile-device {
    .headers,
    .asset {
        grid-template-columns: 50px 1fr 1fr 50px;
    }

    .balance_col {
        text-align: right;
        span {
            display: none;
        }
    }
    .balance_col {
        grid-column: 3;
        grid-row: 1;
    }

    .send_col {
        grid-column: 4;
    }

    .headers {
        padding: 14px 0;
        .send_col {
            display: none;
        }
    }

    .scrollable {
        height: 90vh;
    }
}

@include main.medium-device {
    .headers {
        padding: 12px 0;
    }
}
</style>
<style lang="scss">
@use '../../../main';
.fungibles_view {
    .balance_col {
        text-align: right;
        display: inline-block;

        span {
            padding-left: 8px;
            text-align: right;
        }
    }

    .balance_header {
        grid-template-columns: 1fr;
    }

    .name_col {
        padding-left: 10px;
    }

    .headers,
    .asset {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr) 100px minmax(0, 1fr);
    }
}

@include main.mobile-device {
    .fungibles_view {
        .headers,
        .asset {
            grid-template-columns: max-content minmax(0, 1fr) minmax(0, 1fr) 50px;
        }

        .balance_col {
            white-space: nowrap;
            grid-template-columns: 1fr;
        }
        .balance_col {
            grid-column: 3;
            grid-row: 1;
        }

        .send_col {
            grid-column: 4;
        }

        .headers {
            .send_col {
                display: none;
            }
        }
    }
}


</style>
