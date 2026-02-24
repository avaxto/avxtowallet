<template>
    <modal ref="modal" title="Add Token" @beforeClose="beforeClose">
        <div class="add_token_body">
            <div>
                <label>Token Contract Address</label>
                <input v-model="tokenAddress" placeholder="0x" />
                <p class="err">{{ err }}</p>
            </div>

            <div class="meta" :found="canAdd">
                <div>
                    <label>Token Name</label>
                    <input v-model="name" disabled />
                </div>
                <div>
                    <label>Token Symbol</label>
                    <input v-model="symbol" disabled />
                </div>
                <div>
                    <label>Decimals of Precision</label>
                    <input type="number" v-model="denomination" disabled />
                </div>
            </div>

            <v-btn class="button_secondary" block depressed :disabled="!canAdd" @click="submit">
                Add Token
            </v-btn>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import { useAssetsStore, useNotificationsStore } from '@/stores'

import Modal from './Modal.vue'
import { web3 } from '@/evm'
import ERC20Abi from '@openzeppelin/contracts/build/contracts/ERC20.json'
import Erc20Token from '@/js/Erc20Token'
import { TokenListToken } from '@/types'

export default defineComponent({
    name: 'AddERC20TokenModal',
    components: {
        Modal,
    },
    setup() {
        const assetsStore = useAssetsStore()
        const notificationsStore = useNotificationsStore()
        const modal = ref<InstanceType<typeof Modal> | null>(null)
        const tokenAddress = ref('')
        const name = ref('')
        const symbol = ref('')
        const denomination = ref(1)
        const canAdd = ref(false)
        const err = ref('')

        const validateAddress = async (val: string) => {
            if (val === '') {
                err.value = ''
                return false
            }
            try {
                //@ts-ignore
                const tokenInst = new web3.eth.Contract(ERC20Abi.abi, val)
                const tokenName = await tokenInst.methods.name().call()
                const tokenSymbol = await tokenInst.methods.symbol().call()
                const decimals = await tokenInst.methods.decimals().call()

                symbol.value = tokenSymbol
                denomination.value = decimals
                name.value = tokenName

                canAdd.value = true
                return true
            } catch (e) {
                canAdd.value = false
                symbol.value = '-'
                denomination.value = 0
                name.value = '-'
                err.value = 'Invalid contract address.'
                return false
            }
        }

        const clear = () => {
            tokenAddress.value = ''
            canAdd.value = false
            symbol.value = '-'
            denomination.value = 0
            name.value = '-'
            err.value = ''
        }

        const submit = async () => {
            try {
                const data: TokenListToken = {
                    address: tokenAddress.value,
                    name: name.value,
                    symbol: symbol.value,
                    decimals: denomination.value,
                    chainId: assetsStore.evmChainId,
                    logoURI: '',
                }

                const token: Erc20Token = await assetsStore.addCustomErc20Token(data)

                notificationsStore.add({
                    title: 'ERC20 Token Added',
                    message: token.data.name,
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
            denomination,
            canAdd,
            err,
            submit,
            beforeClose,
            open,
            close
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

@include main.mobile-device {
    .add_token_body {
        width: 100%;
    }
}
</style>
