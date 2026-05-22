<template>
    <div class="derive_page">
        <div class="head">
            <h1>Derive Address</h1>
            <p class="desc">
                Enter a BIP32 derivation path. The X-chain and P-chain addresses for that
                path under the active wallet will appear below.
            </p>
        </div>

        <div v-if="!isSupported" class="unsupported">
            <p>This feature is only available for mnemonic-based wallets and Core App injected wallets.</p>
        </div>

        <template v-else>
            <p class="base_hint">
                Deriving from <b>{{ baseLabel }}</b>:
                <span class="mono">{{ basePath }}</span>
            </p>

            <div class="input_wrap">
                <input
                    v-model="path"
                    class="path_input"
                    spellcheck="false"
                    autocomplete="off"
                    :placeholder="defaultPath"
                />
            </div>

            <div v-if="err" class="error">{{ err }}</div>

            <div v-else class="results">
                <div class="row">
                    <span class="chain_badge x">X</span>
                    <span class="addr mono">{{ xAddress }}</span>
                    <CopyText :value="xAddress" class="copy_btn" />
                </div>
                <div class="row">
                    <span class="chain_badge p">P</span>
                    <span class="addr mono">{{ pAddress }}</span>
                    <CopyText :value="pAddress" class="copy_btn" />
                </div>
            </div>

            <p v-if="walletType === 'injected'" class="note">
                The active wallet is connected via Core App and exposes only an account-level
                <b>extended public key</b>. Only soft derivation is possible — hardened
                indices (paths containing <code>'</code>) will fail. It is highly recommended you only
                use the default address with Core App. To use extended address indexes, log in using a mnemonic wallet instead.
            </p>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useMainStore } from '@/stores'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'
import MnemonicWallet, { AVA_ACCOUNT_PATH } from '@/js/wallets/MnemonicWallet'
import CopyText from '@/components/misc/CopyText.vue'
import HDKey from 'hdkey'
import { ava, bintools } from '@/AVA'
import { Buffer as BufferAvalanche } from '@/avalanche'
import { KeyPair as AVMKeyPair } from '@/avalanche/apis/avm'
import { getPreferredHRP } from '@/avalanche/utils/helperfunctions'

export default defineComponent({
    name: 'AddressesDerive',
    components: { CopyText },
    setup() {
        const mainStore = useMainStore()
        const wallet = computed(() => mainStore.activeWallet)

        const walletType = computed<'mnemonic' | 'injected' | 'other'>(() => {
            if (wallet.value instanceof MnemonicWallet) return 'mnemonic'
            if (wallet.value instanceof InjectedWallet) return 'injected'
            return 'other'
        })

        const isSupported = computed(
            () => walletType.value === 'mnemonic' || walletType.value === 'injected'
        )

        // The HD key the user's input is interpreted as a path relative to.
        //   - Mnemonic: master key (path is full m/44'/9000'/0'/0/0 style)
        //   - Injected: account-level xpub (path is m/0/0 style relative to that)
        const baseHdKey = computed<HDKey | null>(() => {
            const w = wallet.value
            if (w instanceof MnemonicWallet) return w.hdKey
            if (w instanceof InjectedWallet) {
                const k = (w as any)._accountKey as HDKey | null
                return k ?? null
            }
            return null
        })

        const basePath = computed(() => {
            if (walletType.value === 'mnemonic') return 'm (master key)'
            if (walletType.value === 'injected') return AVA_ACCOUNT_PATH
            return ''
        })

        const baseLabel = computed(() => {
            if (walletType.value === 'mnemonic') return 'master seed'
            if (walletType.value === 'injected') return 'account xpub'
            return ''
        })

        const defaultPath = computed(() => {
            if (walletType.value === 'mnemonic') return `${AVA_ACCOUNT_PATH}/0/0`
            if (walletType.value === 'injected') return 'm/0/0'
            return ''
        })

        const path = ref(defaultPath.value)

        const derived = computed((): { x: string; p: string; err: string } => {
            if (!isSupported.value) return { x: '', p: '', err: '' }
            const hd = baseHdKey.value
            if (!hd) return { x: '', p: '', err: 'Active wallet has no usable HD key.' }

            const raw = path.value.trim()
            if (!raw) return { x: '', p: '', err: 'Enter a derivation path.' }

            try {
                const node = hd.derive(raw)
                if (!node.publicKey) {
                    return { x: '', p: '', err: 'Derived node has no public key.' }
                }
                const pubKeyBuf = BufferAvalanche.from(
                    node.publicKey.toString('hex'),
                    'hex'
                )
                const addrBuf = AVMKeyPair.addressFromPublicKey(pubKeyBuf)
                const hrp = getPreferredHRP(ava.getNetworkID())
                return {
                    x: bintools.addressToString(hrp, 'X', addrBuf),
                    p: bintools.addressToString(hrp, 'P', addrBuf),
                    err: '',
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e)
                return { x: '', p: '', err: `Invalid path: ${msg}` }
            }
        })

        const xAddress = computed(() => derived.value.x)
        const pAddress = computed(() => derived.value.p)
        const err = computed(() => derived.value.err)

        return {
            isSupported,
            walletType,
            basePath,
            baseLabel,
            defaultPath,
            path,
            xAddress,
            pAddress,
            err,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

.derive_page {
    max-width: 720px;
    margin: 0 auto;
}

h1 {
    font-weight: normal;
}

.desc {
    color: var(--primary-color-light);
    font-size: 0.9em;
    margin-top: 4px;
}

.head {
    margin-bottom: 20px;
    text-align: center;
}

.unsupported {
    color: var(--primary-color-light);
    padding: 20px 0;
    text-align: center;
}

.base_hint {
    text-align: center;
    color: var(--primary-color-light);
    font-size: 0.85em;
    margin-bottom: 12px;
}

.mono {
    font-family: monospace;
}

.input_wrap {
    display: flex;
    justify-content: center;
    margin-bottom: 16px;
}

.path_input {
    width: 100%;
    max-width: 520px;
    padding: 12px 16px;
    font-family: monospace;
    font-size: 1.05em;
    text-align: center;
    border: 1px solid var(--bg);
    background-color: var(--bg-light);
    color: var(--primary-color);
    border-radius: 6px;
    outline: none;

    &:focus {
        border-color: var(--primary-color);
    }
}

.error {
    text-align: center;
    color: var(--secondary-color);
    background-color: var(--bg-light);
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 0.9em;
}

.results {
    background-color: var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
}

.row {
    display: grid;
    grid-template-columns: 36px 1fr 28px;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    font-size: 0.9em;

    & + .row {
        border-top: 1px solid var(--bg);
    }

    .addr {
        word-break: break-all;
        color: var(--primary-color);
    }
}

.chain_badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    font-size: 0.75em;
    font-weight: bold;
    color: #fff;

    &.x { background-color: #e84142; }
    &.p { background-color: #0a85c2; }
}

.copy_btn {
    justify-self: center;
}

.note {
    margin-top: 16px;
    font-size: 0.8em;
    color: var(--primary-color-light);
    text-align: center;

    code {
        background-color: var(--bg);
        padding: 1px 5px;
        border-radius: 3px;
        font-family: monospace;
    }
}

@include main.mobile-device {
    .path_input {
        font-size: 0.9em;
    }

    .row {
        grid-template-columns: 28px 1fr 24px;
        font-size: 0.78em;
    }
}
</style>
