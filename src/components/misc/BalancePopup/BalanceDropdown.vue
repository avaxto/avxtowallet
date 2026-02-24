<template>
    <div class="dropdown hover_border" :active="isPopup">
        <button @click="showPopup" :disabled="disabled">
            {{ symbol }}
            <!--            <fa icon="caret-down" style="float: right"></fa>-->
        </button>
        <!--        <BalancePopup-->
        <!--            :assets="assetArray"-->
        <!--            ref="popup"-->
        <!--            class="popup"-->
        <!--            @select="onselect"-->
        <!--            :disabled-ids="disabledIds"-->
        <!--            @close="onclose"-->
        <!--        ></BalancePopup>-->
        <AvmTokenSelect
            ref="token_modal"
            @select="onselect"
            :assets="assetArray"
            :disabled-ids="disabledIds"
        ></AvmTokenSelect>
    </div>
</template>
<script lang="ts">
import { defineComponent, ref, computed } from 'vue'
import { useAssetsStore } from '@/stores'

import BalancePopup from '@/components/misc/BalancePopup/BalancePopup.vue'
import AvaAsset from '@/js/AvaAsset'
import AvmTokenSelect from '@/components/modals/AvmTokenSelect.vue'

export default defineComponent({
    name: 'BalanceDropdown',
    components: {
        AvmTokenSelect,
        BalancePopup,
    },
    props: {
        disabled_assets: {
            type: Array as () => AvaAsset[],
            default: () => []
        },
        disabled: {
            type: Boolean,
            default: false
        },
        modelValue: {
            type: Object as () => AvaAsset,
            required: true
        }
    },
    emits: ['update:modelValue', 'change'],
    setup(props, { emit }) {
        const assetsStore = useAssetsStore()
        const isPopup = ref(false)
        const token_modal = ref<InstanceType<typeof AvmTokenSelect>>()

        const assetArray = computed((): AvaAsset[] => {
            return assetsStore.walletAssetsArray
        })

        const disabledIds = computed((): string[] => {
            let disabledIds = props.disabled_assets.map((a) => a.id)
            return disabledIds
        })

        const symbol = computed(() => {
            let sym = props.modelValue.symbol
            return sym
        })

        const showPopup = () => {
            if (token_modal.value) {
                token_modal.value.open()
            }
        }

        const onclose = () => {
            // this.isPopup = false
        }

        const onselect = (asset: AvaAsset) => {
            emit('update:modelValue', asset)
            emit('change', asset)
        }

        return {
            isPopup,
            token_modal,
            assetArray,
            disabledIds,
            symbol,
            showPopup,
            onclose,
            onselect
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../../main';

button {
    padding: 4px 12px;
    width: 100%;
    height: 100%;
    text-align: left;
    font-size: 15px;

    svg {
        transition-duration: 0.2s;
    }
}

.dropdown {
    position: relative;
    &:focus-within {
        outline: 1px solid var(--secondary-color);
    }
    > button {
        text-align: center;
    }
}

.dropdown[active] {
    button {
        svg {
            transform: rotateZ(180deg);
        }
    }
}
.popup {
    position: absolute;
}

@include main.mobile-device {
    button {
        font-size: 13px;
    }
}
</style>
