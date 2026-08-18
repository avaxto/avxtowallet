<template>
    <modal ref="modal" title="Select Token" class="modal_main">
        <div class="token_select_body">
            <TokenListPicker
                :tokens="filteredTokens"
                :loading="loading"
                @select="onPick"
            ></TokenListPicker>
        </div>
    </modal>
</template>
<script lang="ts">
/**
 * X-chain's "Select Token" picker.
 *
 * Rebuilt on the same `TokenListPicker` widget the C-Chain/EVM send form
 * uses (`EvmTokenSelect/EVMTokenSelectModal.vue`) rather than its own
 * bespoke list — it was missing the search field, the loading state, and a
 * refresh on open that component already has, and there is no reason X-chain
 * and C-Chain should present differently for the same "pick what to send"
 * step.
 */
import { defineComponent, ref, computed, type PropType } from 'vue'

import Modal from '@/components/modals/Modal.vue'
import TokenListPicker from '@/components/misc/TokenListPicker.vue'
import AvaAsset from '@/js/AvaAsset'
import { useAssetsStore } from '@/stores'
import { useHeldXChainAssets, type XChainHeldToken } from '@/composables/useHeldXChainAssets'

export default defineComponent({
    name: 'AvmTokenSelect',
    components: {
        Modal,
        TokenListPicker,
    },
    props: {
        disabledIds: {
            type: Array as PropType<string[]>,
            default: () => [],
        },
    },
    emits: ['select'],
    setup(props, { emit }) {
        const assetsStore = useAssetsStore()
        const modal = ref<InstanceType<typeof Modal>>()
        const { tokens, loading, refresh } = useHeldXChainAssets()

        // A batch send disables assets already chosen in another row —
        // TokenListPicker has no exclusion concept of its own, so this is
        // filtered before it ever sees them.
        const filteredTokens = computed((): XChainHeldToken[] =>
            tokens.value.filter((t) => !props.disabledIds.includes(t.address))
        )

        const open = (): void => {
            modal.value?.open()
            refresh().catch((e) => {
                console.warn('[AvmTokenSelect] refresh on open failed:', e)
            })
        }

        const close = (): void => {
            modal.value?.close()
        }

        const onPick = (t: XChainHeldToken): void => {
            // tokens/filteredTokens are display projections of
            // assetsStore.walletAssetsDict — the real AvaAsset instance
            // (with its live UTXO-backed balance) is what the rest of the
            // send flow needs, not this row's snapshot.
            const asset: AvaAsset | undefined = assetsStore.walletAssetsDict[t.address]
            if (!asset) {
                // Only reachable if the indexer cross-check in refresh()
                // flagged an asset the local UTXO walk still hasn't picked
                // up — nothing sendable to hand back yet.
                console.warn(`[AvmTokenSelect] ${t.symbol} is not in the locally held asset list.`)
                return
            }
            close()
            emit('select', asset)
        }

        return {
            modal,
            open,
            close,
            filteredTokens,
            loading,
            onPick,
        }
    },
})
</script>
<style scoped lang="scss">
@use '../../main';

.token_select_body {
    width: 420px;
    max-width: 100%;
}

@include main.mobile-device {
    .token_select_body {
        width: 100%;
        height: 40vh;
        overflow: scroll;
    }
}
</style>
