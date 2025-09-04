<template>
    <div class="radio_buts">
        <button
            v-for="(key, i) in keys"
            :key="key"
            @click="select(key)"
            :active="selection === key"
            class="hover_border"
            :disabled="disabled"
        >
            {{ labels[i] }}
        </button>
    </div>
</template>
<script lang="ts">
import { defineComponent, type PropType } from 'vue'

export default defineComponent({
    name: 'RadioButtons',
    props: {
        labels: {
            type: Array as PropType<string[]>,
            required: true
        },
        keys: {
            type: Array as PropType<string[]>,
            required: true
        },
        disabled: {
            type: Boolean,
            default: false
        },
        selection: {
            type: String,
            required: true
        }
    },
    emits: ['change'],
    setup(props, { emit }) {
        const select = (val: string) => {
            emit('change', val)
        }

        return {
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

    //&:hover {
    //    border-color: var(--bg-light);
    //}

    &[active] {
        color: var(--bg-wallet);
        //border-color: #285599;
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
