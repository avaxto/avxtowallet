<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="launcher_page">
        <h1>Token Launcher</h1>
        <p class="desc">
            Deploy your own ERC20 token to
            <strong>{{ targetNetwork ? targetNetwork.name : 'the connected network' }}</strong>.
            Choose a name, symbol, supply and decimals — the launcher compiles the standard
            OpenZeppelin ERC20 template, signs the deployment with your active wallet and
            broadcasts it via RPC. You receive the contract address and an explorer link.
        </p>

        <div v-if="!signer" class="card notice">
            <p>
                No EVM wallet is connected. Connect a wallet on a platform with an EVM chain —
                Avalanche or the EVM platform — to deploy a token.
            </p>
        </div>

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
                    autocomplete="off"
                    name="tl-field-a"
                    data-1p-ignore
                    data-lpignore="true"
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
                    autocomplete="off"
                    name="tl-field-b"
                    data-1p-ignore
                    data-lpignore="true"
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
                        autocomplete="off"
                        name="tl-field-c"
                        data-1p-ignore
                        data-lpignore="true"
                    />
                </div>
                <div class="field">
                    <label>Coins to Mint</label>
                    <input
                        v-model="form.initialSupply"
                        type="text"
                        placeholder="1000000"
                        :disabled="isDeploying"
                        autocomplete="off"
                        name="tl-field-d"
                        data-1p-ignore
                        data-lpignore="true"
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
                    autocomplete="off"
                    name="tl-field-e"
                    data-1p-ignore
                    data-lpignore="true"
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
            <a
                v-if="explorerUrl"
                class="explorer_link"
                :href="explorerUrl"
                target="_blank"
                rel="noopener noreferrer"
            >
                View on {{ explorerLabel }} ↗
            </a>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, reactive, computed } from 'vue'
import { useNotificationsStore } from '@/stores'
import {
    deployToken,
    tokenExplorerUrl,
    TokenLaunchParams,
    TokenLaunchResult,
} from '@/js/TokenLauncher'
import { activeEvmSigner } from '@/platforms/evmSigner'
import { explorerName } from '@/evm/networkRegistry'
import { authorizeSingle, SessionAuthCancelled } from '@/js/security/authorize'

export default defineComponent({
    name: 'Launcher',
    setup() {
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

        /**
         * The signer for whichever platform is active — Avalanche's wallet
         * hierarchy or the unified EVM platform's. Null when nothing is
         * connected or the platform has no EVM chain, which is what disables
         * the form rather than any check on a platform id.
         *
         * Recomputed for display; the deploy below resolves it ONCE and threads
         * it through, per the invariant in `@/evm/signer`.
         */
        const signer = computed(() => activeEvmSigner())

        /** The chain a deploy would land on, for labels and the explorer link. */
        const targetNetwork = computed(() => signer.value?.network ?? null)

        /** Pinned when the deploy is submitted, so the result card cannot relabel itself. */
        const resultNetwork = ref(targetNetwork.value)

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
                !!signer.value &&
                !!form.name.trim() &&
                !!form.symbol.trim() &&
                !!form.maxSupply.trim() &&
                !!form.initialSupply.trim() &&
                !validationError.value
            )
        })

        const explorerUrl = computed(() =>
            result.value && resultNetwork.value
                ? tokenExplorerUrl(resultNetwork.value, result.value.contractAddress)
                : ''
        )

        const explorerLabel = computed(() =>
            resultNetwork.value ? explorerName(resultNetwork.value) : 'the explorer'
        )

        const deploy = async () => {
            // Resolved once, here, and used for the whole flow — re-reading it
            // mid-deploy could hand back a signer for a different chain than
            // the one the gas was estimated against.
            const activeSigner = signer.value
            if (!activeSigner || !canDeploy.value) return
            isDeploying.value = true
            result.value = null
            try {
                resultNetwork.value = activeSigner.network

                const params: TokenLaunchParams = {
                    name: form.name.trim(),
                    symbol: form.symbol.trim(),
                    decimals: form.decimals,
                    initialSupply: form.initialSupply.trim(),
                    maxSupply: form.maxSupply.trim(),
                }

                const res = await authorizeSingle(
                    activeSigner.authSubject,
                    'Deploy a token contract',
                    () => deployToken(activeSigner, params)
                )
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
            signer,
            targetNetwork,
            explorerUrl,
            explorerLabel,
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

.notice p {
    color: var(--primary-color-light);
    line-height: 1.5;
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
        color: var(--primary-color);
    }

    input {
        background: var(--bg);
        border: 1px solid var(--bg-light);
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
    // `--platform-on-accent` is set alongside `--secondary-color` whenever a
    // platform overrides the accent (e.g. a high-luminance chartreuse, which
    // needs dark text to stay legible) — see platforms/theme.ts. Falls back
    // to white, correct against every accent with no platform theme.
    // !important: `body` in _main.scss forces --primary-color with
    // !important, which otherwise wins over this regardless of specificity.
    color: var(--platform-on-accent, #fff) !important;
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
        color: var(--primary-color);
    }

    .result_value {
        font-size: 13px;
        word-break: break-all;
        flex: 1;
        color: var(--primary-color);
    }

    .mono {
        font-family: monospace;
    }

    .copy_btn {
        border: 1px solid var(--bg-light);
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
