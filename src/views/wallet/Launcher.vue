<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="launcher_page">
        <h1>Token Launcher</h1>
        <p class="desc">
            Deploy your own ERC20 token to the Avalanche C-Chain. Choose a name, symbol, supply
            and decimals — the launcher compiles the standard OpenZeppelin ERC20 template, signs
            the deployment with your active wallet and broadcasts it via RPC. You receive the
            contract address and a C-Chain explorer link.
        </p>

        <div class="card">
            <h2>Token Details</h2>

            <div class="field">
                <label>Token Name</label>
                <input
                    v-model="form.name"
                    type="text"
                    placeholder="My Token"
                    :disabled="isDeploying"
                    maxlength="64"
                />
            </div>

            <div class="field">
                <label>Symbol</label>
                <input
                    v-model="form.symbol"
                    type="text"
                    placeholder="MTK"
                    :disabled="isDeploying"
                    maxlength="12"
                    @input="form.symbol = form.symbol.toUpperCase()"
                />
            </div>

            <div class="field_row">
                <div class="field">
                    <label>Decimals</label>
                    <input
                        v-model.number="form.decimals"
                        type="number"
                        min="0"
                        max="18"
                        :disabled="isDeploying"
                    />
                </div>
                <div class="field">
                    <label>Coins to Mint</label>
                    <input
                        v-model="form.initialSupply"
                        type="text"
                        placeholder="1000000"
                        :disabled="isDeploying"
                    />
                    <span class="field_hint">Minted to your wallet on deploy.</span>
                </div>
            </div>

            <div class="field">
                <label>Max Supply (cap)</label>
                <input
                    v-model="form.maxSupply"
                    type="text"
                    placeholder="1000000"
                    :disabled="isDeploying"
                />
                <span class="field_hint">
                    Hard cap on total supply. You (the owner) can mint up to this amount later.
                </span>
            </div>

            <p v-if="validationError" class="error_msg">{{ validationError }}</p>

            <button
                type="button"
                class="deploy_btn"
                :disabled="!canDeploy || isDeploying"
                @click="deploy"
            >
                <span v-if="isDeploying">Deploying…</span>
                <span v-else>Deploy Token</span>
            </button>
            <p v-if="isDeploying" class="info_msg">
                Compiling constructor data and broadcasting — confirm in your wallet if prompted.
                This can take a few seconds.
            </p>
        </div>

        <!-- ── Result ── -->
        <div v-if="result" class="card result_card">
            <h2>🎉 Token Deployed</h2>
            <div class="result_row">
                <span class="result_label">Contract</span>
                <span class="result_value mono">{{ result.contractAddress }}</span>
                <button class="copy_btn" type="button" @click="copy(result.contractAddress)">
                    Copy
                </button>
            </div>
            <div class="result_row">
                <span class="result_label">Tx Hash</span>
                <span class="result_value mono">{{ result.txHash }}</span>
            </div>
            <a class="explorer_link" :href="explorerUrl" target="_blank" rel="noopener noreferrer">
                View on C-Chain Explorer ↗
            </a>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed } from 'vue'
import { useMainStore, useNotificationsStore } from '@/stores'
import { BN } from '@/avalanche'
import { web3 } from '@/evm'
import { GasHelper } from '@/avalanche-wallet-sdk'
import {
    deployToken,
    cChainExplorerAddressUrl,
    TokenLaunchParams,
    TokenLaunchResult,
} from '@/js/TokenLauncher'
import { AvaWalletCore } from '@/js/wallets/types'

export default defineComponent({
    name: 'Launcher',
    setup() {
        const mainStore = useMainStore()
        const notifications = useNotificationsStore()

        const form = reactive({
            name: '',
            symbol: '',
            decimals: 18,
            initialSupply: '',
            maxSupply: '',
        })

        const isDeploying = ref(false)
        const result = ref<TokenLaunchResult | null>(null)
        const evmChainId = ref(43114)

        const wallet = computed(() => mainStore.activeWallet as AvaWalletCore | null)

        const validationError = computed(() => {
            if (!form.name.trim()) return null
            if (form.decimals < 0 || form.decimals > 18 || !Number.isInteger(form.decimals)) {
                return 'Decimals must be a whole number between 0 and 18.'
            }
            if (form.initialSupply && !/^\d+(\.\d+)?$/.test(form.initialSupply.trim())) {
                return 'Coins to mint must be a positive number.'
            }
            if (form.maxSupply && !/^\d+(\.\d+)?$/.test(form.maxSupply.trim())) {
                return 'Max supply must be a positive number.'
            }
            if (form.initialSupply && form.maxSupply) {
                try {
                    const init = parseFloat(form.initialSupply)
                    const cap = parseFloat(form.maxSupply)
                    if (cap <= 0) return 'Max supply must be greater than zero.'
                    if (init > cap) return 'Coins to mint cannot exceed max supply.'
                } catch (e) {
                    /* handled by regex above */
                }
            }
            return null
        })

        const canDeploy = computed(() => {
            return (
                !!wallet.value &&
                !!form.name.trim() &&
                !!form.symbol.trim() &&
                !!form.maxSupply.trim() &&
                !!form.initialSupply.trim() &&
                !validationError.value
            )
        })

        const explorerUrl = computed(() =>
            result.value
                ? cChainExplorerAddressUrl(result.value.contractAddress, evmChainId.value)
                : ''
        )

        const deploy = async () => {
            if (!wallet.value || !canDeploy.value) return
            isDeploying.value = true
            result.value = null
            try {
                evmChainId.value = await web3.eth.getChainId()

                const gasPrice: BN = await GasHelper.getAdjustedGasPrice()

                const params: TokenLaunchParams = {
                    name: form.name.trim(),
                    symbol: form.symbol.trim(),
                    decimals: form.decimals,
                    initialSupply: form.initialSupply.trim(),
                    maxSupply: form.maxSupply.trim(),
                }

                const res = await deployToken(wallet.value, params, gasPrice)
                result.value = res
                notifications.add({
                    type: 'success',
                    title: 'Token Deployed',
                    message: `${params.symbol} is live at ${res.contractAddress}`,
                })
            } catch (e: any) {
                console.error('Token deployment failed', e)
                notifications.add({
                    type: 'error',
                    title: 'Deployment Failed',
                    message: e?.message || 'Could not deploy the token. Check your balance and try again.',
                })
            } finally {
                isDeploying.value = false
            }
        }

        const copy = (text: string) => {
            navigator.clipboard?.writeText(text)
            notifications.add({ type: 'info', title: 'Copied', message: 'Contract address copied.' })
        }

        return {
            form,
            isDeploying,
            result,
            validationError,
            canDeploy,
            explorerUrl,
            deploy,
            copy,
        }
    },
})
</script>

<style lang="scss" scoped>
.launcher_page {
    max-width: 640px;

    h1 {
        margin-bottom: 8px;
    }

    .desc {
        color: var(--primary-color-light);
        margin-bottom: 24px;
        line-height: 1.5;
    }
}

.card {
    background: var(--bg-light);
    border: 1px solid var(--bg-light);
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;

    h2 {
        margin: 0 0 16px;
        font-size: 18px;
    }
}

.field {
    display: flex;
    flex-direction: column;
    margin-bottom: 16px;
    flex: 1;

    label {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
    }

    input {
        background: var(--bg);
        border: 1px solid #d3d3d3;
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 15px;
        color: var(--primary-color);

        &:focus {
            outline: none;
            border-color: var(--secondary-color);
        }

        &:disabled {
            opacity: 0.6;
        }
    }

    .field_hint {
        font-size: 12px;
        color: var(--primary-color-light);
        margin-top: 4px;
    }
}

.field_row {
    display: flex;
    gap: 16px;
}

.deploy_btn {
    width: 100%;
    margin-top: 8px;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: var(--secondary-color);
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;

    &:hover:not(:disabled) {
        opacity: 0.9;
    }

    &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
}

.info_msg {
    margin-top: 12px;
    font-size: 13px;
    color: var(--primary-color-light);
}

.error_msg {
    margin: 4px 0 12px;
    font-size: 13px;
    color: #f44336;
}

.result_card {
    border-color: #4caf50;

    .result_row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }

    .result_label {
        font-size: 13px;
        font-weight: 600;
        min-width: 70px;
    }

    .result_value {
        font-size: 13px;
        word-break: break-all;
        flex: 1;
    }

    .mono {
        font-family: monospace;
    }

    .copy_btn {
        border: 1px solid #d3d3d3;
        background: var(--bg);
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        cursor: pointer;
    }

    .explorer_link {
        display: inline-block;
        margin-top: 8px;
        color: var(--secondary-color);
        font-weight: 600;
        text-decoration: none;

        &:hover {
            text-decoration: underline;
        }
    }
}
</style>
