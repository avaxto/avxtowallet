<template>
    <div class="radio_buts">
        <button
            v-for="(key, i) in keys"
            :key="key"
            @click="select(key)"
            :active="selectionSet.has(key)"
            class="hover_border"
            :disabled="disabled"
        >
            {{ labels[i] }}
        </button>
    </div>
</template>
<script lang="ts">
import { defineComponent, computed } from 'vue'
import RadioButtons from './RadioButtons.vue'

interface Props {
    labels: string[]
    keys: string[]
    disabled: boolean
    modelValue: string[]
}

export default defineComponent({
    name: 'MultiSelect',
    props: {
        labels: {
            type: Array as () => string[],
            required: true
        },
        keys: {
            type: Array as () => string[],
            required: true
        },
        disabled: {
            type: Boolean,
            default: false
        },
        // Named to match RadioButtons.vue's convention (its sibling, used
        // alongside it in ExportGlacierHistoryModal.vue) so `v-model` works —
        // this used to be a non-standard `selection`/`change` pair, which
        // `v-model="includeChains"` at the call site silently bound to
        // nothing (Vue only wires v-model to modelValue/update:modelValue).
        modelValue: {
            type: Array as () => string[],
            required: true
        }
    },
    emits: ['update:modelValue'],
    setup(props: Props, { emit }) {
        const selectionSet = computed(() => {
            return new Set(props.modelValue)
        })

        const select = (val: string) => {
            const now: Set<string> = new Set(props.modelValue)
            if (now.has(val)) {
                now.delete(val)
            } else {
                now.add(val)
            }
            emit('update:modelValue', Array.from(now))
        }

        return {
            selectionSet,
            select
        }
    }
})
</script>
<style scoped lang="scss">
@use '../../main';
.radio_buts {
    display: flex;
    flex-wrap: wrap;
}
button {
    word-break: normal;
    white-space: nowrap;
    font-weight: bold;
    font-size: 14px;
    padding: 4px 14px;
    border: 1px solid transparent;
    color: var(--primary-color-light);
    background-color: var(--bg-wallet);
    border-radius: 4px;
    margin-right: 6px;
    margin-bottom: 6px;
    transition-duration: 0.2s;
    font-family: Inconsolata, monospace;

    &[active] {
        color: var(--bg-wallet);
        background-color: var(--primary-color);
    }

    &[disabled] {
        opacity: 0.4;
    }
}

@include main.medium-device {
    button {
        font-size: 11px;
        padding: 4px 8px;
    }
}
</style>
