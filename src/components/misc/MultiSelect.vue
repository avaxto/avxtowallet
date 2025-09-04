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
    selection: string[]
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
        selection: {
            type: Array as () => string[],
            required: true
        }
    },
    emits: ['change'],
    setup(props: Props, { emit }) {
        const selectionSet = computed(() => {
            return new Set(props.selection)
        })

        const select = (val: string) => {
            const now: Set<string> = new Set(props.selection)
            if (now.has(val)) {
                now.delete(val)
            } else {
                now.add(val)
            }
            emit('change', Array.from(now))
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
