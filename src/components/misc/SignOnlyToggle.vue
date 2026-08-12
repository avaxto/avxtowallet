<!--
  Copyright (c) 2026 @REKTBuildr

  Licensed under the BSD 3 Clause License. See LICENSE file in the project root for details.
-->
<template>
    <div class="sign_only_toggle">
        <template v-if="isInjectedWallet">
            <!-- The global switch can't be honored either — surface that
                 rather than let the user believe it's protecting them. -->
            <p v-if="globalActive" class="global_note warn">
                <fa icon="exclamation-triangle"></fa>
                Offline signing is on globally, but isn't supported for this wallet — this will still be sent.
            </p>
        </template>
        <template v-else>
            <label v-if="!globalActive" class="row">
                <input type="checkbox" :checked="oneShot" :disabled="disabled" @change="onToggle" />
                <span>
                    Sign only — don't broadcast
                    <small>Produces a transaction you can submit later from Broadcast Tx.</small>
                </span>
            </label>

            <p v-else class="global_note">
                <fa icon="info-circle"></fa>
                Offline signing is on globally — this will be signed but not sent.
            </p>
        </template>
    </div>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue'
import { useMainStore, useOfflineSigningStore } from '@/stores'

export default defineComponent({
    name: 'SignOnlyToggle',
    props: {
        disabled: { type: Boolean, default: false },
    },
    setup() {
        const mainStore = useMainStore()
        const offline = useOfflineSigningStore()

        // Injected wallets (Core App / MetaMask) only expose atomic
        // sign-and-submit RPCs (eth_sendTransaction, avalanche_sendTransaction)
        // for every send path in this app — there's no way to get a signed-but-
        // not-broadcast transaction back, so "sign only" can't be honored. The
        // toggle used to stay visible and silently do nothing; hide it instead
        // of offering a capability the active wallet can't provide.
        const isInjectedWallet = computed(() => mainStore.activeWallet?.type === 'injected')

        // With the global switch on, a per-operation checkbox would be
        // redundant and could read as if unchecking it re-enables sending.
        const globalActive = computed(() => offline.isEnabled)
        const oneShot = computed(() => offline.oneShot)

        const onToggle = (e: Event) => {
            offline.setOneShot((e.target as HTMLInputElement).checked)
        }

        return { isInjectedWallet, globalActive, oneShot, onToggle }
    },
})
</script>

<style scoped lang="scss">
.sign_only_toggle {
    margin: 12px 0;
}

.row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
    font-size: 0.85em;
    font-weight: normal !important;
    color: var(--primary-color);
    margin: 0 !important;

    input {
        cursor: pointer;
        margin-top: 2px;
    }

    small {
        display: block;
        color: var(--primary-color-light);
        font-size: 0.9em;
    }
}

.global_note {
    font-size: 0.8em;
    color: var(--primary-color-light);
    background-color: var(--bg-light);
    border-radius: 4px;
    padding: 8px 10px;
    margin: 0;

    &.warn {
        color: var(--secondary-color);
    }
}
</style>
