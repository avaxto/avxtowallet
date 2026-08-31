<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  EVM's address model, and why this page shows one address rather than a
  list.

  A phrase-opened EVM wallet is HD-derived too (BIP-32/44 secp256k1 — see
  evm/keys.ts), but EVM's own ecosystem convention is the account-model one,
  not Bitcoin's: MetaMask, Rabby and every other EVM wallet reuse ONE address
  per account for every transaction on every chain, forever — there is no
  receive/change chain, no gap limit, no privacy rotation. HD derivation here
  picks which account (`m/44'/60'/0'/0/i`); this wallet holds exactly one, so
  there is exactly one address to show. It is also, deliberately, the SAME
  address Avalanche derives for its own C-Chain key from the same phrase —
  see evm/keys.ts — which is worth confirming here if the two tabs were
  opened from one recovery phrase.
-->
<template>
    <div class="evm_addresses_page">
        <div class="head">
            <h1>Address</h1>
            <p class="desc">
                EVM wallets use one fixed address per account on every network, the same
                way MetaMask does — see the note in this page's source for why. This is the
                address every transaction to this wallet on {{ network.name }} uses.
            </p>
        </div>

        <div v-if="!wallet" class="unsupported">
            <p>No EVM wallet is connected.</p>
        </div>

        <FixedAddressCard
            v-else
            :address="wallet.getPrimaryAddress()"
            :address-label="network.name"
            :derivation-path="derivationPath"
            :explorer-url="explorerUrl"
            :wallet-type-label="walletTypeLabel"
        ></FixedAddressCard>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useEvmStore } from '@/platforms/evm/store'
import { LocalEvmWallet } from '@/platforms/evm/wallet'
import { explorerAddressUrl } from '@/evm/networkRegistry'
import FixedAddressCard from './FixedAddressCard.vue'

const WALLET_TYPE_LABELS: Record<string, string> = {
    mnemonic: 'Recovery Phrase',
    injected: 'Extension',
    watch: 'Watch-only',
}

export default defineComponent({
    name: 'EvmAddresses',
    components: { FixedAddressCard },
    setup() {
        const evm = useEvmStore()

        const wallet = computed(() => evm.wallet)
        const network = computed(() => evm.network)

        const walletTypeLabel = computed(
            () => WALLET_TYPE_LABELS[wallet.value?.accessMethodId ?? ''] ?? ''
        )

        // Only a phrase-derived wallet has a path to show — an injected
        // wallet's path lives in the extension, and there is no third kind
        // that would have one (no private-key import on this platform yet).
        const derivationPath = computed(() =>
            wallet.value instanceof LocalEvmWallet ? wallet.value.derivationPath : ''
        )

        const explorerUrl = computed(() => {
            const w = wallet.value
            if (!w) return ''
            return explorerAddressUrl(network.value, w.getPrimaryAddress())
        })

        return {
            wallet,
            network,
            walletTypeLabel,
            derivationPath,
            explorerUrl,
        }
    },
})
</script>

<style scoped lang="scss">
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
</style>
