<template>
    <div class="addresses_page">
        <PrivateKey :privateKey="revealKey" ref="privKeyModal" />
        <XpubModal :xpub="revealXpub" ref="xpubModal" />

        <div class="head">
            <h1>Addresses</h1>
            <p class="desc">All derived addresses associated with this wallet. This is an advanced feature, if you're not sure what you're doing, then you probably don't need this.</p>
        </div>

        <div v-if="!isSupported" class="unsupported">
            <p>Address listing is not available for this wallet type.</p>
        </div>

        <div v-else class="sections">
            <!-- X-chain External -->
            <div class="section">
                <div class="section_head">
                    <span class="chain_badge x">X</span>
                    <h2>X-Chain External</h2>
                    <span class="count">{{ xExternal.length }}</span>
                </div>
                <div class="addr_list">
                    <div v-if="xExternal.length === 0" class="empty">No addresses found.</div>
                    <div
                        v-for="(item, i) in xExternal"
                        :key="'xext-' + i"
                        class="addr_row"
                        :class="{ even: i % 2 === 0 }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <span class="addr">{{ item.address }}</span>
                        <span class="actions">
                            <Tooltip text="Copy address to clipboard" class="icon_btn">
                                <CopyText :value="item.address" />
                            </Tooltip>
                            <Tooltip
                                v-if="canRevealPrivateKey"
                                text="Show private key for this address"
                                class="icon_btn"
                                @click="openPrivKey('xExternal', item.index)"
                            >
                                <fa icon="key"></fa>
                            </Tooltip>
                            <Tooltip
                                v-else
                                text="Private key is held by the injected wallet (Core App) and cannot be exported"
                                class="icon_btn disabled"
                            >
                                <fa icon="lock"></fa>
                            </Tooltip>
                            <Tooltip
                                text="Show the account-level extended public key (xpub) this address derives from"
                                class="icon_btn"
                                @click="openXpub('account')"
                            >
                                <fa icon="share"></fa>
                            </Tooltip>
                        </span>
                    </div>
                </div>
            </div>

            <!-- X-chain Internal / Change -->
            <div class="section">
                <div class="section_head">
                    <span class="chain_badge x">X</span>
                    <h2>X-Chain Internal (Change)</h2>
                    <span class="count">{{ xInternal.length }}</span>
                </div>
                <div class="addr_list">
                    <div v-if="xInternal.length === 0" class="empty">No addresses found.</div>
                    <div
                        v-for="(item, i) in xInternal"
                        :key="'xint-' + i"
                        class="addr_row"
                        :class="{ even: i % 2 === 0 }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <span class="addr">{{ item.address }}</span>
                        <span class="actions">
                            <Tooltip text="Copy address to clipboard" class="icon_btn">
                                <CopyText :value="item.address" />
                            </Tooltip>
                            <Tooltip
                                v-if="canRevealPrivateKey"
                                text="Show private key for this address"
                                class="icon_btn"
                                @click="openPrivKey('xInternal', item.index)"
                            >
                                <fa icon="key"></fa>
                            </Tooltip>
                            <Tooltip
                                v-else
                                text="Private key is held by the injected wallet (Core App) and cannot be exported"
                                class="icon_btn disabled"
                            >
                                <fa icon="lock"></fa>
                            </Tooltip>
                            <Tooltip
                                text="Show the account-level extended public key (xpub) this address derives from"
                                class="icon_btn"
                                @click="openXpub('account')"
                            >
                                <fa icon="share"></fa>
                            </Tooltip>
                        </span>
                    </div>
                </div>
            </div>

            <!-- P-chain -->
            <div class="section">
                <div class="section_head">
                    <span class="chain_badge p">P</span>
                    <h2>P-Chain</h2>
                    <span class="count">{{ pChainAddrs.length }}</span>
                </div>
                <div class="addr_list">
                    <div v-if="pChainAddrs.length === 0" class="empty">No addresses found.</div>
                    <div
                        v-for="(item, i) in pChainAddrs"
                        :key="'p-' + i"
                        class="addr_row"
                        :class="{ even: i % 2 === 0 }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <span class="addr">{{ item.address }}</span>
                        <span class="actions">
                            <Tooltip text="Copy address to clipboard" class="icon_btn">
                                <CopyText :value="item.address" />
                            </Tooltip>
                            <Tooltip
                                v-if="canRevealPrivateKey"
                                text="Show private key for this address"
                                class="icon_btn"
                                @click="openPrivKey('p', item.index)"
                            >
                                <fa icon="key"></fa>
                            </Tooltip>
                            <Tooltip
                                v-else
                                text="Private key is held by the injected wallet (Core App) and cannot be exported"
                                class="icon_btn disabled"
                            >
                                <fa icon="lock"></fa>
                            </Tooltip>
                            <Tooltip
                                text="Show the account-level extended public key (xpub) this address derives from"
                                class="icon_btn"
                                @click="openXpub('account')"
                            >
                                <fa icon="share"></fa>
                            </Tooltip>
                        </span>
                    </div>
                </div>
            </div>

            <!-- Core App accounts (InjectedWallet only) -->
            <div v-if="coreAppAddrs.length > 0" class="section">
                <div class="section_head">
                    <span class="chain_badge core">Core</span>
                    <h2>Core App Accounts</h2>
                    <span class="count">{{ coreAppAddrs.length }}</span>
                </div>
                <div class="section_head">
                    <p class="desc">These are the main account addresses provided by the Core App extension. Only Account 1 is used by default. The other accounts are reserved in Core App but not shown in this wallet. It is strongly recommended you do not use any of these addresses as <b>you may lose funds</b> (although the Core extension holds these private keys, they're not immediately accessible by the user). <strong>Provided for advanced users only.</strong></p>
                </div>
                <div class="addr_list">
                    <div
                        v-for="(item, i) in coreAppAddrs"
                        :key="'core-' + i"
                        class="addr_row core_row"
                        :class="{ even: i % 2 === 0 }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <span class="label">{{ item.label }}</span>
                        <span class="addr">{{ item.address }}</span>
                        <span class="actions">
                            <Tooltip text="Copy address to clipboard" class="icon_btn">
                                <CopyText :value="item.address" />
                            </Tooltip>
                            <Tooltip
                                text="Private key is held by Core App and cannot be exported"
                                class="icon_btn disabled"
                            >
                                <fa icon="lock"></fa>
                            </Tooltip>
                            <Tooltip
                                text="Show this Core account's extended public key (xpub)"
                                class="icon_btn"
                                :class="{ disabled: !item.xpub }"
                                @click="item.xpub && openXpubRaw(item.xpub)"
                            >
                                <fa icon="share"></fa>
                            </Tooltip>
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from 'vue'
import { useMainStore, useNotificationsStore } from '@/stores'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import CopyText from '@/components/misc/CopyText.vue'
import Tooltip from '@/components/misc/Tooltip.vue'
import PrivateKey from '@/components/modals/PrivateKey.vue'
import XpubModal from '@/components/modals/XpubModal.vue'

interface AddrEntry {
    index: number
    address: string
}

interface CoreAddrEntry {
    index: number
    label: string
    address: string
    xpub: string
}

type PrivKeySource = 'xExternal' | 'xInternal' | 'p'

export default defineComponent({
    name: 'Addresses',
    components: { CopyText, Tooltip, PrivateKey, XpubModal },
    setup() {
        const mainStore = useMainStore()
        const notificationsStore = useNotificationsStore()

        const wallet = computed(() => mainStore.activeWallet)

        const isSupported = computed(() => {
            const w = wallet.value
            return w instanceof InjectedWallet || w instanceof MnemonicWallet
        })

        const canRevealPrivateKey = computed(() => wallet.value instanceof MnemonicWallet)

        // ---- InjectedWallet address collections ----

        const injectedXExternal = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof InjectedWallet)) return []
            return w['_hdXExternal'].map((address: string, i: number) => ({ index: i, address }))
        })

        const injectedXInternal = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof InjectedWallet)) return []
            return w['_hdXInternal'].map((address: string, i: number) => ({ index: i, address }))
        })

        const injectedP = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof InjectedWallet)) return []
            return w['_hdP'].map((address: string, i: number) => ({ index: i, address }))
        })

        const coreAppAddrs = computed((): CoreAddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof InjectedWallet)) return []
            const result: CoreAddrEntry[] = []
            for (const acct of w.coreAccounts) {
                const name = acct.name || acct.walletName || `Account ${acct.index}`
                if (acct.addressAVM) result.push({ index: acct.index, label: `${name} (X)`, address: acct.addressAVM, xpub: acct.xpubXP })
                if (acct.addressPVM) result.push({ index: acct.index, label: `${name} (P)`, address: acct.addressPVM, xpub: acct.xpubXP })
            }
            return result
        })

        // ---- MnemonicWallet address collections ----

        const mnemonicXExternal = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof MnemonicWallet)) return []
            const addrs = w.externalHelper.getAllDerivedAddresses()
            return addrs.map((address, i) => ({ index: i, address }))
        })

        const mnemonicXInternal = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof MnemonicWallet)) return []
            const addrs = w.internalHelper.getAllDerivedAddresses()
            return addrs.map((address, i) => ({ index: i, address }))
        })

        const mnemonicP = computed((): AddrEntry[] => {
            const w = wallet.value
            if (!(w instanceof MnemonicWallet)) return []
            const addrs = w.platformHelper.getAllDerivedAddresses()
            return addrs.map((address, i) => ({ index: i, address }))
        })

        // ---- Unified collections ----

        const xExternal = computed((): AddrEntry[] => {
            if (wallet.value instanceof InjectedWallet) return injectedXExternal.value
            if (wallet.value instanceof MnemonicWallet) return mnemonicXExternal.value
            return []
        })

        const xInternal = computed((): AddrEntry[] => {
            if (wallet.value instanceof InjectedWallet) return injectedXInternal.value
            if (wallet.value instanceof MnemonicWallet) return mnemonicXInternal.value
            return []
        })

        const pChainAddrs = computed((): AddrEntry[] => {
            if (wallet.value instanceof InjectedWallet) return injectedP.value
            if (wallet.value instanceof MnemonicWallet) return mnemonicP.value
            return []
        })

        // ---- Reveal modals ----

        const revealKey = ref('')
        const revealXpub = ref('')
        const privKeyModal = ref<InstanceType<typeof PrivateKey>>()
        const xpubModal = ref<InstanceType<typeof XpubModal>>()

        const openPrivKey = (source: PrivKeySource, index: number) => {
            const w = wallet.value
            if (!(w instanceof MnemonicWallet)) return
            try {
                const helper =
                    source === 'xExternal' ? w.externalHelper
                    : source === 'xInternal' ? w.internalHelper
                    : w.platformHelper
                const kp = helper.getKeyForIndex(index, true)
                revealKey.value = kp.getPrivateKeyString()
                privKeyModal.value?.open()
            } catch (e) {
                notificationsStore.add({
                    type: 'error',
                    title: 'Could not derive key',
                    message: e instanceof Error ? e.message : String(e),
                })
            }
        }

        const openXpub = (_source: 'account') => {
            const w = wallet.value
            if (w instanceof MnemonicWallet) {
                revealXpub.value = w.getXpubXP()
            } else if (w instanceof InjectedWallet) {
                // Use the active Core account's xpub; that's the one _accountKey was set from
                // and which all HD-derived rows above (xExternal/xInternal/pChain) derive from.
                const active = w.coreAccounts.find((a) => a.active) ?? w.coreAccounts[0]
                revealXpub.value = active?.xpubXP || ''
            } else {
                revealXpub.value = ''
            }
            if (!revealXpub.value) {
                notificationsStore.add({
                    type: 'error',
                    title: 'No xpub available',
                    message: 'This wallet does not expose an extended public key.',
                })
                return
            }
            xpubModal.value?.open()
        }

        const openXpubRaw = (xpub: string) => {
            revealXpub.value = xpub
            xpubModal.value?.open()
        }

        return {
            isSupported,
            canRevealPrivateKey,
            xExternal,
            xInternal,
            pChainAddrs,
            coreAppAddrs,
            revealKey,
            revealXpub,
            privKeyModal,
            xpubModal,
            openPrivKey,
            openXpub,
            openXpubRaw,
        }
    },
})
</script>

<style scoped lang="scss">
@use '../../main';

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
}

.unsupported {
    color: var(--primary-color-light);
    padding: 20px 0;
}

.sections {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

.section {
    background-color: var(--bg-light);
    border-radius: 6px;
    overflow: hidden;
}

.section_head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--bg);

    h2 {
        font-weight: 500;
        font-size: 1em;
        margin: 0;
        flex: 1;
    }
}

.chain_badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 0.7em;
    font-weight: bold;
    color: #fff;

    &.x  { background-color: #e84142; }
    &.p  { background-color: #0a85c2; }
    &.core { background-color: #6c6cff; font-size: 0.6em; }
}

.count {
    font-size: 0.8em;
    color: var(--primary-color-light);
    background-color: var(--bg);
    border-radius: 10px;
    padding: 2px 8px;
}

.addr_list {
    max-height: 320px;
    overflow-y: auto;
}

.empty {
    padding: 14px 16px;
    color: var(--primary-color-light);
    font-size: 0.85em;
}

.addr_row {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    font-size: 0.83em;
    font-family: monospace;

    &.even {
        background-color: var(--bg);
    }

    &.core_row {
        grid-template-columns: 36px auto 1fr auto;
    }

    .label {
        font-family: sans-serif;
        font-size: 0.85em;
        color: var(--primary-color-light);
        white-space: nowrap;
    }
}

.idx {
    color: var(--primary-color-light);
    text-align: right;
    font-family: sans-serif;
    font-size: 0.85em;
}

.addr {
    word-break: break-all;
    color: var(--primary-color);
}

.actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

/* Tooltip wraps a <button>; trim its default chrome and uniform-size the icons. */
.icon_btn {
    display: inline-flex;

    :deep(button) {
        background: transparent;
        border: 0;
        padding: 4px 6px;
        color: var(--primary-color);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
        border-radius: 4px;

        &:hover {
            background-color: var(--bg);
        }
    }

    :deep(svg) {
        font-size: 14px;
    }

    /* CopyText already has its own icon styling — strip the wrapper button border etc. */
    :deep(.copyBut) {
        margin: 0;
    }

    :deep(.copyBut img) {
        max-height: 14px;
    }

    &.disabled :deep(button) {
        cursor: not-allowed;
        color: var(--primary-color-light);
        opacity: 0.5;

        &:hover {
            background: transparent;
        }
    }
}

@include main.mobile-device {
    .addr_row {
        grid-template-columns: 28px 1fr auto;
        font-size: 0.75em;

        &.core_row {
            grid-template-columns: 28px auto 1fr auto;
        }
    }

    .icon_btn :deep(svg) {
        font-size: 12px;
    }
}
</style>
