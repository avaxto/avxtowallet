<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<!--
  One fixed address, for a platform where "derived from a seed" and "rotates
  over time" are different questions with different answers.

  Solana and EVM wallets ARE typically HD-derived from a BIP-39 seed — but
  unlike a Bitcoin (or Avalanche X/P-chain) wallet, the address that
  derivation produces does not rotate: it is reused for every transaction,
  indefinitely, the same way MetaMask and Phantom both show one address per
  account rather than a growing list of receive addresses. There is no
  external/internal chain, no gap limit, nothing to scan — so there is
  nothing here to list beyond the one address. See EvmAddresses.vue and
  SolanaAddresses.vue for why each platform's page renders this instead of
  an address list.
-->
<template>
    <div class="fixed_address_card">
        <div class="row">
            <span v-if="walletTypeLabel" class="badge">{{ walletTypeLabel }}</span>
            <span v-if="addressLabel" class="label">{{ addressLabel }}</span>
        </div>
        <div class="addr_row">
            <a
                v-if="explorerUrl"
                :href="explorerUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="addr mono"
            >
                {{ address }}
            </a>
            <span v-else class="addr mono">{{ address }}</span>
            <Tooltip text="Copy address to clipboard" class="icon_btn">
                <CopyText :value="address" />
            </Tooltip>
        </div>
        <p v-if="derivationPath" class="path">
            Derivation path: <span class="mono">{{ derivationPath }}</span>
        </p>
        <p v-if="note" class="note">{{ note }}</p>
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import CopyText from '@/components/misc/CopyText.vue'
import Tooltip from '@/components/misc/Tooltip.vue'

export default defineComponent({
    name: 'FixedAddressCard',
    components: { CopyText, Tooltip },
    props: {
        address: { type: String, required: true },
        addressLabel: { type: String, default: '' },
        derivationPath: { type: String, default: '' },
        explorerUrl: { type: String, default: '' },
        walletTypeLabel: { type: String, default: '' },
        note: { type: String, default: '' },
    },
})
</script>

<style scoped lang="scss">
.fixed_address_card {
    background-color: var(--bg-light);
    border-radius: 6px;
    padding: 20px;
}

.row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.badge {
    font-size: 11px;
    color: var(--primary-color-light);
    background-color: var(--bg);
    border-radius: 3px;
    padding: 2px 8px;
}

.label {
    font-size: 0.85em;
    color: var(--primary-color-light);
}

.addr_row {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--bg);
    border-radius: 4px;
    padding: 10px 14px;
}

.addr {
    flex: 1;
    word-break: break-all;
    color: var(--primary-color);
    text-decoration: none;
    font-size: 0.95em;

    &:hover {
        color: var(--secondary-color);
    }
}

.mono {
    font-family: monospace;
}

.path {
    margin-top: 12px;
    font-size: 0.83em;
    color: var(--primary-color-light);
}

.note {
    margin-top: 10px;
    font-size: 0.83em;
    color: var(--primary-color-light);
    line-height: 1.5;
}

.icon_btn {
    display: inline-flex;
    flex-shrink: 0;

    :deep(.copyBut) {
        margin: 0;
    }

    :deep(.copyBut img) {
        max-height: 14px;
    }
}
</style>
