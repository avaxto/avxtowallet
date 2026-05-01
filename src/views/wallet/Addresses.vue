<template>
    <div class="addresses_page">
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
                        <CopyText :value="item.address" class="copy_btn" />
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
                        <CopyText :value="item.address" class="copy_btn" />
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
                        <CopyText :value="item.address" class="copy_btn" />
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
                    <p class="desc">These are the main account addresses provided by the Core App extension. Only the first two are normally used. The other 49 accounts are reserved in Core App but not shown in this wallet. It is strongly recommended you do not use any of these addresses. Provided for advanced users only.</p>
                </div>
                <div class="addr_list">
                    <div
                        v-for="(item, i) in coreAppAddrs"
                        :key="'core-' + i"
                        class="addr_row"
                        :class="{ even: i % 2 === 0 }"
                    >
                        <span class="idx">{{ item.index }}</span>
                        <span class="label">{{ item.label }}</span>
                        <span class="addr">{{ item.address }}</span>
                        <CopyText :value="item.address" class="copy_btn" />
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted, ref } from 'vue'
import { useMainStore } from '@/stores'
import { InjectedWallet } from '@/js/wallets/InjectedWallet'
import MnemonicWallet from '@/js/wallets/MnemonicWallet'
import CopyText from '@/components/misc/CopyText.vue'

interface AddrEntry {
    index: number
    address: string
}

interface CoreAddrEntry {
    index: number
    label: string
    address: string
}

export default defineComponent({
    name: 'Addresses',
    components: { CopyText },
    setup() {
        const mainStore = useMainStore()

        const wallet = computed(() => mainStore.activeWallet)

        const isSupported = computed(() => {
            const w = wallet.value
            return w instanceof InjectedWallet || w instanceof MnemonicWallet
        })

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
                if (acct.addressAVM) result.push({ index: acct.index, label: `${name} (X)`, address: acct.addressAVM })
                if (acct.addressPVM) result.push({ index: acct.index, label: `${name} (P)`, address: acct.addressPVM })
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

        return {
            isSupported,
            xExternal,
            xInternal,
            pChainAddrs,
            coreAppAddrs,
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
    grid-template-columns: 36px 1fr 28px;
    align-items: center;
    gap: 8px;
    padding: 7px 16px;
    font-size: 0.83em;
    font-family: monospace;

    &.even {
        background-color: var(--bg);
    }

    .label {
        font-family: sans-serif;
        font-size: 0.85em;
        color: var(--primary-color-light);
        white-space: nowrap;
    }
}

/* Core App rows have an extra label column */
.section:last-child .addr_row {
    grid-template-columns: 36px auto 1fr 28px;
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

.copy_btn {
    justify-self: center;
}

@include main.mobile-device {
    .addr_row {
        grid-template-columns: 28px 1fr 24px;
        font-size: 0.75em;
    }
}
</style>
