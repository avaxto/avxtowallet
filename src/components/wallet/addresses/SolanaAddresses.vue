<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  Solana's address model, and why this page shows one address rather than a
  list.

  Solana wallets ARE HD: a recovery phrase derives an ed25519 keypair via
  SLIP-0010 (see solana/keys.ts), the same as every account-model chain.
  What Solana does NOT do is Bitcoin's "generate a new address for privacy,
  scan a receive/change chain, gap-limit past the last used one" — Phantom,
  Solflare and every other Solana wallet reuse ONE address per account for
  every transaction, indefinitely. HD derivation here means "which account",
  not "which of many addresses this account has used" — there is exactly one
  address per account, and this wallet holds exactly one account. So there is
  nothing to scan and nothing to list: the fixed address below is the whole
  answer, the same way it would be if you asked Phantom for "all my
  addresses".
-->
<template>
    <div class="solana_addresses_page">
        <div class="head">
            <h1>Address</h1>
            <p class="desc">
                Solana wallets use one fixed address per account rather than a rotating
                chain of receive addresses — see the note in this page's source for why.
                This is the address every Solana transaction to this wallet uses.
            </p>
        </div>

        <div v-if="!wallet" class="unsupported">
            <p>No Solana wallet is connected.</p>
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
import { useSolanaStore } from '@/platforms/solana/store'
import { LocalSolanaWallet } from '@/platforms/solana/wallet'
import { getSolanaAddressUrl } from '@/solana/networks'
import FixedAddressCard from './FixedAddressCard.vue'

const WALLET_TYPE_LABELS: Record<string, string> = {
    mnemonic: 'Recovery Phrase',
    privatekey: 'Private Key',
    injected: 'Extension',
    watch: 'Watch-only',
}

export default defineComponent({
    name: 'SolanaAddresses',
    components: { FixedAddressCard },
    setup() {
        const solana = useSolanaStore()

        const wallet = computed(() => solana.wallet)
        const network = computed(() => solana.network)

        const walletTypeLabel = computed(
            () => WALLET_TYPE_LABELS[wallet.value?.accessMethodId ?? ''] ?? ''
        )

        // Only a mnemonic-derived wallet has a path to show — an injected
        // wallet's path lives in the extension, a private-key import never had
        // one, and a watch-only wallet was never derived from anything.
        const derivationPath = computed(() =>
            wallet.value instanceof LocalSolanaWallet ? wallet.value.derivationPath ?? '' : ''
        )

        const explorerUrl = computed(() => {
            const w = wallet.value
            if (!w) return ''
            return getSolanaAddressUrl(w.getPrimaryAddress(), network.value)
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
