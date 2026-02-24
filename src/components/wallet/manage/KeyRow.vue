<template>
    <div class="addressItem" :selected="is_default">
        <ExportKeys
            v-if="walletType === 'mnemonic'"
            :wallets="[wallet]"
            ref="export_wallet"
        ></ExportKeys>
        <MnemonicPhraseModal
            v-if="walletType === 'mnemonic'"
            :phrase="mnemonicPhrase"
            ref="modal"
        ></MnemonicPhraseModal>
        <HdDerivationListModal
            :wallet="wallet"
            ref="modal_hd"
            v-if="isHDWallet"
        ></HdDerivationListModal>
        <PrivateKey
            v-if="walletType === 'singleton'"
            :privateKey="privateKey"
            ref="modal_priv_key"
        ></PrivateKey>
        <PrivateKey
            v-if="walletType !== 'ledger'"
            :privateKey="privateKeyC"
            ref="modal_priv_key_c"
        ></PrivateKey>
        <XpubModal :xpub="xpubXP" v-if="isHDWallet" ref="modal_xpub"></XpubModal>
        <div class="rows">
            <div class="header">
                <template v-if="is_default">
                    <img src="@/assets/key_active.svg" class="key_logo" />
                </template>
                <template v-else>
                    <img
                        v-if="$root.theme === 'day'"
                        src="@/assets/key_inactive.svg"
                        class="key_logo"
                    />
                    <img v-else src="@/assets/key_inactive_night.png" class="key_logo" />
                </template>
                <div class="header_cols">
                    <div class="detail">
                        <p class="addressVal">
                            <b>{{ walletTitle }}</b>
                        </p>
                        <Tooltip :text="$t('keys.tooltip')" v-if="isVolatile">
                            <fa icon="exclamation-triangle" class="volatile_alert"></fa>
                        </Tooltip>
                    </div>
                    <div class="buts">
                        <button class="selBut" @click="select" v-if="!is_default">
                            <span>{{ $t('keys.activate_key') }}</span>
                        </button>
                        <Tooltip
                            :text="$t('keys.remove_key')"
                            class="row_but circle"
                            @click="remove"
                            v-if="!is_default"
                        >
                            <img src="@/assets/trash_can_dark.svg" style="height: 16px" />
                        </Tooltip>
                        <Tooltip
                            v-if="walletType !== 'singleton'"
                            :text="$t('keys.hd_addresses')"
                            class="row_but circle"
                            @click="showPastAddresses"
                        >
                            <fa icon="list-ol"></fa>
                        </Tooltip>
                        <Tooltip
                            v-if="walletType === 'mnemonic'"
                            :text="$t('keys.export_key')"
                            class="row_but circle"
                            @click="showExportModal"
                        >
                            <fa icon="upload"></fa>
                        </Tooltip>
                        <div class="text_buts">
                            <button v-if="walletType == 'mnemonic'" @click="showModal">
                                {{ $t('keys.view_key') }}
                            </button>
                            <button v-if="walletType == 'singleton'" @click="showPrivateKeyModal">
                                {{ $t('keys.view_priv_key') }}
                            </button>
                            <button v-if="walletType !== 'ledger'" @click="showPrivateKeyCModal">
                                {{ $t('keys.view_priv_key_c') }}
                            </button>
                            <button v-if="isHDWallet" @click="showXpub">Show XPUB</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="header">
                <div></div>
                <div>
                    <p v-if="Object.keys(balances).length === 0" class="balance_empty">
                        {{ $t('keys.empty') }}
                    </p>
                    <div class="addressBalance bal_cols" v-else>
                        <p>This key has:</p>
                        <div class="bal_rows">
                            <p v-for="bal in balances" :key="bal.id">
                                {{ bal.toString() }}
                                <b>{{ bal.symbol }}</b>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useAssetsStore, useMainStore } from '@/stores'

import { bintools, keyChain } from '@/AVA'
import AvaAsset from '@/js/AvaAsset'
import { AssetsDict } from '@/types'
import { AmountOutput, KeyPair as AVMKeyPair } from '@/avalanche/apis/avm'
import MnemonicPhraseModal from '@/components/modals/MnemonicPhraseModal.vue'
import HdDerivationListModal from '@/components/modals/HdDerivationList/HdDerivationListModal.vue'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import Tooltip from '@/components/misc/Tooltip.vue'

import ExportKeys from '@/components/modals/ExportKeys.vue'
import PrivateKey from '@/components/modals/PrivateKey.vue'
import { WalletNameType, WalletType } from '@/js/wallets/types'

import { SingletonWallet } from '../../../js/wallets/SingletonWallet'
import MnemonicPhrase from '@/js/wallets/MnemonicPhrase'
import XpubModal from '@/components/modals/XpubModal.vue'
import { AbstractHdWallet } from '@/js/wallets/AbstractHdWallet'

interface IKeyBalanceDict {
    [key: string]: AvaAsset
}

export default defineComponent({
    name: 'KeyRow',
    components: {
        MnemonicPhraseModal,
        HdDerivationListModal,
        Tooltip,
        ExportKeys,
        PrivateKey,
        XpubModal,
    },
    props: {
        wallet: {
            type: Object as () => WalletType,
            required: true
        },
        is_default: {
            type: Boolean,
            default: false
        }
    },
    emits: ['remove', 'select'],
    setup(props, { emit }) {
        const assetsStore = useAssetsStore()
        const mainStore = useMainStore()
        
        const export_wallet = ref<InstanceType<typeof ExportKeys>>()
        const modal = ref<InstanceType<typeof MnemonicPhraseModal>>()
        const modal_hd = ref<InstanceType<typeof HdDerivationListModal>>()
        const modal_priv_key = ref<InstanceType<typeof PrivateKey>>()
        const modal_priv_key_c = ref<InstanceType<typeof PrivateKey>>()
        const modal_xpub = ref<InstanceType<typeof XpubModal>>()

        const isVolatile = computed(() => {
            const volatileWallets = mainStore.volatileWallets as WalletType[]
            return volatileWallets.includes(props.wallet)
        })

        const walletTitle = computed(() => {
            return props.wallet.getBaseAddress()
        })

        const assetsDict = computed((): AssetsDict => {
            return assetsStore.assetsDict
        })

        const balances = computed((): IKeyBalanceDict => {
            if (!props.wallet.getUTXOSet()) return {}

            let res: IKeyBalanceDict = {}

            let addrUtxos = props.wallet.getUTXOSet().getAllUTXOs()
            for (var n = 0; n < addrUtxos.length; n++) {
                let utxo = addrUtxos[n]

                // ignore NFTS and mint outputs
                //TODO: support nfts
                let outId = utxo.getOutput().getOutputID()
                if (outId === 11 || outId === 6 || outId === 10) continue

                let utxoOut = utxo.getOutput() as AmountOutput

                let amount = utxoOut.getAmount()
                let assetIdBuff = utxo.getAssetID()
                let assetId = bintools.cb58Encode(assetIdBuff)

                let assetObj: AvaAsset | undefined = assetsDict.value[assetId]

                if (!assetObj) {
                    let name = '?'
                    let symbol = '?'
                    let denomination = 0

                    let newAsset = new AvaAsset(assetId, name, symbol, denomination)
                    newAsset.addBalance(amount)

                    res[assetId] = newAsset
                    continue
                }

                let asset = res[assetId]
                if (!asset) {
                    let name = assetObj.name
                    let symbol = assetObj.symbol
                    let denomination = assetObj.denomination

                    let newAsset = new AvaAsset(assetId, name, symbol, denomination)
                    newAsset.addBalance(amount)

                    res[assetId] = newAsset
                } else {
                    asset.addBalance(amount)
                }
            }

            return res
        })

        const walletType = computed((): WalletNameType => {
            return props.wallet.type
        })

        const isHDWallet = computed(() => {
            return ['mnemonic', 'ledger'].includes(walletType.value)
        })

        const mnemonicPhrase = computed((): MnemonicPhrase | null => {
            if (walletType.value !== 'mnemonic') return null
            let wallet = props.wallet as MnemonicWallet
            return wallet.getMnemonicEncrypted()
        })

        const privateKey = computed((): string | null => {
            if (walletType.value !== 'singleton') return null
            let wallet = props.wallet as SingletonWallet
            return wallet.key
        })

        const privateKeyC = computed((): string | null => {
            if (walletType.value === 'ledger') return null
            let wallet = props.wallet as SingletonWallet | MnemonicWallet
            return wallet.ethKey
        })

        /**
         * Extended public key of m/44'/9000'/0' used for X and P chain addresses
         */
        const xpubXP = computed(() => {
            if (isHDWallet.value) {
                return (props.wallet as AbstractHdWallet).getXpubXP()
            }
            return null
        })

        const remove = () => {
            emit('remove', props.wallet)
        }
        
        const select = () => {
            emit('select', props.wallet)
        }

        const showModal = () => {
            //@ts-ignore
            modal.value?.open()
        }

        const showXpub = () => {
            modal_xpub.value?.open()
        }

        const showPastAddresses = () => {
            //@ts-ignore
            modal_hd.value?.open()
        }

        const showExportModal = () => {
            //@ts-ignore
            export_wallet.value?.open()
        }

        const showPrivateKeyModal = () => {
            //@ts-ignore
            modal_priv_key.value?.open()
        }

        const showPrivateKeyCModal = () => {
            //@ts-ignore
            modal_priv_key_c.value?.open()
        }

        return {
            export_wallet,
            modal,
            modal_hd,
            modal_priv_key,
            modal_priv_key_c,
            modal_xpub,
            isVolatile,
            walletTitle,
            assetsDict,
            balances,
            walletType,
            isHDWallet,
            mnemonicPhrase,
            privateKey,
            privateKeyC,
            xpubXP,
            remove,
            select,
            showModal,
            showXpub,
            showPastAddresses,
            showExportModal,
            showPrivateKeyModal,
            showPrivateKeyCModal
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

.addressItem {
    font-size: 12px;
    /*display: grid;*/
    /*grid-template-columns: 1fr max-content;*/
    /*grid-gap: 15px;*/
    overflow: auto;

    > * {
        align-self: center;
        overflow: auto;
    }
}

.key_logo {
    width: 32px;
}

.hdlist {
    grid-column: 1/3;
}

.buts {
    display: flex;
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;

    > * {
        margin: 0px 8px !important;
    }

    button {
        font-size: 16px;
    }

    $but_w: 32px;
    .circle {
        width: $but_w;
        height: $but_w;
        border-radius: $but_w;
        background-color: rgba(0, 0, 0, 0.1);
        display: flex;
        justify-content: center;
        align-self: center;

        &:hover {
            background-color: var(--bg);
        }
    }

    .text_buts {
        display: flex;
        flex-direction: column;
        > button {
            text-align: right;
            font-size: 13px;

            &:hover {
                color: var(--secondary-color);
            }
        }
    }
}

.row_but {
    margin: 0 12px;
}

.rows {
    overflow: auto;
}
.addressItem .selBut {
    flex-shrink: 0;
    flex-grow: 1;
    /*background-color: #C0C0CD;*/
    color: #867e89;
    padding: 4px 8px;

    span {
        font-size: 12px;
        line-height: normal;
    }
}

.header {
    display: grid;
    grid-template-columns: 32px 1fr;
    grid-gap: 14px;
    /*align-items: center;*/
}

.header_cols {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.detail {
    overflow: auto;
    display: flex;
    align-items: center;

    /*grid-template-columns: max-content max-content;*/
    /*column-gap: 15px;*/
}

.label {
    font-weight: bold;
}
.addressVal {
    overflow: auto;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: monospace;
    font-size: 15px;

    span {
        font-weight: normal;
        margin-right: 8px;
    }
}

.del {
    align-self: start;
    opacity: 0.4;

    &:hover {
        opacity: 1;
    }
}

.addressBalance {
    display: flex;
    white-space: nowrap;
    color: var(--primary-color);
    .bal_rows p {
        font-weight: bold;
        padding: 0px 8px;
        margin-bottom: 4px;
    }
    p {
        border-radius: 3px;
    }
}

.bal_cols {
    display: flex;
}

.bal_rows {
    display: flex;
    flex-direction: column;
}

.balance_empty {
    color: var(--primary-color);
}

.volatile_alert {
    color: var(--warning);
    font-size: 15px;
    margin-left: 6px;
}

@include main.mobile-device {
    .header_cols {
        display: block;
    }

    .detail {
        text-align: right;
    }

    .bal_cols {
        border-top: 1px solid #ddd;
        padding-top: 12px;
        margin-top: 12px;
    }
}
</style>
