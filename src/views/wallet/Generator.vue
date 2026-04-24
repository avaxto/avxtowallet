<template>
    <div class="generator_page">
        <h1>Mnemonic Key Phrase Generator</h1>
        <p class="desc">
            Generate a new 24-word BIP39 mnemonic key phrase. This phrase is the master key to a
            wallet — store it somewhere safe and never share it with anyone.
        </p>

        <div class="card" v-if="!keyPhrase">
            <div class="empty_state">
                <fa icon="key" class="icon"></fa>
                <p>No key phrase generated yet.</p>
                <v-btn class="button_secondary" depressed @click="generate">
                    Generate Key Phrase
                </v-btn>
            </div>
        </div>

        <div class="card" v-else>
            <div class="phrase_header">
                <span class="badge">24 Words &nbsp;·&nbsp; BIP39</span>
                <div class="phrase_actions">
                    <v-btn
                        class="button_secondary"
                        x-small
                        depressed
                        @click="copyPhrase"
                        :disabled="copied"
                    >
                        <fa icon="copy" class="icon_sm"></fa>
                        {{ copied ? 'Copied!' : 'Copy' }}
                    </v-btn>
                    <v-btn class="button_secondary" x-small depressed @click="generate">
                        <fa icon="sync" class="icon_sm"></fa>
                        Regenerate
                    </v-btn>
                </div>
            </div>

            <div class="mnemonic_grid notranslate" translate="no">
                <div
                    v-for="(word, i) in words"
                    :key="i"
                    class="word_cell"
                >
                    <span class="word_index">{{ i + 1 }}.</span>
                    <span class="word_text">{{ word }}</span>
                </div>
            </div>

            <div class="warning_box">
                <fa icon="exclamation-triangle" class="warn_icon"></fa>
                <p>
                    Write this phrase down and keep it offline. Anyone with access to this phrase
                    controls the wallet. There is no way to recover it if lost.
                </p>
            </div>

            <div class="derive_section">
                <h2>Derived Addresses</h2>
                <p class="derive_desc">Preview addresses derived from this key phrase.</p>
                <div class="addr_grid" v-if="addresses.xAddr || addresses.pAddr || addresses.cAddr">
                    <div class="addr_row" v-if="addresses.xAddr">
                        <label>X-Chain</label>
                        <span class="addr notranslate" translate="no">{{ addresses.xAddr }}</span>
                    </div>
                    <div class="addr_row" v-if="addresses.pAddr">
                        <label>P-Chain</label>
                        <span class="addr notranslate" translate="no">{{ addresses.pAddr }}</span>
                    </div>
                    <div class="addr_row" v-if="addresses.cAddr">
                        <label>C-Chain</label>
                        <span class="addr notranslate" translate="no">{{ addresses.cAddr }}</span>
                    </div>
                </div>
                <div v-else-if="isDerivingAddrs" class="deriving">
                    <Spinner></Spinner>
                    <p>Deriving addresses…</p>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, ref, watch } from 'vue'
import * as bip39 from 'bip39'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import Spinner from '@/components/misc/Spinner.vue'

interface DerivedAddresses {
    xAddr: string
    pAddr: string
    cAddr: string
}

export default defineComponent({
    name: 'generator',
    components: { Spinner },
    setup() {
        const keyPhrase = ref<string | null>(null)
        const words = ref<string[]>([])
        const copied = ref(false)
        const isDerivingAddrs = ref(false)
        const addresses = ref<DerivedAddresses>({ xAddr: '', pAddr: '', cAddr: '' })

        const generate = () => {
            const mnemonic = bip39.generateMnemonic(256)
            keyPhrase.value = mnemonic
            words.value = mnemonic.split(' ')
            copied.value = false
            addresses.value = { xAddr: '', pAddr: '', cAddr: '' }
        }

        const copyPhrase = async () => {
            if (!keyPhrase.value) return
            await navigator.clipboard.writeText(keyPhrase.value)
            copied.value = true
            setTimeout(() => {
                copied.value = false
            }, 2000)
        }

        watch(keyPhrase, async (mnemonic) => {
            if (!mnemonic) return
            isDerivingAddrs.value = true
            try {
                const wallet = new MnemonicWallet(mnemonic)
                addresses.value = {
                    xAddr: wallet.getCurrentAddressAvm(),
                    pAddr: wallet.getCurrentAddressPlatform(),
                    cAddr: '0x' + wallet.ethAddress,
                }
            } catch (e) {
                console.warn('Address derivation failed:', e)
            } finally {
                isDerivingAddrs.value = false
            }
        })

        return {
            keyPhrase,
            words,
            copied,
            isDerivingAddrs,
            addresses,
            generate,
            copyPhrase,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

h1 {
    font-weight: normal;
    margin-bottom: 8px;
}

.desc {
    color: var(--primary-color-light);
    font-size: 14px;
    margin-bottom: 24px;
    max-width: 680px;
}

.card {
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 30px;
    max-width: 820px;
}

/* Empty state */
.empty_state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    padding: 30px 0;
    color: var(--primary-color-light);

    .icon {
        font-size: 42px;
        opacity: 0.4;
    }
}

/* Phrase header */
.phrase_header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 8px;
}

.badge {
    font-size: 12px;
    font-weight: bold;
    background-color: var(--secondary-color);
    color: #fff;
    padding: 3px 10px;
    border-radius: 12px;
    letter-spacing: 0.5px;
}

.phrase_actions {
    display: flex;
    gap: 8px;
}

.icon_sm {
    margin-right: 5px;
    font-size: 12px;
}

/* Word grid */
.mnemonic_grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 8px 12px;
    margin-bottom: 24px;
}

.word_cell {
    display: flex;
    align-items: baseline;
    gap: 5px;
    background-color: var(--bg);
    padding: 6px 10px;
    border-radius: 4px;
    font-family: Inconsolata, monospace;
}

.word_index {
    font-size: 11px;
    color: var(--primary-color-light);
    min-width: 18px;
    text-align: right;
    flex-shrink: 0;
}

.word_text {
    font-size: 14px;
    color: var(--primary-color);
    font-weight: bold;
}

/* Warning */
.warning_box {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    background-color: rgba(220, 80, 50, 0.12);
    border: 1px solid rgba(220, 80, 50, 0.35);
    border-radius: 4px;
    padding: 14px 16px;
    margin-bottom: 28px;

    .warn_icon {
        color: #dc5032;
        margin-top: 2px;
        flex-shrink: 0;
    }

    p {
        font-size: 13px;
        color: var(--primary-color);
        margin: 0;
    }
}

/* Derived addresses */
.derive_section {
    border-top: 1px solid var(--bg-wallet);
    padding-top: 20px;

    h2 {
        font-size: 16px;
        font-weight: normal;
        margin-bottom: 4px;
    }

    .derive_desc {
        font-size: 13px;
        color: var(--primary-color-light);
        margin-bottom: 14px;
    }
}

.addr_grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.addr_row {
    display: grid;
    grid-template-columns: 80px 1fr;
    align-items: center;
    gap: 10px;

    label {
        font-size: 12px;
        font-weight: bold;
        color: var(--primary-color-light);
    }

    .addr {
        font-family: Inconsolata, monospace;
        font-size: 13px;
        color: var(--primary-color);
        word-break: break-all;
    }
}

.deriving {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--primary-color-light);
    font-size: 13px;
}

/* Responsive */
@include main.medium-device {
    .mnemonic_grid {
        grid-template-columns: repeat(4, 1fr);
    }
}

@include main.mobile-device {
    .mnemonic_grid {
        grid-template-columns: repeat(3, 1fr);
    }

    .phrase_header {
        flex-direction: column;
        align-items: flex-start;
    }

    .addr_row {
        grid-template-columns: 1fr;
    }
}
</style>
