<template>
    <modal ref="modal" title="Select Token" class="modal_main">
        <div class="avm_token_select">
            <div class="list">
                <div
                    v-for="asset in assets"
                    :key="asset.id"
                    :zero="asset.amount.isZero()"
                    :disabled="isDisabled(asset)"
                    @click="select(asset)"
                >
                    <div class="col_name">
                        <p>{{ asset.symbol }}</p>
                        <p>{{ asset.name }}</p>
                    </div>
                    <div class="col_balance">
                        <p>{{ bal(asset) }}</p>
                    </div>
                </div>
            </div>
        </div>
    </modal>
</template>
<script lang="ts">
import { defineComponent, ref, type PropType } from 'vue'

import Modal from '@/components/modals/Modal.vue'
import AvaAsset from '@/js/AvaAsset'
import { bnToBig } from '@/helpers/helper'

export default defineComponent({
    name: 'AvmTokenSelect',
    components: {
        Modal,
    },
    props: {
        assets: {
            type: Array as PropType<AvaAsset[]>,
            required: true
        },
        disabledIds: {
            type: Array as PropType<string[]>,
            default: () => []
        }
    },
    emits: ['select'],
    setup(props, { emit }) {
        const modal = ref<InstanceType<typeof Modal>>()

        const bal = (asset: AvaAsset) => {
            return bnToBig(asset.amount, asset.denomination).toLocaleString()
        }

        const open = (): void => {
            modal.value?.open()
        }

        const close = () => {
            modal.value?.close()
        }

        const select = (asset: AvaAsset) => {
            if (asset.amount.isZero()) return
            if (isDisabled(asset)) return

            close()
            emit('select', asset)
        }

        const isDisabled = (asset: AvaAsset): boolean => {
            if (props.disabledIds.includes(asset.id)) return true
            return false
        }

        return {
            modal,
            bal,
            open,
            close,
            select,
            isDisabled
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';

.avm_token_select {
    width: 520px;
    max-width: 100%;
}

.list {
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow: scroll;

    > div {
        display: grid;
        grid-template-columns: max-content 1fr;
        padding: 10px 20px;
        cursor: pointer;
        user-select: none;

        &:hover {
            background-color: var(--bg-light);
        }

        &[disabled] {
            opacity: 0.3;
        }
    }
}

.col_name {
    text-align: left;

    p:last-of-type {
        color: var(--primary-color-light);
        font-size: 13px;
    }
}

.col_balance {
    align-self: center;
}

@include main.mobile-device {
    .avm_token_select {
        width: 100%;
    }
}
</style>
