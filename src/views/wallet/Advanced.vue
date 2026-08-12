<template>
    <div>
        <div>
            <h1>{{ $t('advanced.title') }}</h1>
        </div>
        <TokenListModal ref="token_list"></TokenListModal>
        <PendingImports></PendingImports>
        <div class="grids">
            <ChainImport class="grid_box"></ChainImport>
            <template v-if="!isInjectedWallet">
                <SignMessage class="grid_box"></SignMessage>
                <VerifyMessage class="grid_box"></VerifyMessage>
            </template>
        </div>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useMainStore } from '@/stores'

import ChainImport from '@/components/wallet/advanced/ChainImport.vue'
import PendingImports from '@/components/wallet/advanced/PendingImports.vue'
import SignMessage from '@/components/wallet/advanced/SignMessage/SignMessage.vue'
import VerifyMessage from '@/components/wallet/advanced/VerifyMessage.vue'
import TokenListModal from '@/components/modals/TokenList/TokenListModal.vue'

export default defineComponent({
    name: 'advanced',
    components: {
        TokenListModal,
        ChainImport,
        PendingImports,
        SignMessage,
        VerifyMessage,
    },
    setup() {
        const mainStore = useMainStore()
        const token_list = ref<InstanceType<typeof TokenListModal>>()

        // Sign/Verify Message are X-Chain-only (they produce/expect a CB58
        // Avalanche signature). Injected wallets only sign via the EVM
        // personal_sign RPC (see InjectedWallet.signMessage), which is a
        // different, incompatible signature format — so these boxes are
        // unusable for them and are hidden rather than shown broken.
        const isInjectedWallet = computed(() => mainStore.activeWallet?.type === 'injected')

        const openTokenlist = () => {
            token_list.value?.open()
        }

        return {
            token_list,
            isInjectedWallet,
            openTokenlist,
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

h1 {
    font-weight: normal;
}

.grids {
    display: grid;
    column-gap: 14px;
    row-gap: 14px;
    // auto-fit (not a fixed repeat(3, ...)) so ChainImport doesn't leave two
    // empty trailing columns when Sign/Verify Message are hidden for wallets
    // that can't use them (e.g. injected).
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

.grid_box {
    background-color: var(--bg-light);
    padding: 30px;
    border-radius: 4px;
    overflow: auto;
}

@include main.mobile-device {
    .grids {
        grid-template-columns: none;
    }
}

@include main.medium-device {
    .grids {
        grid-template-columns: none;
    }
}

.buts {
    margin-bottom: 12px;
    button {
        color: var(--primary-color);
        &:hover {
            color: var(--secondary-color);
        }
    }
}
</style>
