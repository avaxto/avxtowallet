<template>
    <modal ref="modal" title="Add Collectible" @beforeClose="beforeClose">
        <div class="add_token_body">
            <div>
                <label>ERC721 Contract Address</label>
                <input v-model="tokenAddress" placeholder="0x" />
                <p class="err">{{ err }}</p>
            </div>

            <div class="meta" :found="canAdd">
                <div>
                    <label>Collectible Name</label>
                    <input v-model="name" disabled />
                </div>
                <div>
                    <label>Collectible Symbol</label>
                    <input v-model="symbol" disabled />
                </div>
            </div>

            <v-btn class="button_secondary" block depressed :disabled="!canAdd" @click="submit">
                Add Collectible
            </v-btn>
            <div class="already_added" v-if="networkTokens.length">
                <h4>Already added</h4>
                <div v-for="token in networkTokens" :key="token.contractAddress" class="flex-row">
                    <div class="flex-column" style="flex-grow: 1">
                        <p>{{ token.name }} {{ token.symbol }}</p>
                        <p class="subtext">{{ token.contractAddress }}</p>
                    </div>
                    <button @click="removeToken(token)"><fa icon="times"></fa></button>
                </div>
            </div>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue'
import { useAssetsStore, useErc721Store, useNotificationsStore } from '@/stores'

import Modal from './Modal.vue'
import { web3 } from '@/evm'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import ERC721Abi from '@openzeppelin/contracts/build/contracts/ERC721.json'
import Erc20Token from '@/js/Erc20Token'
import { TokenListToken } from '@/types'
import { ERC721TokenInput } from '@/types'
import { WalletType } from '@/js/wallets/types'
import axios from 'axios'
import ERC721Token from '@/js/ERC721Token'

export default defineComponent({
    name: 'AddERC721TokenModal',
    components: {
        Modal,
    },
    setup() {
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const erc721Store = useErc721Store()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const tokenAddress = ref('')
        const name = ref('')
        const symbol = ref('')
        const canAdd = ref(false)
        const err = ref('')

        const validateAddress = async (val: string) => {
            if (val === '') {
                err.value = ''
                return false
            }
            try {
                //@ts-ignore
                const tokenInst = new web3.eth.Contract(ERC721Abi.abi, val)
                const tokenName = await tokenInst.methods.name().call()
                const tokenSymbol = await tokenInst.methods.symbol().call()

                symbol.value = tokenSymbol
                name.value = tokenName

                canAdd.value = true
                return true
            } catch (e) {
                canAdd.value = false
                symbol.value = '-'
                name.value = '-'
                err.value = 'Invalid contract address.'
                return false
            }
        }

        const clear = () => {
            tokenAddress.value = ''
            canAdd.value = false
            symbol.value = '-'
            name.value = '-'
            err.value = ''
        }

        const submit = async () => {
            try {
                const data: ERC721TokenInput = {
                    address: tokenAddress.value,
                    name: name.value,
                    symbol: symbol.value,
                    chainId: assetsStore.evmChainId,
                }

                const token: ERC721Token = await erc721Store.addCustom(data)

                notificationsStore.add({
                    title: 'ERC721 Token Added',
                    message: token.name,
                })
                close()
            } catch (e: any) {
                err.value = e.message
                console.error(e)
            }
        }

        const beforeClose = () => {
            clear()
        }

        const open = () => {
            modal.value?.open()
        }

        const close = () => {
            modal.value?.close()
        }

        const removeToken = async (token: ERC721Token) => {
            await erc721Store.removeCustom(token)
        }

        const networkTokens = computed((): ERC721Token[] => {
            return erc721Store.networkContractsCustom
        })

        // Watch tokenAddress for changes
        watch(tokenAddress, async (val: string) => {
            err.value = ''
            if (val === '') {
                clear()
                return
            }
            await validateAddress(val)
        })

        return {
            modal,
            tokenAddress,
            name,
            symbol,
            canAdd,
            err,
            submit,
            beforeClose,
            open,
            close,
            removeToken,
            networkTokens
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.add_token_body {
    padding: 30px 22px;
    text-align: center;
    width: 380px;
    max-width: 100%;

    > div {
        &:first-of-type {
            margin-bottom: 14px;
            padding-bottom: 14px;
            border-bottom: 1px solid var(--bg-light);
        }
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
    }

    label {
        font-size: 13px;
    }
    input {
        width: 100%;
        background-color: var(--bg-light);
        padding: 14px 24px;
        border-radius: 3px;
        font-size: 14px;
        color: var(--primary-color);
    }

    > * {
        margin: 6px 0;
    }
}

.meta {
    text-align: left;
    background-color: var(--bg-light);
    opacity: 0.6;
    transition-duration: 0.3s;

    > div {
        border-bottom: 1px solid var(--bg);
        padding: 14px 24px;
    }

    label {
        color: var(--primary-color-light);
    }
    input {
        padding: 0;
        color: var(--primary-color);
    }
}

.meta[found] {
    opacity: 1;
}

.err {
    width: 100%;
    text-align: center;
}

.already_added {
    text-align: left;
    margin-top: 1em;

    h4 {
        text-align: center;
        margin: 0px auto;
    }
    > div {
        width: 100%;
        align-items: center;
        margin: 3px 0;

        button {
            align-self: baseline;
            font-size: 0.8em;
            opacity: 0.5;

            &:hover {
                opacity: 1;
            }
        }
    }
}

@include main.mobile-device {
    .add_token_body {
        width: 100%;
    }
}
</style>
